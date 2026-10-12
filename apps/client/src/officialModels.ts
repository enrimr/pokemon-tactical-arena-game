import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneWithSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterId } from '@pta/shared';
import {
  buildAttackIndicator, updateAttackIndicator, CHARACTER_COLORS,
  type CharacterModel, type Pose,
} from './models.js';

/**
 * Carga opcional de los modelos oficiales (.glb descargados por el usuario con
 * `npm run modelos:oficiales`; ver ASSET_SOURCES.md). Si los archivos no están
 * en /modelos-oficiales/, el juego sigue con los modelos procedurales propios.
 *
 * Los .glb usan compresión Draco (descodificador local, copiado de three.js)
 * y texturas WebP (soporte nativo del navegador). Son mallas con esqueleto:
 * se clonan con SkeletonUtils y, si traen animaciones, se reproducen con un
 * AnimationMixer (idle/andar); si no, se aplica un balanceo por código.
 */

const BASE = '/modelos-oficiales';

/** Nº de Pokédex nacional: nombre de archivo en la descarga local. */
const DEX: Record<CharacterId, number> = { pikachu: 25, charmander: 4, squirtle: 7, bulbasaur: 1 };

/** Punto de origen de los ataques (boca), tras normalizar la altura. */
const MUZZLE: Record<CharacterId, [number, number, number]> = {
  pikachu: [0, 0.95, -0.58],
  charmander: [0, 0.93, -0.6],
  squirtle: [0, 0.92, -0.58],
  bulbasaur: [0, 0.7, -0.78],
};

/** Altura visual objetivo (los procedurales miden ≈1,4 m). */
const TARGET_HEIGHT: Record<CharacterId, number> = {
  pikachu: 1.35, charmander: 1.35, squirtle: 1.3, bulbasaur: 1.1,
};

const cache = new Map<CharacterId, GLTF>();
let loader: GLTFLoader | null = null;
let loadPromise: Promise<boolean> | null = null;

