import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterId, CoreState, MapDef, ProjectileState, SolidBox, SolidTag, Vec3, ZoneState } from '@pta/shared';
import { HEAD_OFFSET, HEAD_OFFSET_CROUCH, HEAD_SPHERE_RADIUS } from '@pta/shared';
import { CharacterModel, createCharacterModel, CHARACTER_COLORS, Pose } from './models.js';
import { settings } from './settings.js';

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
};

export interface PlayerView {
  id: number;
  character: CharacterId;
  team: number;
  pos: Vec3;
  yaw: number;
  speed: number;
  crouching: boolean;
  alive: boolean;
  hasCore: boolean;
  firing: boolean;
  reloading: boolean;
  throwing: boolean;
  interacting: boolean;
  esBot: boolean;
  nombre: string;
}

interface TracerFx { mesh: THREE.Mesh; until: number; }
interface PuffFx { sprite: THREE.Sprite; until: number; vel: THREE.Vector3; }

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private map: MapDef;
  private doors: THREE.Object3D[] = [];
  private models = new Map<number, { model: CharacterModel; marker: THREE.Sprite }>();
  private zoneFx = new Map<number, THREE.Group>();
  private projFx = new Map<number, THREE.Mesh>();
  private tracers: TracerFx[] = [];
  private puffs: PuffFx[] = [];
  private coreMesh: THREE.Group;
  private sun!: THREE.DirectionalLight;
  private fpGroup = new THREE.Group();
  private fpPawL!: THREE.Mesh;
  private fpPawR!: THREE.Mesh;
  private fpOrb!: THREE.Mesh;
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

    this.scene.background = new THREE.Color(0xaed8f0);
    this.scene.fog = new THREE.Fog(0xcfe6f2, 70, 170);
    this.buildLights();
    this.buildMap();
    this.buildFirstPerson();
    this.coreMesh = this.buildCore();
    this.scene.add(this.coreMesh);
    this.applyQuality();
    this.resize();
  }

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

  private buildMap(): void {
    const concrete = this.concreteTexture();
    const texturedTags = new Set<SolidTag>(['muro', 'muroBajo', 'suelo', 'rampa', 'pilar', 'pasarela', 'caja', 'cajaBaja']);
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
    for (const [tag, geos] of byTag) {
      const style = TAG_STYLE[tag];
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: style.color,
        roughness: style.roughness ?? 0.92,
        metalness: 0.04,
        emissive: style.emissive ?? 0,
        emissiveIntensity: style.emissive ? 0.35 : 0,
        map: texturedTags.has(tag) ? concrete : null,
      });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = tag !== 'suelo';
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
    this.buildSiteMarkers();
    this.buildVegetation();
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
    // Señalización de rutas
    const signs: { text: string; pos: [number, number, number] }[] = [
      { text: '◀ A', pos: [-14, 2.6, -14] },
      { text: 'B ▶', pos: [14, 2.6, -14] },
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
    // Vegetación contenida en el invernadero (visual, sin colisión)
    const bush = new THREE.SphereGeometry(1, 8, 6);
    const matBush = new THREE.MeshStandardMaterial({ color: 0x4f8f45, roughness: 0.95 });
    const spots: [number, number, number][] = [
      [14.5, 0, 16.5], [28.5, 0, 4], [19, 0, 3.2], [28.6, 0, 16.6],
      [-14.5, 0, 16.5], [-28.5, 0, 4.2],
    ];
    for (const [x, , z] of spots) {
      const b = new THREE.Mesh(bush, matBush);
      const s = 0.5 + ((x * 13 + z * 7) % 10) / 25;
      b.scale.set(s, s * 0.8, s);
      b.position.set(x, s * 0.5, z);
      b.castShadow = true;
      this.scene.add(b);
    }
    this.disposables.push(bush, matBush);
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
    this.fpOrb = new THREE.Mesh(paw, new THREE.MeshBasicMaterial({ color: 0xffe84a, transparent: true, opacity: 0.0 }));
    this.fpOrb.scale.setScalar(0.025);
    this.fpOrb.position.set(0, -0.13, -0.45);
    this.fpGroup.add(this.fpPawL, this.fpPawR, this.fpOrb);
    this.camera.add(this.fpGroup);
  }

  setFirstPersonCharacter(char: CharacterId): void {
    const color = { pikachu: 0xf7d02c, charmander: 0xee8130, squirtle: 0x6390f0, bulbasaur: 0x59b5a2 }[char];
    (this.fpPawL.material as THREE.MeshStandardMaterial).color.set(color);
    (this.fpOrb.material as THREE.MeshBasicMaterial).color.set(CHARACTER_COLORS[char]);
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

  setDoorsClosed(closed: boolean): void {
    for (const d of this.doors) d.visible = closed;
  }

  // ===== Jugadores =====

  setFirstPersonVisible(v: boolean): void {
    this.fpGroup.visible = v;
  }

  updatePlayers(views: PlayerView[], selfId: number, time: number, myTeam = -1): void {
    const seen = new Set<number>();
    for (const v of views) {
      seen.add(v.id);
      let entry = this.models.get(v.id);
      if (!entry) {
        const model = createCharacterModel(v.character);
        const marker = this.textSprite(v.nombre, v.team === 0 ? '#8fc1ff' : '#ffc078', 56);
        marker.scale.set(1.6, 1.6, 1);
        marker.position.y = 1.95;
        model.root.add(marker);
        this.scene.add(model.root);
        entry = { model, marker };
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

  spawnTracer(from: Vec3, to: Vec3, char: CharacterId): void {
    const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const len = dir.length();
    if (len < 0.1) return;
    const geo = new THREE.CylinderGeometry(0.015, 0.015, 1, 5);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: CHARACTER_COLORS[char], transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    mesh.scale.z = len;
    mesh.lookAt(to.x, to.y, to.z);
    this.scene.add(mesh);
    this.tracers.push({ mesh, until: performance.now() + 90 });
    if (settings.movimientoReducido === false) {
      this.spawnPuff(to, CHARACTER_COLORS[char], 0.12);
    }
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
    (this.fpOrb.material as THREE.MeshBasicMaterial).opacity = 1;
    this.fpOrb.scale.setScalar(0.05);
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
    const colors: Record<string, number> = { destello: 0xffffff, ascua: 0xff7a2f, cortina: 0xbfd9e8, esporas: 0x79d65c, niebla: 0xbfd9e8 };
    const seen = new Set<number>();
    for (const p of projs) {
      seen.add(p.id);
      let m = this.projFx.get(p.id);
      if (!m) {
        m = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 10, 8),
          new THREE.MeshBasicMaterial({ color: colors[p.type] ?? 0xffffff }),
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
    this.tracers = this.tracers.filter((t) => {
      const left = t.until - now;
      if (left <= 0) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        (t.mesh.material as THREE.Material).dispose();
        return false;
      }
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = left / 110;
      return true;
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
    const orbMat = this.fpOrb.material as THREE.MeshBasicMaterial;
    orbMat.opacity *= Math.exp(-dt * 8);
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
    this.removeAllPlayers();
    for (const t of this.tracers) {
      t.mesh.geometry.dispose();
      (t.mesh.material as THREE.Material).dispose();
    }
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
