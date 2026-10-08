import { Vec3, v3, clamp } from './math.js';
import { MapDef } from './map.js';
import { moveCapsule, capsuleFree } from './collision.js';
import {
  ACCEL, AIR_CONTROL, AIM_SPEED_MULT, GRAVITY, JUMP_SPEED,
  PLAYER_HEIGHT, PLAYER_HEIGHT_CROUCH, PLAYER_RADIUS,
  SPEED_CROUCH, SPEED_RUN, SPEED_WALK, TICK_DT,
} from './constants.js';
import { BTN, PlayerInput, PlayerState } from './types.js';

export function playerHeight(crouching: boolean): number {
  return crouching ? PLAYER_HEIGHT_CROUCH : PLAYER_HEIGHT;
}

export function maxSpeed(p: PlayerState): number {
  let s = SPEED_RUN;
  if (p.crouching) s = SPEED_CROUCH;
  else if (p.walking) s = SPEED_WALK;
  if (p.aiming) s *= AIM_SPEED_MULT;
  return s * p.slowFactor;
}

/**
 * Aplica un tick de movimiento. Determinista y compartido entre cliente (predicción),
 * worker local y servidor. No gestiona disparos ni interacciones.
 */
export function stepMovement(map: MapDef, p: PlayerState, input: PlayerInput, doorsClosed: boolean): void {
  p.yaw = input.yaw;
  p.pitch = clamp(input.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  p.walking = (input.buttons & BTN.WALK) !== 0;
  p.aiming = (input.buttons & BTN.AIM) !== 0;

  // Agacharse / levantarse (no levantarse bajo techo)
  const wantCrouch = (input.buttons & BTN.CROUCH) !== 0;
  if (wantCrouch !== p.crouching) {
    if (wantCrouch) {
      p.crouching = true;
    } else if (capsuleFree(map, p.pos, PLAYER_RADIUS, PLAYER_HEIGHT, doorsClosed)) {
      p.crouching = false;
    }
  }
  const h = playerHeight(p.crouching);

  // Velocidad deseada en el plano XZ
  const mx = clamp(input.moveX, -1, 1);
  const mz = clamp(input.moveZ, -1, 1);
  const len = Math.hypot(mx, mz);
  const nx = len > 1 ? mx / len : mx;
  const nz = len > 1 ? mz / len : mz;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // adelante = proyección XZ de lookDir(yaw): (-sin, -cos); derecha = perpendicular horaria
  const fwd = v3(-sin, 0, -cos);
  const right = v3(-fwd.z, 0, fwd.x);
  const speed = maxSpeed(p);
  const wishX = (fwd.x * nz + right.x * nx) * speed;
  const wishZ = (fwd.z * nz + right.z * nx) * speed;

  const accel = p.onGround ? ACCEL : ACCEL * AIR_CONTROL;
  const dvMax = accel * TICK_DT;
  const dx = wishX - p.vel.x;
  const dz = wishZ - p.vel.z;
  const dLen = Math.hypot(dx, dz);
  if (dLen > 1e-6) {
    const f = Math.min(1, dvMax / dLen);
    p.vel.x += dx * f;
    p.vel.z += dz * f;
  }
  // Sin bunny hopping: la velocidad horizontal nunca supera la máxima actual
  const hLen = Math.hypot(p.vel.x, p.vel.z);
  if (hLen > speed) {
    p.vel.x *= speed / hLen;
    p.vel.z *= speed / hLen;
  }

  // Salto y gravedad
  if (p.onGround && (input.buttons & BTN.JUMP) !== 0) {
    p.vel.y = JUMP_SPEED;
    p.onGround = false;
  }
  if (!p.onGround) p.vel.y -= GRAVITY * TICK_DT;

  const res = moveCapsule(map, p.pos, p.vel, TICK_DT, h, doorsClosed, p.onGround);
  p.onGround = res.onGround;
  if (res.blockedX) p.vel.x = 0;
  if (res.blockedZ) p.vel.z = 0;
}

export function horizontalSpeed(p: PlayerState): number {
  return Math.hypot(p.vel.x, p.vel.z);
}

export { v3 as _v3 };
export type { Vec3 };
