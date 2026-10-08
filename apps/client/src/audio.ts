import type { CharacterId, WeaponId } from '@pta/shared';
import { settings } from './settings.js';

/**
 * Audio sintetizado en tiempo real con WebAudio (sin archivos externos).
 * Todo el audio original; empieza tras el primer gesto del usuario.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private musicPlaying = false;
  private musicNodes: AudioNode[] = [];
  private warned = false;

  /** Llamar en cada gesto del usuario; inicializa/reanuda el contexto. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.music = this.ctx.createGain();
        this.sfx = this.ctx.createGain();
        this.music.connect(this.master);
        this.sfx.connect(this.master);
        this.master.connect(this.ctx.destination);
        this.applyVolumes();
      } catch {
        if (!this.warned) {
          this.warned = true;
          console.warn('Audio no disponible en este navegador; el juego continúa sin sonido.');
        }
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => { /* bloqueado: sin error visible */ });
    }
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = settings.volGeneral;
    this.music.gain.value = settings.volMusica * 0.5;
    this.sfx.gain.value = settings.volEfectos;
  }

  setListener(x: number, y: number, z: number, fx: number, fz: number): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    }
  }

  private out(pos?: [number, number, number]): AudioNode {
    if (!this.ctx) throw new Error('sin audio');
    if (!pos) return this.sfx;
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 2;
    p.maxDistance = 60;
    p.rolloffFactor = 1;
    p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2];
    p.connect(this.sfx);
    return p;
  }

  private env(node: AudioNode, dur: number, peak = 0.5, attack = 0.004): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(peak, ctx.currentTime + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    g.connect(node);
    return g;
  }

  private osc(type: OscillatorType, f0: number, f1: number, dur: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), ctx.currentTime + dur);
    o.connect(dest);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  private noise(dur: number, dest: AudioNode, lowpass = 4000): void {
    const ctx = this.ctx!;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    src.connect(f);
    f.connect(dest);
    src.start();
  }

  disparo(weapon: WeaponId, char: CharacterId, pos?: [number, number, number]): void {
    if (!this.ready) return;
    const base = { pulso: [700, 180, 0.12, 0.35], rafaga: [900, 240, 0.09, 0.3], preciso: [1400, 90, 0.3, 0.5] }[weapon];
    const flavor: Record<CharacterId, OscillatorType> = { pikachu: 'square', charmander: 'sawtooth', squirtle: 'sine', bulbasaur: 'triangle' };
    const dest = this.out(pos);
    const g = this.env(dest, base[2], base[3]);
    this.osc(flavor[char], base[0], base[1], base[2], g);
    if (char === 'pikachu') this.noise(0.05, this.env(dest, 0.05, 0.15), 8000);
    if (char === 'charmander') this.noise(0.1, this.env(dest, 0.1, 0.2), 1200);
  }

  pasos(pos?: [number, number, number]): void {
    if (!this.ready) return;
    this.noise(0.05, this.env(this.out(pos), 0.05, 0.12), 900);
  }

  salto(pos?: [number, number, number]): void {
    if (!this.ready) return;
    this.noise(0.08, this.env(this.out(pos), 0.08, 0.14), 600);
  }

  recarga(pos?: [number, number, number]): void {
    if (!this.ready) return;
    const dest = this.out(pos);
    this.osc('square', 300, 500, 0.05, this.env(dest, 0.05, 0.2));
    setTimeout(() => this.ready && this.osc('square', 500, 320, 0.06, this.env(this.out(pos), 0.06, 0.2)), 160);
  }

  impacto(headshot: boolean): void {
    if (!this.ready) return;
    this.osc('square', headshot ? 1600 : 1100, headshot ? 1200 : 900, 0.05, this.env(this.sfx, 0.05, 0.25));
  }

  danoRecibido(): void {
    if (!this.ready) return;
    this.osc('sine', 180, 60, 0.18, this.env(this.sfx, 0.18, 0.45));
    this.noise(0.1, this.env(this.sfx, 0.1, 0.2), 400);
  }

  baja(): void {
    if (!this.ready) return;
    this.osc('triangle', 660, 880, 0.1, this.env(this.sfx, 0.12, 0.3));
  }

  explosion(pos?: [number, number, number]): void {
    if (!this.ready) return;
    this.noise(0.45, this.env(this.out(pos), 0.45, 0.6), 900);
    this.osc('sine', 200, 40, 0.4, this.env(this.out(pos), 0.4, 0.5));
  }

  destelloPersonal(): void {
    if (!this.ready) return;
    this.osc('sine', 2800, 2600, 0.9, this.env(this.sfx, 0.9, 0.3, 0.01));
  }

  despliegue(pos?: [number, number, number]): void {
    if (!this.ready) return;
    this.noise(0.25, this.env(this.out(pos), 0.25, 0.3), 700);
  }

  interaccion(tipo: 'instalacion' | 'desactivacion', pos?: [number, number, number]): void {
    if (!this.ready) return;
    this.osc('square', tipo === 'instalacion' ? 820 : 620, tipo === 'instalacion' ? 860 : 580, 0.07, this.env(this.out(pos), 0.07, 0.22));
  }

  nucleoPulso(rate: number, pos?: [number, number, number]): void {
    if (!this.ready) return;
    this.osc('sine', 980, 940, 0.07, this.env(this.out(pos), 0.07, Math.min(0.5, 0.25 + rate * 0.2)));
  }

  fase(tipo: 'inicio' | 'victoria' | 'derrota' | 'instalado'): void {
    if (!this.ready) return;
    const seq: Record<string, number[]> = {
      inicio: [523, 659, 784],
      victoria: [523, 659, 784, 1047],
      derrota: [392, 330, 262],
      instalado: [880, 880, 988],
    };
    seq[tipo].forEach((f, i) => {
      setTimeout(() => {
        if (!this.ready) return;
        this.osc('triangle', f, f, 0.16, this.env(this.sfx, 0.18, 0.25));
      }, i * 130);
    });
  }

  startMusic(): void {
    if (!this.ready || this.musicPlaying) return;
    this.musicPlaying = true;
    const ctx = this.ctx!;
    const make = (f: number, detune: number): void => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.08 + detune / 4000;
      const lg = ctx.createGain();
      lg.gain.value = 0.03;
      lfo.connect(lg);
      lg.connect(g.gain);
      o.connect(g);
      g.connect(this.music);
      o.start();
      lfo.start();
      this.musicNodes.push(o, lfo, g);
    };
    make(130.8, 0);
    make(196, 5);
    make(261.6, -6);
  }

  stopMusic(): void {
    this.musicPlaying = false;
    for (const n of this.musicNodes) {
      try { (n as OscillatorNode).stop?.(); } catch { /* ya parado */ }
      n.disconnect();
    }
    this.musicNodes = [];
  }
}

export const audio = new AudioEngine();
