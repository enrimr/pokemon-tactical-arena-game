// Genera los iconos de la PWA (pokéball dibujada en canvas, sin assets de
// terceros) en apps/client/public/iconos/. Usa el Chromium de Playwright como
// rasterizador. Uso: node tools/generar-iconos.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEST = path.join(path.dirname(fileURLToPath(import.meta.url)), '../apps/client/public/iconos');
mkdirSync(DEST, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

async function icono(size, margen, nombre) {
  const dataUrl = await page.evaluate(([s, m]) => {
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const ctx = c.getContext('2d');
    // Fondo (visible en el icono maskable; en el normal queda como placa redondeada)
    const g = ctx.createRadialGradient(s * 0.35, s * 0.3, s * 0.1, s * 0.5, s * 0.5, s * 0.75);
    g.addColorStop(0, '#1b2d40');
    g.addColorStop(1, '#0b1420');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(0, 0, s, s, s * 0.18);
    ctx.fill();
    // Pokéball centrada
    const cx = s / 2, cy = s / 2, r = (s / 2) * (1 - m);
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = '#e8352e'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI); ctx.closePath();
    ctx.fillStyle = '#f4f6f7'; ctx.fill();
    ctx.fillStyle = '#20262b';
    ctx.fillRect(cx - r, cy - r * 0.085, r * 2, r * 0.17);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.30, 0, Math.PI * 2); ctx.fillStyle = '#20262b'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.21, 0, Math.PI * 2); ctx.fillStyle = '#f4f6f7'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, r * 0.07); ctx.strokeStyle = '#20262b'; ctx.stroke();
    // Brillo
    ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.45, r * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
    return c.toDataURL('image/png');
  }, [size, margen]);
  writeFileSync(path.join(DEST, nombre), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('✓', nombre);
}

await icono(192, 0.12, 'icono-192.png');
await icono(512, 0.12, 'icono-512.png');
await icono(512, 0.3, 'icono-maskable-512.png'); // zona segura del 40 % central
await icono(180, 0.12, 'apple-touch-icon.png');
await browser.close();
console.log('Iconos PWA generados en apps/client/public/iconos/');
