import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneWithSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterId } from '@pta/shared';
import { EVO_SCALE } from '@pta/shared';
import {
  buildAttackIndicator, updateAttackIndicator, CHARACTER_COLORS,
  type CharacterModel, type Pose,
} from './models.js';

/**
 * Carga opcional de los modelos oficiales (ver ASSET_SOURCES.md). Prioridad:
 * .glb descargados en local (`npm run modelos:oficiales`); si faltan, el
 * navegador los obtiene del repositorio público de origen. Si tampoco hay
 * conexión, el juego sigue con los modelos procedurales propios.
 *
 * Los .glb usan compresión Draco (descodificador local, copiado de three.js)
 * y texturas WebP. Son mallas con esqueleto: se clonan con SkeletonUtils.
 * Animación por archivo:
 *  - clips reconocibles (idle/walk/run/fight): se reproducen y mezclan;
 *  - solo clip de ataque (Pikachu, «Impactrueno»): su primer fotograma es la
 *    pose de reposo y el clip se dispara al atacar;
 *  - sin clips (Charmander, Squirtle): ciclo de andar y gesto de ataque
 *    procedurales sobre los huesos (LThigh/RArm/Head/Jaw/Tail…), con
 *    correcciones de pose de reposo por personaje.
 */

const BASE = '/modelos-oficiales';

/**
 * Fuente remota (el repositorio público del que procede la descarga local).
 * Este proyecto NO aloja ni redistribuye los .glb: si no están descargados en
 * la copia local, el navegador los obtiene directamente de esa fuente
 * (sirve con `Access-Control-Allow-Origin: *`). Son propiedad de
 * Nintendo/Creatures Inc./GAME FREAK; ver ASSET_SOURCES.md.
 */
const REMOTO = 'https://raw.githubusercontent.com/pokemon-party/3d-pokemon/main/models/opt/regular';

/** Nº de Pokédex nacional por etapa evolutiva: nombre de archivo .glb. */
const DEX: Record<CharacterId, number[]> = {
  pikachu: [25, 26],
  charmander: [4, 5, 6],
  squirtle: [7, 8, 9],
  bulbasaur: [1, 2, 3],
  mewtwo: [150],
};

/** Punto de origen de los ataques (boca), tras normalizar la altura. */
const MUZZLE: Record<CharacterId, [number, number, number]> = {
  pikachu: [0, 0.95, -0.58],
  charmander: [0, 0.93, -0.6],
  squirtle: [0, 0.92, -0.58],
  bulbasaur: [0, 0.7, -0.78],
  mewtwo: [0, 1.0, -0.52],
};

/** Altura visual objetivo (los procedurales miden ≈1,4 m). */
const TARGET_HEIGHT: Record<CharacterId, number> = {
  pikachu: 1.35, charmander: 1.35, squirtle: 1.3, bulbasaur: 1.1, mewtwo: 1.45,
};

/**
 * Correcciones de la pose de reposo (rotaciones locales en radianes sobre el
 * hueso indicado). La pose de enlace de Charmander viene con los brazos en T
 * y una pierna levantada; sin clips que la tapen, se endereza aquí.
 */
const POSE_FIX: Partial<Record<string, [string, number, number, number][]>> = {
  'charmander:0': [
    ['larm', 0, 0, -0.9],
    ['rarm', 0, 0, 0.9],
    ['lthigh', -0.35, 0, 0],
    ['rthigh', 0.1, 0, 0],
    ['tail1', -0.45, 0, 0],
    ['tail2', -0.25, 0, 0],
    ['tail3', -0.15, 0, 0],
  ],
};

const cache = new Map<string, GLTF>(); // clave `${personaje}:${etapa}`
const cargando = new Set<string>();
let loader: GLTFLoader | null = null;
let loadPromise: Promise<boolean> | null = null;

function getLoader(): GLTFLoader {
  if (!loader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/'); // copiado de three (npm) en predev/prebuild
    loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
  }
  return loader;
}

/**
 * Intenta cargar los cuatro .glb (una sola vez; las llamadas posteriores
 * reutilizan el resultado). Devuelve true si están los cuatro.
 */
