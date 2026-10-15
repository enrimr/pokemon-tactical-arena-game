import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterId, CoreState, MapDef, PickupState, ProjectileState, SolidBox, SolidTag, Vec3, WeaponId, ZoneState } from '@pta/shared';
import { HEAD_OFFSET, HEAD_OFFSET_CROUCH, HEAD_SPHERE_RADIUS } from '@pta/shared';
import {
  CharacterModel, createCharacterModel, CHARACTER_COLORS, Pose,
  buildAttackIndicator, updateAttackIndicator,
} from './models.js';
import { settings } from './settings.js';
import { createAttackFx, createExplosionFx, type AttackFx } from './attackFx.js';

// Texturas CC0 de ambientCG (ver ASSET_SOURCES.md) servidas desde /texturas.
// `tint` sustituye al color plano cuando la textura carga (el mapa multiplica el color).
interface TagTexture { base: string; tint: number; metal?: boolean }
const TAG_TEXTURE: Partial<Record<SolidTag, TagTexture>> = {
  suelo: { base: 'hormigon-suelo', tint: 0xffffff },
  rampa: { base: 'hormigon-suelo', tint: 0xe9eced },
  muro: { base: 'yeso-muro', tint: 0xf0f3f4 },
  muroBajo: { base: 'yeso-muro', tint: 0xd3dadd },
  pilar: { base: 'yeso-muro', tint: 0xdfe6ea },
  pasarela: { base: 'chapa-metal', tint: 0xb6c3d2, metal: true },
  caja: { base: 'placas-metal', tint: 0xa9c0d8, metal: true },
  cajaBaja: { base: 'madera', tint: 0xdce3cd },
  jardinera: { base: 'madera', tint: 0x9cc488 },
  tuberia: { base: 'metal-oxidado', tint: 0xdfa968, metal: true },
  tronco: { base: 'madera', tint: 0xc98f5e },
  valla: { base: 'madera', tint: 0xe3c492 },
  casa: { base: 'yeso-muro', tint: 0xfaf0dc },
};

const TAG_STYLE: Record<SolidTag, { color: number; roughness?: number; emissive?: number }> = {
  suelo: { color: 0xd3d7d9 },
  muro: { color: 0xc9cfd2 },
  muroBajo: { color: 0xb5bcbf },
  caja: { color: 0x7f93a8 },
  cajaBaja: { color: 0x9aa48c },
  pilar: { color: 0xb3bac0 },
  rampa: { color: 0xbdc3c6 },
  pasarela: { color: 0x8894a3 },
  puerta: { color: 0x3f6fd6, emissive: 0x1b3f91 },
  jardinera: { color: 0x5c8d4e },
  tuberia: { color: 0xb0763b },
  panel: { color: 0x2a3d66, emissive: 0x0e1c3a },
  // Tags temáticos (Bosque Verde / Pueblo Paleta)
  seto: { color: 0x3f8a3c, roughness: 1 },
  tronco: { color: 0x8a5a2d },
  agua: { color: 0x4f9fd8, roughness: 0.15 },
  casa: { color: 0xf2e8d2 },
  tejado: { color: 0xd8574a, roughness: 0.7 },
  valla: { color: 0xd9b98a },
};

export interface PlayerView {
  id: number;
  character: CharacterId;
  team: number;
  pos: Vec3;
  yaw: number;
  speed: number;
  evoStage: number;
  crouching: boolean;
  alive: boolean;
  hasCore: boolean;
  firing: boolean;
  reloading: boolean;
  throwing: boolean;
  interacting: boolean;
  esBot: boolean;
  nombre: string;
  weapon: WeaponId;
}

