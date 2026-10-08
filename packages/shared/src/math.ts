export interface Vec3 { x: number; y: number; z: number; }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const vlen = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const vlen2 = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const vdist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const vdistXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const vnorm = (a: Vec3): Vec3 => {
  const l = vlen(a);
  return l > 1e-9 ? vscale(a, 1 / l) : v3();
};
export const vclone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Dirección de mirada a partir de yaw/pitch (radianes). yaw 0 => -Z, pitch + => arriba. */
export function lookDir(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Yaw hacia un objetivo en el plano XZ. */
export function yawTo(from: Vec3, to: Vec3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