async function loadStage(id: CharacterId, stage: number): Promise<void> {
  const key = `${id}:${stage}`;
  if (cache.has(key) || cargando.has(key)) return;
  cargando.add(key);
  try {
    // Preferir la descarga local; si no existe, cargar de la fuente remota
    let url = `${BASE}/${DEX[id][stage]}.glb`;
    // HEAD previo: distingue un 404 real de un index.html de respaldo
    const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!head?.ok || (head.headers.get('content-type') ?? '').includes('text/html')) {
      url = `${REMOTO}/${DEX[id][stage]}.glb`;
    }
    const gltf = await getLoader().loadAsync(url);
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // la malla con esqueleto se desplaza fuera de su AABB original
      }
    });
    cache.set(key, gltf);
  } finally {
    cargando.delete(key);
  }
}

export function preloadOfficialModels(): Promise<boolean> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const jobs = (Object.keys(DEX) as CharacterId[]).map((id) => loadStage(id, 0));
    const results = await Promise.allSettled(jobs);
    const fallos = results.filter((r) => r.status === 'rejected');
    if (fallos.length) {
      console.info(
        `[modelos oficiales] ${fallos.length} de ${jobs.length} no disponibles (ni descarga local ni fuente remota); ` +
        'se usan los modelos propios.',
      );
    }
    return fallos.length === 0;
  })();
  return loadPromise;
}

/** Carga en segundo plano el .glb de una etapa evolutiva y reconstruye modelos al llegar. */
function ensureStage(id: CharacterId, stage: number): void {
  const key = `${id}:${stage}`;
  if (cache.has(key) || cargando.has(key)) return;
  void loadStage(id, stage)
    .then(() => window.dispatchEvent(new Event('pta-modelos')))
    .catch(() => { /* sin red: se mantiene el respaldo */ });
}

/** Huesos relevantes para la animación procedural, localizados por nombre. */
interface Huesos {
  lThigh?: THREE.Bone;
  rThigh?: THREE.Bone;
  lArm?: THREE.Bone;
  rArm?: THREE.Bone;
  head?: THREE.Bone;
  jaw?: THREE.Bone;
  spine?: THREE.Bone;
  tail: THREE.Bone[];
}

function buscarHuesos(root: THREE.Object3D): Huesos {
  const h: Huesos = { tail: [] };
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    const b = o as THREE.Bone;
    const n = b.name.toLowerCase();
    if (n.startsWith('lthigh')) h.lThigh = b;
    else if (n.startsWith('rthigh')) h.rThigh = b;
    else if (n.startsWith('larm')) h.lArm = b;
    else if (n.startsWith('rarm')) h.rArm = b;
    else if (n.startsWith('head')) h.head = b;
    else if (n.startsWith('jaw')) h.jaw = b;
    else if (n.startsWith('spine2')) h.spine = b;
    else if (/^tail\d/.test(n)) h.tail.push(b);
  });
  h.tail.sort((a, b) => a.name.localeCompare(b.name));
  return h;
}

/** Rotación relativa aplicada tras la pose base (o tras el mixer). */
const Q_TMP = new THREE.Quaternion();
const E_TMP = new THREE.Euler();
function girar(b: THREE.Bone | undefined, base: Map<THREE.Bone, THREE.Quaternion> | null, x: number, y = 0, z = 0): void {
  if (!b) return;
  Q_TMP.setFromEuler(E_TMP.set(x, y, z));
  if (base) {
    const q0 = base.get(b);
    if (q0) b.quaternion.copy(q0);
  }
  b.quaternion.multiply(Q_TMP);
}

/**
 * Crea una instancia del modelo oficial ya cargado, o null si no está en
 * caché (sin descarga, o preload aún en curso): el llamante usará el procedural.
 */
