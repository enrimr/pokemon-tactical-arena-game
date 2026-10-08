import { Vec3, v3, vnorm, vcross, vlen, DEG2RAD } from './math.js';
import { Rng } from './rng.js';
import {
  MOVE_SPREAD_THRESHOLD, SPREAD_AIM_MULT, SPREAD_AIR_ADD, SPREAD_BURST_ADD,
  SPREAD_BURST_MAX, SPREAD_CROUCH_MULT, SPREAD_MOVE_ADD, WEAPONS,
} from './constants.js';
import { PlayerState } from './types.js';
import { horizontalSpeed } from './movement.js';

/** Dispersión efectiva en grados para el siguiente disparo. */
export function currentSpreadDeg(p: PlayerState): number {
  const w = WEAPONS[p.weapon];
  let s = w.dispersionBase;
  if (p.weapon === 'rafaga') {
    s += Math.min(SPREAD_BURST_MAX, p.burstShots * SPREAD_BURST_ADD);
  }
  if (horizontalSpeed(p) > MOVE_SPREAD_THRESHOLD) s += SPREAD_MOVE_ADD;
  if (!p.onGround) s += SPREAD_AIR_ADD;
  if (p.crouching) s *= SPREAD_CROUCH_MULT;
  if (p.aiming) s *= SPREAD_AIM_MULT;
  return s;
}

/** Desvía una dirección normalizada dentro de un cono (disco uniforme), con RNG sembrado. */
export function applySpread(rng: Rng, dir: Vec3, spreadDeg: number): Vec3 {
  if (spreadDeg <= 0) return dir;
  const maxAng = spreadDeg * DEG2RAD;
  const ang = maxAng * Math.sqrt(rng.next());
  const rot = rng.next() * Math.PI * 2;
  // Base ortonormal alrededor de dir
  const up = Math.abs(dir.y) > 0.99 ? v3(1, 0, 0) : v3(0, 1, 0);
  const t1 = vnorm(vcross(dir, up));
  const t2 = vcross(dir, t1);
  const sa = Math.sin(ang);
  const out = v3(
    dir.x * Math.cos(ang) + (t1.x * Math.cos(rot) + t2.x * Math.sin(rot)) * sa,
    dir.y * Math.cos(ang) + (t1.y * Math.cos(rot) + t2.y * Math.sin(rot)) * sa,
    dir.z * Math.cos(ang) + (t1.z * Math.cos(rot) + t2.z * Math.sin(rot)) * sa,
  );
  const l = vlen(out);
  return v3(out.x / l, out.y / l, out.z / l);
}

export function fireCooldownTicks(weaponId: PlayerState['weapon'], tickRate: number): number {
  return Math.round(tickRate / WEAPONS[weaponId].disparosPorSegundo);
}

export function reloadTicks(weaponId: PlayerState['weapon'], tickRate: number): number {
  return Math.round(WEAPONS[weaponId].recargaS * tickRate);
}
