import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { encode, isValidAlias, isValidRoomCode } from '@pta/shared';
import { Room } from './room.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface GameServer {
  server: ReturnType<typeof createServer>;
  rooms: Map<string, Room>;
  close(): Promise<void>;
}

export function createGameServer(port: number, staticDir?: string): Promise<GameServer> {
  const STATIC_DIR = staticDir ?? process.env.STATIC_DIR ?? join(HERE, '..', '..', 'client', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

  const rooms = new Map<string, Room>();

  const server = createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/salud') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, salas: rooms.size }));
      return;
    }
    let path = normalize(url).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || path === '') path = '/index.html';
    const file = join(STATIC_DIR, path);
    if (!file.startsWith(STATIC_DIR)) {
      res.writeHead(403); res.end(); return;
    }
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('no file');
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      // SPA: cualquier otra ruta sirve el índice
      try {
        const data = await readFile(join(STATIC_DIR, 'index.html'));
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(data);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Compila el cliente con `npm run build` para servirlo desde aquí.');
      }
    }
  } catch {
    res.writeHead(500); res.end();
  }
});

  const wss = new WebSocketServer({ server, maxPayload: 16 * 1024, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
  let claimed = false;
  const timeout = setTimeout(() => { if (!claimed) ws.close(); }, 15_000);

  ws.on('message', (data, isBinary) => {
    if (claimed || isBinary) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(encode({ t: 'error', codigo: 'formato', msg: 'JSON inválido' }));
      return;
    }
    const m = msg as { t?: string; nombre?: unknown; codigo?: unknown; token?: unknown };
    if (m.t === 'crear') {
      if (!isValidAlias(m.nombre)) {
        ws.send(encode({ t: 'error', codigo: 'nombreInvalido', msg: 'Alias no válido' }));
        return;
      }
      const code = Room.generateCode((c) => rooms.has(c));
      const room = new Room(code, (c) => rooms.delete(c));
      rooms.set(code, room);
      claimed = true;
      clearTimeout(timeout);
      ws.removeAllListeners('message');
      room.join(ws, m.nombre as string);
    } else if (m.t === 'unirse') {
      if (!isValidRoomCode(typeof m.codigo === 'string' ? m.codigo.toUpperCase() : m.codigo)) {
        ws.send(encode({ t: 'error', codigo: 'salaNoExiste', msg: 'Código no válido' }));
        return;
      }
      const code = (m.codigo as string).toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        ws.send(encode({ t: 'error', codigo: 'salaNoExiste', msg: 'La sala no existe' }));
        return;
      }
      const token = typeof m.token === 'string' ? m.token : undefined;
      if (!token && !isValidAlias(m.nombre)) {
        ws.send(encode({ t: 'error', codigo: 'nombreInvalido', msg: 'Alias no válido' }));
        return;
      }
      claimed = true;
      clearTimeout(timeout);
      ws.removeAllListeners('message');
      const res = room.join(ws, (m.nombre as string) ?? 'Jugador', token);
      if (!res.ok) {
        ws.send(encode({ t: 'error', codigo: res.error ?? 'salaLlena', msg: res.error === 'nombreInvalido' ? 'Alias no válido' : 'La sala está llena' }));
        claimed = false;
        ws.close();
      }
    } else {
      ws.send(encode({ t: 'error', codigo: 'formato', msg: 'Primero crea o únete a una sala' }));
    }
  });

  ws.on('close', () => clearTimeout(timeout));
});

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const realPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`[pta] Servidor en http://localhost:${realPort} (WebSocket en /ws)`);
      console.log(`[pta] Estáticos: ${STATIC_DIR}`);
      console.log('[pta] Límites: 10 humanos por sala, 10 jugadores por partida (bots incluidos), sin listado público de salas.');
      resolve({
        server,
        rooms,
        close: () => new Promise<void>((done) => {
          for (const room of rooms.values()) room.destroy();
          wss.close();
          server.close(() => done());
          setTimeout(done, 500);
        }),
      });
    });
  });
}