export function createOfficialModel(id: CharacterId, stage = 0): CharacterModel | null {
  const maxStage = DEX[id].length - 1;
  const wantStage = Math.min(stage, maxStage);
  let useStage = wantStage;
  if (!cache.has(`${id}:${useStage}`)) {
    // Etapa aún no descargada: pedirla en segundo plano y usar la mejor inferior
    ensureStage(id, wantStage);
    while (useStage > 0 && !cache.has(`${id}:${useStage}`)) useStage--;
  }
  const gltf = cache.get(`${id}:${useStage}`);
  if (!gltf) return null;
  const escala = EVO_SCALE[Math.min(wantStage, 2) as 0 | 1 | 2];

  const inner = cloneWithSkeleton(gltf.scene);
  const huesos = buscarHuesos(inner);

  // Correcciones de pose de reposo (antes de capturar la base y de medir)
  for (const [nombre, x, y, z] of POSE_FIX[`${id}:${useStage}`] ?? []) {
    inner.traverse((o) => {
      if ((o as THREE.Bone).isBone && o.name.toLowerCase().startsWith(nombre)) {
        (o as THREE.Bone).rotation.x += x;
        (o as THREE.Bone).rotation.y += y;
        (o as THREE.Bone).rotation.z += z;
      }
    });
  }

  // Clips del archivo: idle/andar mezclados por velocidad y ataque de un disparo
  let mixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let moveAction: THREE.AnimationAction | null = null;
  let attackAction: THREE.AnimationAction | null = null;
  let attackActions: THREE.AnimationAction[] = []; // rotación entre varios ataques
  let attackIdx = 0;
  let attackEsPose = false; // el clip de ataque hace también de pose de reposo (Pikachu)
  const clips = gltf.animations;
  if (clips.length) {
    const find = (re: RegExp): THREE.AnimationClip | undefined => clips.find((c) => re.test(c.name));
    // Postura de combate si existe (Mewtwo trae battlewait además de defaultwait)
    const idleClip = find(/battlewait/i) ?? find(/idle|wait|reposo/i);
    const moveClip = find(/run/i) ?? find(/walk|andar/i);
    // Ataques: preferir el ataque a distancia (disparamos) y rotar entre los que haya
    const attackPool = clips.filter((c) => /rangeattack01$|attack0\d$|fight_[a-z]$|impactrueno|atk\b|shot/i.test(c.name));
    attackPool.sort((a, b) => Number(/rangeattack/i.test(b.name)) - Number(/rangeattack/i.test(a.name)));
    const attackClip = attackPool[0] ?? find(/fight|attack|atk|impactrueno|shot/i);
    mixer = new THREE.AnimationMixer(inner);
    if (idleClip) {
      idleAction = mixer.clipAction(idleClip);
      idleAction.play();
      if (moveClip && moveClip !== idleClip) {
        moveAction = mixer.clipAction(moveClip);
        moveAction.setEffectiveWeight(0);
        moveAction.play();
      }
      attackActions = attackPool.slice(0, 4).map((c) => {
        const a = mixer!.clipAction(c);
        a.setLoop(THREE.LoopOnce, 1);
        a.timeScale = 1.35; // más chispa: los clips de los juegos son pausados
        return a;
      });
      mixer.update(0);
    } else if (attackClip) {
      // Sin idle: el primer fotograma del ataque es la pose de reposo; el clip
      // completo se reproduce al atacar y al terminar se vuelve a congelar.
      attackAction = mixer.clipAction(attackClip);
      attackAction.setLoop(THREE.LoopOnce, 1);
      attackAction.timeScale = 1.5;
      attackAction.play();
      attackAction.paused = true;
      attackEsPose = true;
      mixer.addEventListener('finished', () => {
        attackAction!.reset();
        attackAction!.paused = true;
      });
      mixer.update(0);
    } else {
      // Clips irreconocibles: congelar el primero como pose estática
      mixer.clipAction(clips[0]).play();
      mixer.update(0);
      mixer = null;
    }
  }

  // Sin mixer activo, la animación procedural parte de la pose base capturada
  const baseQ: Map<THREE.Bone, THREE.Quaternion> | null = mixer ? null : new Map();
  if (baseQ) {
    for (const b of [huesos.lThigh, huesos.rThigh, huesos.lArm, huesos.rArm, huesos.head, huesos.jaw, huesos.spine, ...huesos.tail]) {
      if (b) baseQ.set(b, b.quaternion.clone());
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
  const s = TARGET_HEIGHT[id] * escala / Math.max(size.y, 0.001);
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
  const [mx, my, mz] = MUZZLE[id];
  muzzle.position.set(mx, my * escala, mz * escala);
  const indicator = buildAttackIndicator(CHARACTER_COLORS[id]);
  muzzle.add(indicator.group);
  root.add(muzzle);

  let lastTime = -1;
  let prevFiring = false;
  const update = (pose: Pose, time: number): void => {
    const dt = lastTime < 0 ? 0 : Math.max(0, time - lastTime);
    lastTime = time;
    const walk = Math.min(1, pose.speed);
    const disparoNuevo = pose.firing && !prevFiring;
    prevFiring = pose.firing;

    if (mixer) {
      if (disparoNuevo) {
        if (attackEsPose && attackAction) {
          attackAction.reset();
          attackAction.paused = false;
        } else if (attackActions.length > 0) {
          // Rotar entre los ataques del archivo (p. ej. rangeattack01/attack01/attack02)
          attackActions[attackIdx % attackActions.length].reset().fadeIn(0.06).play();
          attackIdx++;
        }
      }
      if (moveAction && idleAction) {
        const atacando = attackActions.some((a) => a.isRunning() && !a.paused);
        moveAction.setEffectiveWeight(atacando ? walk * 0.3 : walk);
        idleAction.setEffectiveWeight(atacando ? 0.15 : 1 - walk);
      }
      mixer.update(dt);
      // Modelos cuya única animación es el ataque (pose congelada): ciclo de
      // andar procedural sobre la pose que el mixer reescribe cada fotograma
      if (attackEsPose && attackAction?.paused) {
        const t = time * 9;
        const swing = Math.sin(t) * 0.55 * walk;
        girar(huesos.lThigh, null, swing);
        girar(huesos.rThigh, null, -swing);
        girar(huesos.lArm, null, -swing * 0.7);
        girar(huesos.rArm, null, swing * 0.7);
        huesos.tail.forEach((b, i) => {
          girar(b, null, 0, Math.sin(time * 2.6 + i * 0.55) * (0.1 + walk * 0.08), 0);
        });
        pivot.position.y = Math.abs(Math.sin(t)) * 0.04 * walk;
      }
    } else {
      pivot.rotation.y = Math.PI + Math.sin(time * 2.2) * 0.02;
    }

    // Animación procedural sobre huesos: andar y gesto de ataque cuando el
    // archivo no trae esos clips (base fija) o para enriquecer la pose (cola)
    if (baseQ) {
      const t = time * 9;
      const swing = Math.sin(t) * 0.55 * walk;
      girar(huesos.lThigh, baseQ, swing);
      girar(huesos.rThigh, baseQ, -swing);
      girar(huesos.lArm, baseQ, -swing * 0.7);
      girar(huesos.rArm, baseQ, swing * 0.7);
      // Ataque: mordida/cabeceo; habilidad: cabeza atrás
      const ataque = pose.firing ? 1 : 0;
      girar(huesos.jaw, baseQ, 0.35 * ataque);
      girar(huesos.head, baseQ, -0.18 * ataque + (pose.throwing ? -0.35 : 0) + Math.sin(time * 2.2) * 0.03);
      girar(huesos.spine, baseQ, 0.08 * ataque);
      // Cola: vaivén continuo, más vivo al correr
      huesos.tail.forEach((b, i) => {
        girar(b, baseQ, 0, Math.sin(time * 2.6 + i * 0.55) * (0.1 + walk * 0.08), 0);
      });
      // Trote vertical ligero
      pivot.position.y = Math.abs(Math.sin(t)) * 0.04 * walk;
    }

    // Agacharse: compresión vertical (igual que los procedurales)
    const targetS = pose.crouch ? 0.72 : 1;
    root.scale.y += (targetS - root.scale.y) * 0.25;
    // Ataque: pequeño retroceso del cuerpo
    pivot.position.z = pose.firing ? 0.05 : pivot.position.z * 0.8;
    // Habilidad/interacción: cabeceo de todo el cuerpo
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
