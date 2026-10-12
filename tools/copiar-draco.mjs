// Copia el descodificador Draco que three.js distribuye en npm (licencia
// Apache-2.0/MIT, redistribuible) a apps/client/public/draco/. Se ejecuta como
// predev/prebuild del cliente: los binarios no se guardan en git pero siempre
// están presentes al servir o compilar. Lo necesita el cargador de modelos
// oficiales (KHR_draco_mesh_compression); sin CDN en ejecución.

import { mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'apps/client/public/draco');

export async function copiarDraco() {
  const require = createRequire(path.join(ROOT, 'apps/client/package.json'));
  // three no exporta ./package.json: se resuelve el módulo principal (build/) y se sube
  const threeDir = path.dirname(path.dirname(require.resolve('three')));
  const dracoDir = path.join(threeDir, 'examples/jsm/libs/draco/gltf');
  await mkdir(DEST, { recursive: true });
  for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
    await copyFile(path.join(dracoDir, f), path.join(DEST, f));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await copiarDraco();
  console.log(`Descodificador Draco copiado a ${DEST}`);
}