function getLoader(): GLTFLoader {
  if (!loader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${BASE}/draco/`);
    loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
  }
  return loader;
}

/**
 * Intenta cargar los cuatro .glb locales (una sola vez; las llamadas
 * posteriores reutilizan el resultado). Devuelve true si están los cuatro.
 */
export function preloadOfficialModels(): Promise<boolean> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const jobs = (Object.keys(DEX) as CharacterId[]).map(async (id) => {
      const url = `${BASE}/${DEX[id]}.glb`;
      // HEAD previo: distingue un 404 real de un index.html de respaldo
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok || (head.headers.get('content-type') ?? '').includes('text/html')) {
        throw new Error(`no encontrado: ${url}`);
      }
      const gltf = await getLoader().loadAsync(url);
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.frustumCulled = false; // la malla con esqueleto se desplaza fuera de su AABB original
        }
      });
      cache.set(id, gltf);
    });
    const results = await Promise.allSettled(jobs);
    const fallos = results.filter((r) => r.status === 'rejected');
    if (fallos.length) {
      console.info(
        `[modelos oficiales] ${fallos.length} de 4 no disponibles; se usan los modelos propios. ` +
        'Para descargarlos: npm run modelos:oficiales',
      );
    }
    return cache.size === 4;
  })();
  return loadPromise;
}

/**
 * Crea una instancia del modelo oficial ya cargado, o null si no está en
 * caché (sin descarga, o preload aún en curso): el llamante usará el procedural.
 */
export function createOfficialModel(id: CharacterId): CharacterModel | null {
  const gltf = cache.get(id);
  if (!gltf) return null;

  const inner = cloneWithSkeleton(gltf.scene);

  // Animaciones del archivo: idle + andar mezcladas por velocidad. Si no hay
  // clips reconocibles, se fija el primer fotograma del primer clip como pose
  // estática (en algunas extracciones la pose de reposo del esqueleto está rota
  // y solo las animaciones colocan bien el modelo).
  let mixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let moveAction: THREE.AnimationAction | null = null;
  const clips = gltf.animations;
  if (clips.length) {
    const find = (re: RegExp): THREE.AnimationClip | undefined => clips.find((c) => re.test(c.name));
    const idleClip = find(/idle|wait|reposo/i);
    const moveClip = find(/run/i) ?? find(/walk|andar/i);
    mixer = new THREE.AnimationMixer(inner);
    if (idleClip) {
      idleAction = mixer.clipAction(idleClip);
      idleAction.play();
      if (moveClip && moveClip !== idleClip) {
        moveAction = mixer.clipAction(moveClip);
        moveAction.setEffectiveWeight(0);
        moveAction.play();
      }
      mixer.update(0); // aplicar la pose antes de medir
    } else {
      mixer.clipAction(clips[0]).play();
      mixer.update(0);
      mixer = null; // pose fija: no seguir reproduciendo el clip (sería un ataque en bucle)
    }
  }

  // Normalizar: altura objetivo, pies en y=0, centrado, mirando a -Z
  // (glTF orienta el frente hacia +Z; el juego usa -Z como los procedurales).
  // En mallas con esqueleto la caja debe medirse con el skinning aplicado:
  // los nodos de huesos inflan Box3.setFromObject hasta hacer el modelo diminuto.
  inner.updateMatrixWorld(true);
  const bbox = new THREE.Box3();
  inner.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    if (mesh.isSkinnedMesh) {
      // Sin esto los boneMatrices son la identidad hasta el primer render
      mesh.skeleton.update();
      mesh.computeBoundingBox();
    } else mesh.geometry.computeBoundingBox();
    const b = (mesh.isSkinnedMesh ? mesh.boundingBox : mesh.geometry.boundingBox);
    if (b) bbox.union(b.clone().applyMatrix4(mesh.matrixWorld));
  });
  const size = bbox.getSize(new THREE.Vector3());
  // Algunas extracciones vienen con Z como eje vertical: enderezar y remedir
  if (size.z > size.y * 1.3) {
    inner.rotation.x = -Math.PI / 2;
    bbox.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    bbox.getSize(size);
  }
  const s = TARGET_HEIGHT[id] / Math.max(size.y, 0.001);
  inner.scale.setScalar(s);
  inner.position.set(
    -(bbox.min.x + bbox.max.x) / 2 * s,
    -bbox.min.y * s,
    -(bbox.min.z + bbox.max.z) / 2 * s,
  );
  const pivot = new THREE.Group();
  pivot.rotation.y = Math.PI;
  pivot.add(inner);
  const root = new THREE.Group();
  root.add(pivot);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(...MUZZLE[id]);
  const indicator = buildAttackIndicator(CHARACTER_COLORS[id]);
  muzzle.add(indicator.group);
  root.add(muzzle);

  let lastTime = -1;
  const update = (pose: Pose, time: number): void => {
    const dt = lastTime < 0 ? 0 : Math.max(0, time - lastTime);
    lastTime = time;
    const walk = Math.min(1, pose.speed);
    if (mixer) {
      if (moveAction && idleAction) {
        moveAction.setEffectiveWeight(walk);
        idleAction.setEffectiveWeight(1 - walk);
      }
      mixer.update(dt);
    } else {
      // Sin animaciones en el archivo: trote y balanceo por código
      pivot.position.y = Math.abs(Math.sin(time * 9)) * 0.05 * walk;
      pivot.rotation.z = Math.sin(time * 9) * 0.06 * walk;
      pivot.rotation.y = Math.PI + Math.sin(time * 2.2) * 0.02;
    }
    // Agacharse: compresión vertical (igual que los procedurales)
    const targetS = pose.crouch ? 0.72 : 1;
    root.scale.y += (targetS - root.scale.y) * 0.25;
    // Ataque: pequeño retroceso del cuerpo
    pivot.position.z = pose.firing ? 0.05 : pivot.position.z * 0.8;
    // Habilidad/interacción: cabeceo de todo el cuerpo (sin acceso a huesos)
    const targetPitch = pose.throwing ? -0.3 : pose.interacting ? 0.25 : 0;
    pivot.rotation.x += (targetPitch - pivot.rotation.x) * 0.25;
    updateAttackIndicator(indicator, pose.weapon, time, pose.firing, pose.reloading);
  };

  return {
    root,
    muzzle,
    update,
    dispose: () => {
      mixer?.stopAllAction();
      // Geometrías/materiales/texturas pertenecen al GLTF en caché y se
      // comparten entre instancias: no se liberan aquí.
      for (const m of indicator.mats) m.dispose();
    },
  };
}
