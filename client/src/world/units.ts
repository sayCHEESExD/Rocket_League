import type { Object3D, Quaternion, Vector3 } from 'three';

/**
 * Simulation units (uu, Z up, Rocket League's axes) -> render units (metres-ish,
 * three.js Y up). 1 uu = 1 cm.
 *
 *   three.x =  sim.x
 *   three.y =  sim.z
 *   three.z = -sim.y
 *
 * A proper rotation (det +1), so a sim quaternion converts by rotating its
 * vector part the same way: (x, y, z, w) -> (x, z, -y, w).
 */
export const S = 0.01;

export const toThree = (out: Vector3, x: number, y: number, z: number): Vector3 => out.set(x * S, z * S, -y * S);

export const quatToThree = (out: Quaternion, x: number, y: number, z: number, w: number): Quaternion => out.set(x, z, -y, w);

export const placeSim = (o: Object3D, x: number, y: number, z: number): void => {
  o.position.set(x * S, z * S, -y * S);
};