interface PuffFx { sprite: THREE.Sprite; until: number; vel: THREE.Vector3; }

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private map: MapDef;
  private doors: THREE.Object3D[] = [];
  private models = new Map<number, { model: CharacterModel; marker: THREE.Sprite; character: CharacterId; evoStage: number }>();
  private zoneFx = new Map<number, THREE.Group>();
  private projFx = new Map<number, THREE.Mesh>();
  private pickupFx = new Map<number, THREE.Group>();
  private pokeballTemplate!: THREE.Group;
  private auraTemplates = new Map<number, THREE.Group>();
  private auraRingMats = new Map<number, THREE.MeshBasicMaterial>();
  private attackFx: AttackFx[] = [];
  private puffs: PuffFx[] = [];
  private coreMesh: THREE.Group;
  private sun!: THREE.DirectionalLight;
  private fpGroup = new THREE.Group();
  private fpPawL!: THREE.Mesh;
  private fpPawR!: THREE.Mesh;
  private fpIndicator = buildAttackIndicator(0xffe84a, 0.32);
  private fpWeapon: WeaponId = 'pulso';
  private fpReloading = false;
  private fpTime = 0;
  private recoil = 0;
  private debugHeads: THREE.Mesh[] = [];
  debugHitboxes = false;
  private disposables: { dispose(): void }[] = [];

  constructor(container: HTMLElement, map: MapDef) {
    this.container = container;
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ antialias: settings.calidad !== 'baja', powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = settings.calidad !== 'baja';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 220);
    this.scene.add(this.camera);

    this.scene.background = new THREE.Color(map.theming.cielo);
    this.scene.fog = new THREE.Fog(map.theming.niebla, 70, 170);
    this.buildLights();
    this.buildMap();
    this.buildFirstPerson();
    this.coreMesh = this.buildCore();
    this.scene.add(this.coreMesh);
    this.pokeballTemplate = this.buildPokeball();
    this.applyQuality();
    this.resize();
    // Al cambiar el ajuste de modelos (oficiales/propios), reconstruirlos
    window.addEventListener('pta-modelos', this.onModelsChanged);
  }

  private onModelsChanged = (): void => {
    this.removeAllPlayers(); // se recrean en el siguiente updatePlayers
  };

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x8e8574, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.4);
    sun.position.set(26, 38, -14);
    sun.castShadow = settings.calidad !== 'baja';
    sun.shadow.mapSize.setScalar(settings.calidad === 'alta' ? 2048 : 1024);
    const s = 42;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0004;
    this.sun = sun;
    this.scene.add(sun);
    const amb = new THREE.AmbientLight(0xfff4e0, 0.25);
    this.scene.add(amb);
  }

  private boxGeometry(b: SolidBox): THREE.BufferGeometry {
    const w = b.max.x - b.min.x;
    const h = b.max.y - b.min.y;
    const d = b.max.z - b.min.z;
    const g = new THREE.BoxGeometry(w, h, d);
    // UV a escala mundial (1 azulejo = 2,5 m) para que la textura no se estire
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const faceDims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const TILE = 2.5;
    for (let f = 0; f < 6; f++) {
      const [du, dv] = faceDims[f];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * (du / TILE), uv.getY(i) * (dv / TILE));
      }
    }
    g.translate(b.min.x + w / 2, b.min.y + h / 2, b.min.z + d / 2);
    return g;
  }

  /** Textura de hormigón procedural (ruido suave + juntas) para evitar superficies planas. */
  private concreteTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#d8dadb';
    ctx.fillRect(0, 0, 256, 256);
    let s = 12345;
    const rnd = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < 2600; i++) {
      const v = 200 + Math.floor(rnd() * 46);
      ctx.fillStyle = `rgba(${v},${v + 2},${v + 4},0.35)`;
      ctx.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
    }
    ctx.strokeStyle = 'rgba(130,138,146,0.5)';
    ctx.lineWidth = 1.5;
    for (const p of [64, 128, 192]) {
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(256, p); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    this.disposables.push(tex);
    return tex;
  }

  /**
   * Carga en diferido las texturas descargadas (CC0, ambientCG) y las aplica a los
   * materiales por tag. Cada archivo se carga una sola vez aunque lo compartan varios
   * tags; hasta que llega (o si falta, p. ej. sin `npm run texturas`), queda el
   * hormigón procedural o el color plano.
   */
  private aplicarTexturasMapa(mats: { mat: THREE.MeshStandardMaterial; cfg: TagTexture }[]): void {
    const loader = new THREE.TextureLoader();
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const porBase = new Map<string, { mat: THREE.MeshStandardMaterial; cfg: TagTexture }[]>();
    for (const e of mats) {
      const list = porBase.get(e.cfg.base) ?? [];
      list.push(e);
      porBase.set(e.cfg.base, list);
    }
    const configurar = (tex: THREE.Texture, srgb: boolean): void => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = aniso;
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      this.disposables.push(tex);
    };
    for (const [base, list] of porBase) {
      loader.load(`/texturas/${base}_color.jpg`, (tex) => {
        configurar(tex, true);
        for (const { mat, cfg } of list) {
          mat.map = tex;
          mat.color.set(cfg.tint);
          // Sin mapa de entorno, metalness alto solo oscurece el difuso: usar un toque leve
          if (cfg.metal) {
            mat.metalness = 0.15;
            mat.roughness = 0.65;
          }
          mat.needsUpdate = true;
        }
      });
      if (settings.calidad !== 'baja') {
        loader.load(`/texturas/${base}_normal.jpg`, (tex) => {
          configurar(tex, false);
          for (const { mat } of list) {
            mat.normalMap = tex;
            mat.normalScale.set(0.8, 0.8);
            mat.needsUpdate = true;
          }
        });
      }
    }
  }

  /** Textura de follaje procedural para los setos/hileras de árboles. */
  private foliageTexture(): THREE.CanvasTexture {
    const tex = this.canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = '#39702f';
      ctx.fillRect(0, 0, 256, 256);
      let s = 97;
      const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const verdes = ['#447f36', '#51963f', '#3c7a33', '#5ca648', '#2f6629'];
      for (let i = 0; i < 420; i++) {
        ctx.fillStyle = verdes[i % verdes.length];
        const r = 6 + rnd() * 14;
        ctx.beginPath();
        ctx.ellipse(rnd() * 256, rnd() * 256, r, r * 0.7, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      // Sombras entre copas
      ctx.fillStyle = 'rgba(20,45,18,0.35)';
      for (let i = 0; i < 70; i++) {
        const r = 4 + rnd() * 10;
        ctx.beginPath();
        ctx.ellipse(rnd() * 256, rnd() * 256, r, r * 0.6, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  private buildMap(): void {
    const concrete = this.concreteTexture();
    const texturedTags = new Set<SolidTag>(['muro', 'muroBajo', 'suelo', 'rampa', 'pilar', 'pasarela', 'caja', 'cajaBaja']);
    const pendientes: { mat: THREE.MeshStandardMaterial; cfg: TagTexture }[] = [];
    const byTag = new Map<SolidTag, THREE.BufferGeometry[]>();
    for (const b of this.map.solids) {
      if (b.door) {
        const style = TAG_STYLE.puerta;
        const m = new THREE.Mesh(
          this.boxGeometry(b),
          new THREE.MeshStandardMaterial({
            color: style.color, emissive: style.emissive ?? 0, emissiveIntensity: 0.5,
            transparent: true, opacity: 0.85, roughness: 0.4,
          }),
        );
        m.castShadow = true;
        this.doors.push(m);
        this.scene.add(m);
        continue;
      }
      const list = byTag.get(b.tag) ?? [];
      list.push(this.boxGeometry(b));
      byTag.set(b.tag, list);
    }
    for (const d of this.map.decor) {
      const list = byTag.get(d.tag) ?? [];
      list.push(this.boxGeometry(d));
      byTag.set(d.tag, list);
    }
    const sueloVerde = this.map.id !== 'aurora'; // Bosque Verde y Pueblo Paleta: césped
    for (const [tag, geos] of byTag) {
      const style = TAG_STYLE[tag];
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: tag === 'suelo' && sueloVerde ? 0x86b573 : style.color,
        roughness: style.roughness ?? 0.92,
        metalness: 0.04,
        emissive: style.emissive ?? 0,
        emissiveIntensity: style.emissive ? 0.35 : 0,
        map: tag === 'seto' ? this.foliageTexture()
          : texturedTags.has(tag) && !(tag === 'suelo' && sueloVerde) ? concrete : null,
      });
      if (tag === 'agua') {
        mat.transparent = true;
        mat.opacity = 0.8;
      }
      let cfg = TAG_TEXTURE[tag];
      if (tag === 'suelo' && sueloVerde) {
        cfg = { base: 'cesped', tint: this.map.id === 'bosque' ? 0xd8eccc : 0xeef7dd };
      }
      if (cfg) pendientes.push({ mat, cfg });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = tag !== 'suelo' && tag !== 'agua';
      this.scene.add(mesh);
      this.disposables.push(merged, mat);
      // Contornos discretos en coberturas
      if (settings.calidad !== 'baja' && (tag === 'caja' || tag === 'cajaBaja' || tag === 'jardinera' || tag === 'pasarela')) {
        const edges = new THREE.EdgesGeometry(merged, 30);
        const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x3c4650, transparent: true, opacity: 0.4 }));
        this.scene.add(lines);
        this.disposables.push(edges);
      }
    }
    this.aplicarTexturasMapa(pendientes);
    this.buildSiteMarkers();
    this.buildVegetation();
    this.buildPokemonTheming();
  }

  private textSprite(text: string, color: string, size = 160): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(20,30,40,0.9)';
    ctx.lineWidth = 14;
    ctx.strokeText(text, 128, 134);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 134);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.disposables.push(tex);
    return sprite;
  }

  private buildSiteMarkers(): void {
    for (const site of this.map.sites) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(site.radius - 0.18, site.radius, 48),
        new THREE.MeshBasicMaterial({ color: 0xffb13d, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(site.center.x, 0.03, site.center.z);
      this.scene.add(ring);
      const label = this.textSprite(site.id, '#ffd27d');
      label.position.set(site.label.x, site.label.y + 0.6, site.label.z);
      label.scale.setScalar(2.4);
      this.scene.add(label);
    }
    // Señalización lateral (las antesalas llevan letreros de madera, ver buildPokemonTheming)
    const signs: { text: string; pos: [number, number, number] }[] = [
      { text: 'A', pos: [-25.2, 2.8, 1] },
      { text: 'B', pos: [25.2, 2.8, 1] },
    ];
    for (const s of signs) {
      const spr = this.textSprite(s.text, '#9fd1ff', 120);
      spr.position.set(...s.pos);
      spr.scale.set(2.2, 1.4, 1);
      this.scene.add(spr);
    }
  }

  private buildVegetation(): void {
    // Arbustos decorativos definidos por el mapa (visual, sin colisión)
    const bush = new THREE.SphereGeometry(1, 8, 6);
    const matBush = new THREE.MeshStandardMaterial({ color: 0x4f8f45, roughness: 0.95 });
    for (const { x, z } of this.map.theming.arbustos) {
      const b = new THREE.Mesh(bush, matBush);
      const s = 0.5 + ((Math.abs(x) * 13 + Math.abs(z) * 7) % 10) / 25;
      b.scale.set(s, s * 0.8, s);
      b.position.set(x, s * 0.5, z);
      b.castShadow = true;
      this.scene.add(b);
    }
    this.disposables.push(bush, matBush);

    // Árboles decorativos (tronco + copa), fusionados en dos mallas
    const arboles = this.map.theming.arboles;
    if (arboles.length > 0) {
      const troncos: THREE.BufferGeometry[] = [];
      const copas: THREE.BufferGeometry[] = [];
      const trunkBase = new THREE.CylinderGeometry(0.22, 0.3, 3.4, 7);
      const copaBase = new THREE.SphereGeometry(1, 9, 7);
      for (const { pos, s } of arboles) {
        const t = trunkBase.clone();
        t.scale(s, s, s);
        t.translate(pos.x, pos.y + 1.7 * s, pos.z);
        troncos.push(t);
        for (const [dx, dy, dz, r] of [[0, 4.1, 0, 1.6], [0.9, 3.4, 0.5, 1.1], [-0.8, 3.5, -0.5, 1.1]] as const) {
          const c = copaBase.clone();
          c.scale(r * s, r * 0.85 * s, r * s);
          c.translate(pos.x + dx * s, pos.y + dy * s, pos.z + dz * s);
          copas.push(c);
        }
      }
      trunkBase.dispose();
      copaBase.dispose();
      const matTronco = new THREE.MeshStandardMaterial({ color: 0x7a4e26, roughness: 0.95 });
      const matCopa = new THREE.MeshStandardMaterial({ color: 0x47953e, roughness: 0.95 });
      for (const [geos, m] of [[troncos, matTronco], [copas, matCopa]] as const) {
        const merged = mergeGeometries(geos);
        geos.forEach((g) => g.dispose());
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, m);
        mesh.castShadow = settings.calidad === 'alta'; // muchas copas: sombra solo en calidad alta
        this.scene.add(mesh);
        this.disposables.push(merged, m);
      }
    }
  }

  // ===== Ambientación del mundo Pokémon (texturas canvas generadas localmente,
  // inspiradas en los mapas, ciudades y rutas de los juegos; nada extraído) =====

  private canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d')!);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.disposables.push(t);
    return t;
  }

  /** Mural «mapa de la región»: ciudades de colores unidas por rutas, estilo Town Map. */
  private regionMapTexture(): THREE.CanvasTexture {
    return this.canvasTex(512, 288, (ctx) => {
      // Mar, marco y masa de tierra
      ctx.fillStyle = '#6db6de';
      ctx.fillRect(0, 0, 512, 288);
      ctx.fillStyle = '#8fd07c';
      ctx.beginPath();
      ctx.roundRect(42, 46, 428, 210, 46);
      ctx.fill();
      ctx.strokeStyle = '#5a9c54';
      ctx.lineWidth = 5;
      ctx.stroke();
      // Ciudades (cuadrados de color, como el Mapa del Pueblo) y rutas que las unen
      const ciudades: [number, number, string, string][] = [
        [92, 218, '#f5f5f5', 'Pueblo Paleta'],
        [92, 128, '#58b84e', 'C. Verde'],
        [140, 72, '#b9c3cc', 'C. Plateada'],
        [268, 70, '#5aa8e8', 'C. Celeste'],
        [392, 86, '#e8c04a', 'C. Azafrán'],
        [432, 160, '#e85a4a', 'C. Carmín'],
        [330, 206, '#a86ee0', 'P. Lavanda'],
        [196, 226, '#e87ab0', 'C. Fucsia'],
      ];
      ctx.strokeStyle = '#e8dcae';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      for (let i = 0; i < ciudades.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(ciudades[i][0], ciudades[i][1]);
        ctx.lineTo(ciudades[i + 1][0], ciudades[i + 1][1]);
        ctx.stroke();
      }
      for (const [x, y, color, nombre] of ciudades) {
        ctx.fillStyle = color;
        ctx.strokeStyle = '#2c3a2e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(x - 11, y - 11, 22, 22, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#243324';
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(nombre, x, y - 18);
      }
      // La estación del mapa jugable, marcada con una estrella
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText('★', 262, 156);
      ctx.fillStyle = '#243324';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(this.map.name, 262, 176);
      // Título
      ctx.fillStyle = 'rgba(20,36,48,0.85)';
      ctx.fillRect(0, 0, 512, 30);
      ctx.fillStyle = '#eaf4fa';
      ctx.font = 'bold 19px system-ui, sans-serif';
      ctx.fillText('MAPA DE LA REGIÓN', 256, 22);
    });
  }

  /** Letrero de ruta de madera (como los postes de las rutas de los juegos). */
  private woodSignTexture(texto: string): THREE.CanvasTexture {
    return this.canvasTex(256, 128, (ctx) => {
      ctx.fillStyle = '#8a5a2d';
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = 'rgba(70,42,16,0.6)';
      ctx.lineWidth = 2;
      for (const y of [32, 64, 96]) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
      }
      ctx.strokeStyle = '#5e3b1a';
      ctx.lineWidth = 10;
      ctx.strokeRect(0, 0, 256, 128);
      ctx.fillStyle = '#f7ecd2';
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(texto, 128, 66);
    });
  }

  /** Marca de pokéball para el suelo de las zonas (vista cenital). */
  private pokeballDecalTexture(): THREE.CanvasTexture {
    return this.canvasTex(256, 256, (ctx) => {
      ctx.clearRect(0, 0, 256, 256);
      const cx = 128, cy = 128, r = 118;
      ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.closePath();
      ctx.fillStyle = '#e8352e'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI); ctx.closePath();
      ctx.fillStyle = '#f4f6f7'; ctx.fill();
      ctx.fillStyle = '#20262b';
      ctx.fillRect(cx - r, cy - 10, r * 2, 20);
      ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.fillStyle = '#20262b'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.fillStyle = '#f4f6f7'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#20262b'; ctx.lineWidth = 8; ctx.stroke();
    });
  }

  /** Mata de hierba alta (hojas sobre fondo transparente, como la hierba de las rutas). */
  private tallGrassTexture(): THREE.CanvasTexture {
    return this.canvasTex(128, 128, (ctx) => {
      ctx.clearRect(0, 0, 128, 128);
      const verdes = ['#2e7a33', '#3e8f3e', '#55b04b', '#47a040'];
      let s = 7;
      const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < 14; i++) {
        const x = 10 + rnd() * 108;
        const h = 55 + rnd() * 65;
        const w = 7 + rnd() * 9;
        const lean = (rnd() - 0.5) * 26;
        ctx.fillStyle = verdes[i % verdes.length];
        ctx.beginPath();
        ctx.moveTo(x - w / 2, 128);
        ctx.quadraticCurveTo(x - w / 4 + lean / 2, 128 - h * 0.6, x + lean, 128 - h);
        ctx.quadraticCurveTo(x + w / 4 + lean / 2, 128 - h * 0.6, x + w / 2, 128);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  private buildPokemonTheming(): void {
    // Murales del mapa de la región en los muros de los spawns y de las plazas
    const mapa = this.regionMapTexture();
    const matMural = new THREE.MeshStandardMaterial({ map: mapa, roughness: 0.85, metalness: 0 });
    const muralGeo = new THREE.PlaneGeometry(4.4, 2.45);
    for (const m of this.map.theming.murales) {
      const mural = new THREE.Mesh(muralGeo, matMural);
      mural.position.set(m.pos.x, m.pos.y, m.pos.z);
      mural.rotation.y = m.rotY;
      this.scene.add(mural);
    }
    this.disposables.push(muralGeo, matMural);

    // Marca de pokéball bajo los anillos de las zonas A y B
    const decalTex = this.pokeballDecalTexture();
    const decalGeo = new THREE.CircleGeometry(2.1, 40);
    const matDecal = new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, opacity: 0.9, depthWrite: false });
    for (const site of this.map.sites) {
      const d = new THREE.Mesh(decalGeo, matDecal);
      d.rotation.x = -Math.PI / 2;
      d.position.set(site.center.x, 0.045, site.center.z);
      this.scene.add(d);
    }
    this.disposables.push(decalGeo, matDecal);

    // Letreros de madera de ruta en las antesalas (sin colisión, como los arbustos)
    const matPoste = new THREE.MeshStandardMaterial({ color: 0x6e4421, roughness: 0.9 });
    const posteGeo = new THREE.BoxGeometry(0.09, 1.5, 0.09);
    const boardGeo = new THREE.PlaneGeometry(1.7, 0.85);
    for (const l of this.map.theming.letreros) {
      const g = new THREE.Group();
      const poste = new THREE.Mesh(posteGeo, matPoste);
      poste.position.y = 0.75;
      poste.castShadow = true;
      const matBoard = new THREE.MeshStandardMaterial({ map: this.woodSignTexture(l.texto), roughness: 0.9 });
      // El tablón va clavado por delante del poste
      const board = new THREE.Mesh(boardGeo, matBoard);
      board.position.set(0, 1.3, 0.07);
      const dorso = new THREE.Mesh(boardGeo, matPoste);
      dorso.position.set(0, 1.3, 0.058);
      dorso.rotation.y = Math.PI;
      g.add(poste, board, dorso);
      g.position.set(l.pos.x, l.pos.y, l.pos.z);
      g.rotation.y = l.rotY;
      this.scene.add(g);
      this.disposables.push(matBoard);
    }
    this.disposables.push(posteGeo, boardGeo, matPoste);

    // Hierba alta: matas de dos planos cruzados, fusionadas en una sola malla
    const grassTex = this.tallGrassTexture();
    const matGrass = new THREE.MeshStandardMaterial({
      map: grassTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1,
    });
    const planos: THREE.BufferGeometry[] = [];
    const base = new THREE.PlaneGeometry(0.8, 0.55);
    base.translate(0, 0.275, 0); // apoyada en el suelo
    for (const { pos, s } of this.map.theming.hierba) {
      for (const rot of [0.3 + pos.x * 0.1, 0.3 + pos.x * 0.1 + Math.PI / 2]) {
        const p = base.clone();
        p.scale(s, s, 1);
        p.rotateY(rot);
        p.translate(pos.x, pos.y, pos.z);
        planos.push(p);
      }
    }
    base.dispose();
    const merged = mergeGeometries(planos);
    planos.forEach((p) => p.dispose());
    if (merged) {
      const hierba = new THREE.Mesh(merged, matGrass);
      this.scene.add(hierba);
      this.disposables.push(merged, matGrass);
    }
  }

  private buildFirstPerson(): void {
    // Extremidades estilizadas del Pokémon propio (sin manos humanas ni armas)
    const paw = new THREE.SphereGeometry(1, 12, 10);
    this.fpPawL = new THREE.Mesh(paw, new THREE.MeshStandardMaterial({ color: 0xf7d02c, roughness: 0.8 }));
    this.fpPawR = this.fpPawL.clone();
    this.fpPawL.scale.set(0.028, 0.022, 0.05);
    this.fpPawR.scale.set(0.028, 0.022, 0.05);
    this.fpPawL.position.set(-0.16, -0.155, -0.32);
    this.fpPawR.position.set(0.16, -0.155, -0.32);
    this.fpIndicator.group.position.set(0, -0.165, -0.52);
    this.fpGroup.add(this.fpPawL, this.fpPawR, this.fpIndicator.group);
    this.camera.add(this.fpGroup);
  }

  setFirstPersonWeapon(w: WeaponId, reloading: boolean): void {
    this.fpWeapon = w;
    this.fpReloading = reloading;
  }

  setFirstPersonCharacter(char: CharacterId): void {
    const color = { pikachu: 0xf7d02c, charmander: 0xee8130, squirtle: 0x6390f0, bulbasaur: 0x59b5a2, mewtwo: 0xcbb3e3 }[char];
    (this.fpPawL.material as THREE.MeshStandardMaterial).color.set(color);
    for (const m of this.fpIndicator.mats) m.color.set(CHARACTER_COLORS[char]);
  }

  private buildCore(): THREE.Group {
    const g = new THREE.Group();
    const octa = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22),
      new THREE.MeshStandardMaterial({ color: 0x53e0e8, emissive: 0x1a9ba3, emissiveIntensity: 1.2, roughness: 0.3 }),
    );
    g.add(octa);
    const glow = this.textSprite('◆', '#9ff3f7', 150);
    glow.scale.setScalar(0.9);
    g.add(glow);
    return g;
  }

  /** Pokéball clásica: media esfera roja, media blanca, banda y botón central. */
  private buildPokeball(): THREE.Group {
    const g = new THREE.Group();
    const R = 0.22;
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(R, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xe8352e, roughness: 0.35, emissive: 0x5a0f0c, emissiveIntensity: 0.35 }),
    );
    const bottom = new THREE.Mesh(
      new THREE.SphereGeometry(R, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.35, emissive: 0x3a3e42, emissiveIntensity: 0.2 }),
    );
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 1.01, R * 1.01, R * 0.22, 20, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x20262b, roughness: 0.5 }),
    );
    const button = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.28, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fd9ff, emissiveIntensity: 0.8, roughness: 0.2 }),
    );
    button.position.z = R * 0.95;
    // Halo radial suave (un sprite sin textura se dibuja como un cuadrado)
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,243,176,0.85)');
    grad.addColorStop(0.5, 'rgba(255,243,176,0.25)');
    grad.addColorStop(1, 'rgba(255,243,176,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(c);
    this.disposables.push(glowTex);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.scale.setScalar(1.0);
    g.add(top, bottom, band, button, glow);
    for (const m of [top, bottom, band, button]) {
      m.castShadow = true;
      this.disposables.push(m.geometry, m.material as THREE.Material);
    }
    this.disposables.push(glow.material);
    return g;
  }

  updatePickups(pickups: PickupState[], time: number): void {
    const seen = new Set<number>();
    for (const pk of pickups) {
      seen.add(pk.id);
      let g = this.pickupFx.get(pk.id);
      if (!g) {
        g = this.pokeballTemplate.clone(); // comparte geometrías y materiales
        this.scene.add(g);
        this.pickupFx.set(pk.id, g);
      }
      g.position.set(pk.pos.x, pk.pos.y + 0.42 + Math.sin(time * 2.2 + pk.id) * 0.07, pk.pos.z);
      g.rotation.y = time * 1.1 + pk.id;
    }
    for (const [id, g] of this.pickupFx) {
      if (!seen.has(id)) {
        // Recogida: destello breve donde estaba
        this.spawnPuff({ x: g.position.x, y: g.position.y, z: g.position.z }, 0xfff3b0, 0.45);
        this.scene.remove(g);
        this.pickupFx.delete(id);
      }
    }
  }

  setDoorsClosed(closed: boolean): void {
    for (const d of this.doors) d.visible = closed;
  }

  /**
   * Aura de color del equipo bajo cada Pokémon (azul/naranja): anillo en los
   * pies + halo suave. Identifica el bando con cualquier modelo (propio u
   * oficial) y desde cualquier ángulo.
   */
  private buildTeamAura(team: number): THREE.Group {
    let template = this.auraTemplates.get(team);
    if (!template) {
      const color = team === 0 ? 0x4f8dff : 0xff9a3d;
      template = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.47, 28), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      // Halo radial (reutiliza el degradado del canvas)
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d')!;
      const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.scale.setScalar(1.5);
      glow.position.y = 0.25;
      template.add(ring, glow);
      this.auraTemplates.set(team, template);
      this.auraRingMats.set(team, ringMat);
      this.disposables.push(ring.geometry, ringMat, tex, glow.material);
    }
    return template.clone();
  }

  // ===== Jugadores =====

  setFirstPersonVisible(v: boolean): void {
    this.fpGroup.visible = v;
  }

  updatePlayers(views: PlayerView[], selfId: number, time: number, myTeam = -1): void {
    // Latido suave de las auras de equipo (material compartido por equipo)
    for (const [, m] of this.auraRingMats) m.opacity = 0.72 + Math.sin(time * 2.6) * 0.14;
    const seen = new Set<number>();
    for (const v of views) {
      seen.add(v.id);
      let entry = this.models.get(v.id);
      if (entry && (entry.character !== v.character || entry.evoStage !== v.evoStage)) {
        // Evolución o cambio de personaje: reconstruir el modelo
        this.scene.remove(entry.model.root);
        entry.model.dispose();
        this.models.delete(v.id);
        entry = undefined;
      }
      if (!entry) {
        const model = createCharacterModel(v.character, v.evoStage);
        const marker = this.textSprite(v.nombre, v.team === 0 ? '#8fc1ff' : '#ffc078', 56);
        marker.scale.set(1.6, 1.6, 1);
        marker.position.y = 1.95;
        model.root.add(marker);
        model.root.add(this.buildTeamAura(v.team));
        this.scene.add(model.root);
        entry = { model, marker, character: v.character, evoStage: v.evoStage };
        this.models.set(v.id, entry);
      }
      const { model, marker } = entry;
      model.root.visible = v.id !== selfId && v.alive;
      marker.visible = v.id !== selfId && v.team === myTeam; // etiquetas solo para aliados
      model.root.position.set(v.pos.x, v.pos.y, v.pos.z);
      model.root.rotation.y = v.yaw;
      const pose: Pose = {
        speed: v.speed,
        crouch: v.crouching,
        firing: v.firing,
        reloading: v.reloading,
        throwing: v.throwing,
        interacting: v.interacting,
        dead: !v.alive,
        weapon: v.weapon,
      };
      model.update(pose, time + v.id * 1.7);
    }
    for (const [id, entry] of this.models) {
      if (!seen.has(id)) {
        this.scene.remove(entry.model.root);
        entry.model.dispose();
        this.models.delete(id);
      }
    }
    // Esferas de cabeza (overlay de depuración)
    for (const m of this.debugHeads) this.scene.remove(m);
    this.debugHeads = [];
    if (this.debugHitboxes) {
      for (const v of views) {
        if (!v.alive || v.id === selfId) continue;
        const s = new THREE.Mesh(
          new THREE.SphereGeometry(HEAD_SPHERE_RADIUS, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xff4444, wireframe: true }),
        );
        s.position.set(v.pos.x, v.pos.y + (v.crouching ? HEAD_OFFSET_CROUCH : HEAD_OFFSET), v.pos.z);
        this.scene.add(s);
        this.debugHeads.push(s);
      }
    }
  }

  removeAllPlayers(): void {
    for (const [, e] of this.models) {
      this.scene.remove(e.model.root);
      e.model.dispose();
    }
    this.models.clear();
  }

  // ===== Efectos =====

  spawnTracer(from: Vec3, to: Vec3, char: CharacterId, weapon: WeaponId = 'pulso'): void {
    const fx = createAttackFx(char, weapon, from, to, settings.movimientoReducido);
    if (!fx) return;
    this.scene.add(fx.group);
    this.attackFx.push(fx);
    // Tope de seguridad: con muchos tiradores, descartar los efectos más viejos
    while (this.attackFx.length > 48) {
      const viejo = this.attackFx.shift()!;
      this.scene.remove(viejo.group);
      viejo.dispose();
    }
    if (settings.movimientoReducido === false) {
      this.spawnPuff(to, CHARACTER_COLORS[char], 0.12);
    }
  }

  spawnExplosion(pos: Vec3, char: CharacterId, radius: number): void {
    const fx = createExplosionFx(char, pos, radius, settings.movimientoReducido);
    this.scene.add(fx.group);
    this.attackFx.push(fx);
  }

  spawnPuff(pos: Vec3, color: number, scale = 0.3): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sprite.position.set(pos.x, pos.y, pos.z);
    sprite.scale.setScalar(scale);
    this.scene.add(sprite);
    this.puffs.push({ sprite, until: performance.now() + 320, vel: new THREE.Vector3(0, 0.6, 0) });
  }

  deathEffect(pos: Vec3, char: CharacterId): void {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.spawnPuff({ x: pos.x + Math.cos(a) * 0.3, y: pos.y + 0.6 + (i % 3) * 0.2, z: pos.z + Math.sin(a) * 0.3 }, CHARACTER_COLORS[char], 0.35);
    }
  }

  fireRecoil(amount: number): void {
    this.recoil = Math.min(0.08, this.recoil + amount * 0.03);
  }

  // ===== Zonas y proyectiles =====

  updateZones(zones: ZoneState[], tick: number, time: number): void {
    const seen = new Set<number>();
    for (const z of zones) {
      seen.add(z.id);
      let g = this.zoneFx.get(z.id);
      if (!g) {
        g = new THREE.Group();
        g.position.set(z.pos.x, z.pos.y, z.pos.z);
        if (z.type === 'cortina' || z.type === 'niebla') {
          const s = new THREE.Mesh(
            new THREE.SphereGeometry(z.radius, 20, 14),
            new THREE.MeshStandardMaterial({ color: 0xdfe9ee, transparent: true, opacity: 0.86, roughness: 1, depthWrite: false }),
          );
          s.position.y = z.radius * 0.55;
          g.add(s);
        } else {
          const color = z.type === 'ascua' ? 0xff7a2f : 0x79d65c;
          const disc = new THREE.Mesh(
            new THREE.CircleGeometry(z.radius, 28),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
          );
          disc.rotation.x = -Math.PI / 2;
          disc.position.y = 0.04;
          g.add(disc);
          for (let i = 0; i < 7; i++) {
            const spr = new THREE.Sprite(new THREE.SpriteMaterial({
              color, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending,
            }));
            const a = (i / 7) * Math.PI * 2;
            spr.position.set(Math.cos(a) * z.radius * 0.6, 0.3, Math.sin(a) * z.radius * 0.6);
            spr.scale.setScalar(0.3);
            g.add(spr);
          }
        }
        this.scene.add(g);
        this.zoneFx.set(z.id, g);
      }
      // Animación de partículas
      let i = 0;
      for (const child of g.children) {
        if ((child as THREE.Sprite).isSprite) {
          child.position.y = 0.25 + Math.abs(Math.sin(time * 2.4 + i)) * (z.type === 'ascua' ? 0.8 : 0.5);
          i++;
        }
      }
      // Desvanecimiento al expirar
      const left = z.endTick - tick;
      if (left < 45) {
        g.traverse((o) => {
          const matAny = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (matAny && 'opacity' in matAny) (matAny as THREE.MeshBasicMaterial).opacity *= 0.95;
        });
      }
    }
    for (const [id, g] of this.zoneFx) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.zoneFx.delete(id);
      }
    }
  }

  updateProjectiles(projs: ProjectileState[]): void {
    const colors: Record<string, number> = { destello: 0xffffff, ascua: 0xff7a2f, cortina: 0xbfd9e8, esporas: 0x79d65c, niebla: 0xbfd9e8, explosivo: 0xffd24a };
    const seen = new Set<number>();
    for (const p of projs) {
      seen.add(p.id);
      let m = this.projFx.get(p.id);
      if (!m) {
        // El explosivo es un orbe mayor y luminoso para que se lea en vuelo
        const r = p.type === 'explosivo' ? 0.16 : 0.09;
        m = new THREE.Mesh(
          new THREE.SphereGeometry(r, 10, 8),
          new THREE.MeshBasicMaterial({
            color: colors[p.type] ?? 0xffffff,
            ...(p.type === 'explosivo' ? { transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false } : {}),
          }),
        );
        this.scene.add(m);
        this.projFx.set(p.id, m);
      }
      m.position.set(p.pos.x, p.pos.y, p.pos.z);
    }
    for (const [id, m] of this.projFx) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.projFx.delete(id);
      }
    }
  }

  updateCore(core: CoreState, carrierPos: Vec3 | null, time: number): void {
    const c = this.coreMesh;
    if (core.planted) {
      c.visible = true;
      c.position.set(core.pos.x, core.pos.y + 0.35, core.pos.z);
      const pulse = 1 + Math.sin(time * 6) * 0.15;
      c.scale.setScalar(pulse);
    } else if (core.carrier !== null && carrierPos) {
      c.visible = true;
      c.position.set(carrierPos.x, carrierPos.y + 1.75, carrierPos.z);
      c.scale.setScalar(0.6);
    } else if (core.carrier === null && core.pos.y > -50) {
      c.visible = true;
      c.position.set(core.pos.x, core.pos.y + 0.4 + Math.sin(time * 2) * 0.08, core.pos.z);
      c.scale.setScalar(1);
    } else {
      c.visible = false;
    }
    c.rotation.y = time * 1.6;
  }

  // ===== Bucle =====

  render(pos: Vec3, yaw: number, pitch: number, dt: number): void {
    const now = performance.now();
    this.attackFx = this.attackFx.filter((fx) => {
      if (fx.update(dt)) return true;
      this.scene.remove(fx.group);
      fx.dispose();
      return false;
    });
    this.puffs = this.puffs.filter((p) => {
      const left = p.until - now;
      if (left <= 0) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        return false;
      }
      p.sprite.material.opacity = left / 400;
      p.sprite.scale.multiplyScalar(1.03);
      p.sprite.position.addScaledVector(p.vel, dt);
      return true;
    });

    this.recoil *= Math.exp(-dt * 10);
    this.fpTime += dt;
    updateAttackIndicator(this.fpIndicator, this.fpWeapon, this.fpTime, this.recoil > 0.025, this.fpReloading);
    this.fpGroup.position.z = this.recoil * 1.5;
    this.fpPawL.position.y = -0.155 + this.recoil;
    this.fpPawR.position.y = -0.155 + this.recoil;

    this.camera.position.set(pos.x, pos.y, pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(yaw);
    this.camera.rotateX(pitch + this.recoil * 4);
    this.renderer.render(this.scene, this.camera);
  }

  setFov(horizontalDeg: number): void {
    const aspect = this.camera.aspect || 1.78;
    const h = (horizontalDeg * Math.PI) / 180;
    this.camera.fov = (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  applyQuality(): void {
    const dprBase = Math.min(window.devicePixelRatio || 1, 1.5);
    const scale = settings.resolucionInterna;
    const dpr = settings.calidad === 'baja' ? Math.min(dprBase, 1) * scale : dprBase * scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = settings.calidad !== 'baja';
    this.sun.castShadow = settings.calidad !== 'baja';
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.setFov(settings.fov);
  }

  stats(): { drawCalls: number; triangles: number } {
    return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }

  dispose(): void {
    window.removeEventListener('pta-modelos', this.onModelsChanged);
    this.removeAllPlayers();
    for (const fx of this.attackFx) fx.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
