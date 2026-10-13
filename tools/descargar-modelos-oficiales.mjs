// Descarga opcional de los modelos oficiales (ver ASSET_SOURCES.md, sección
// «Modelos oficiales opcionales»). Los .glb proceden del repositorio público
// pokemon-party/3d-pokemon (extracciones de los juegos; propiedad de
// Nintendo/Creatures Inc./GAME FREAK). NO se incluyen en este repositorio ni en
// los artefactos de despliegue: cada usuario decide descargarlos en su copia.
//
// Uso: npm run modelos:oficiales
// Deja los archivos en apps/client/public/modelos-oficiales/ (ignorado por git)
// junto con el descodificador Draco que three.js distribuye en npm.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copiarDraco } from './copiar-draco.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'apps/client/public/modelos-oficiales');
const BASE_URL = 'https://raw.githubusercontent.com/pokemon-party/3d-pokemon/main/models/opt/regular';

// Nº de Pokédex nacional de los personajes del juego y sus evoluciones
const MODELOS = [
  { dex: 25, nombre: 'Pikachu' },
  { dex: 26, nombre: 'Raichu' },
  { dex: 4, nombre: 'Charmander' },
  { dex: 5, nombre: 'Charmeleon' },
  { dex: 6, nombre: 'Charizard' },
  { dex: 7, nombre: 'Squirtle' },
  { dex: 8, nombre: 'Wartortle' },
  { dex: 9, nombre: 'Blastoise' },
  { dex: 1, nombre: 'Bulbasaur' },
  { dex: 2, nombre: 'Ivysaur' },
  { dex: 3, nombre: 'Venusaur' },
  { dex: 150, nombre: 'Mewtwo' },
];

await mkdir(DEST, { recursive: true });

for (const { dex, nombre } of MODELOS) {
  const url = `${BASE_URL}/${dex}.glb`;
  process.stdout.write(`Descargando ${nombre} (${dex}.glb)… `);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`ERROR ${res.status} al descargar ${url}`);
    process.exitCode = 1;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Comprobación mínima de que es un GLB real y no una página de error
  if (buf.length < 12 || buf.readUInt32LE(0) !== 0x46546c67) {
    console.error(`ERROR: ${url} no es un archivo GLB válido`);
    process.exitCode = 1;
    continue;
  }
  await writeFile(path.join(DEST, `${dex}.glb`), buf);
  console.log(`${(buf.length / 1024).toFixed(0)} KiB ✓`);
}

// Descodificador Draco (los .glb usan KHR_draco_mesh_compression). three.js lo
// distribuye en su paquete npm, así que se copia en local: sin CDN en ejecución.
await copiarDraco();
console.log('Descodificador Draco copiado desde node_modules/three ✓');
console.log(`\nListo. Activa «Modelos oficiales» en Ajustes dentro del juego.`);
console.log('Aviso: estos modelos son propiedad de Nintendo/Creatures Inc./GAME FREAK;');
console.log('no los redistribuyas ni los incluyas en despliegues públicos.');
