// Descarga de texturas CC0 para el mapa (ver ASSET_SOURCES.md, sección
// «Texturas del mapa»). Proceden de ambientCG (https://ambientcg.com), que
// publica todo su catálogo bajo Creative Commons CC0 1.0 (dominio público),
// por lo que SÍ se incluyen en este repositorio y en el despliegue.
//
// Uso: npm run texturas
// Deja los archivos en apps/client/public/texturas/ (incluidos en git).

import { mkdir, writeFile, readdir, rm, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'apps/client/public/texturas');

// assetId de ambientCG → nombre base local. De cada zip 1K-JPG se conservan
// solo el mapa de color y el de normales (GL).
const TEXTURAS = [
  { asset: 'Concrete034', base: 'hormigon-suelo' },
  { asset: 'Plaster001', base: 'yeso-muro' },
  { asset: 'CorrugatedSteel005', base: 'placas-metal' },
  { asset: 'Planks037A', base: 'madera' },
  { asset: 'DiamondPlate008C', base: 'chapa-metal' },
  { asset: 'Metal009', base: 'metal-oxidado' },
  { asset: 'Grass004', base: 'cesped' },
];

await mkdir(DEST, { recursive: true });

for (const { asset, base } of TEXTURAS) {
  const url = `https://ambientcg.com/get?file=${asset}_1K-JPG.zip`;
  process.stdout.write(`Descargando ${asset} → ${base}… `);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    console.error(`ERROR ${res.status} al descargar ${url}`);
    process.exitCode = 1;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = await mkdirTemp(asset);
  const zipPath = path.join(tmp, `${asset}.zip`);
  await writeFile(zipPath, buf);
  const unzip = spawnSync('unzip', ['-o', '-q', zipPath, '-d', tmp]);
  if (unzip.status !== 0) {
    console.error(`ERROR al extraer ${zipPath}`);
    process.exitCode = 1;
    continue;
  }
  const files = await readdir(tmp);
  const color = files.find((f) => f.endsWith('_Color.jpg'));
  const normal = files.find((f) => f.endsWith('_NormalGL.jpg'));
  if (!color || !normal) {
    console.error(`ERROR: el zip de ${asset} no contiene Color/NormalGL`);
    process.exitCode = 1;
    continue;
  }
  await rename(path.join(tmp, color), path.join(DEST, `${base}_color.jpg`));
  const normalDest = path.join(DEST, `${base}_normal.jpg`);
  await rename(path.join(tmp, normal), normalDest);
  // Los mapas de normales a 1K pesan ~1-2 MiB cada uno; a 512 px el detalle a
  // distancia de juego es equivalente y ocupan ~75 % menos (sips viene con macOS).
  const sips = spawnSync('sips', ['-Z', '512', normalDest], { stdio: 'ignore' });
  if (sips.status !== 0) console.warn(`aviso: no se pudo reducir ${normalDest} (sips no disponible)`);
  await rm(tmp, { recursive: true, force: true });
  console.log(`${(buf.length / 1024).toFixed(0)} KiB ✓`);
}

async function mkdirTemp(name) {
  const dir = path.join(tmpdir(), `pta-texturas-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

console.log(`\nListo. Texturas CC0 (ambientCG) en apps/client/public/texturas/.`);
