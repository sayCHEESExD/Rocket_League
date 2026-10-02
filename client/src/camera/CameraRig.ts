import { ARENA, arenaQuery, v3 } from '@rlb/shared';
import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { S } from '../world/units.js';

export type CamMode = 'car' | 'goal' | 'replay' | 'overview';

/** Rocket League's default-ish camera, in uu. */
const CAM = {
  distance: 270,
  height: 105,
  angle: -0.07,
  /** Horizontal FOV like RL's slider; converted per aspect. */
  hfov: 108,
  /** Yaw follow rate (1/s) - "swivel". */
  swivel: 9,
  ballCamRate: 6,
};


const sim = v3();
const nrm = v3();

/**
 * THE VEHICLE CAMERA.
 *
 * Car cam and ball cam both ORBIT the car: the yaw/pitch of the orbit are what
 * get smoothed, never the camera position itself, so at 2300 uu/s the car stays
 * glued to the same spot on screen instead of the camera falling behind. A
 * little extra distance and FOV with speed sell the speed; nothing shakes
 * except a short kick on big impacts.
 *
 * The goal and replay cameras are separate modes the game switches to, with
 * a short eased blend between any two.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  ballCam = true;
  mode: CamMode = 'overview';

  private pitch = 0;
  private wallK = 0;
  private readonly dir = new Vector3(0, 1, 0);
  private readonly want = new Vector3();
  private readonly orbitUp = new Vector3(0, 0, 1);
  private speedK = 0;
  private shake = 0;
  private blend = 1;
  private blendTime = 0.55;
  private readonly fromPos = new Vector3();
  private readonly fromQ = new Quaternion();
  private readonly target = new Vector3();
  private readonly look = new Vector3();
  private readonly tmp = new Vector3();
  private readonly q = new Quaternion();
  private goalT = 0;
  private aspect = 16 / 9;
  /** The portal's `camera_sensitivity` (0.1..5): scales how fast the camera swings to follow. */
  sensitivity = 1;

  constructor() {
    // near 0.15 m (not 0.05): three times the depth precision out in the city, where signs and
    // facades half a metre apart used to fight; nothing is ever drawn closer than that
    this.camera = new PerspectiveCamera(70, 16 / 9, 0.15, 2000);
    this.camera.position.set(0, 25, 70);
    this.camera.lookAt(0, 0, 0);
  }

  resize(w: number, h: number): void {
    this.aspect = w / Math.max(1, h);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Vertical FOV (deg) for a horizontal one, clamped for portrait-ish screens. */
  private vfov(hfov: number): number {
    const v = 2 * Math.atan(Math.tan(MathUtils.degToRad(hfov) / 2) / this.aspect);
    return MathUtils.clamp(MathUtils.radToDeg(v), 55, 92);
  }

  /** Switch shots, blending from where the camera is now over `seconds` (longer = the intro's flight). */
  setMode(mode: CamMode, seconds = 0.55): void {
    if (mode === this.mode) return;
    this.fromPos.copy(this.camera.position);
    this.fromQ.copy(this.camera.quaternion);
    this.blend = 0;
    this.blendTime = Math.max(0.05, seconds);
    this.mode = mode;
    this.goalT = 0;
  }

  kick(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Snap the orbit behind a heading (kickoff, respawn). */
  snapBehind(yaw: number): void {
    this.dir.set(Math.cos(yaw), Math.sin(yaw), 0);
    this.pitch = 0;
  }

  /**
   * Car / ball cam. Everything in sim uu: the car's position, forward and up
   * vectors, velocity, the ball (null = car cam regardless).
   *
   * The orbit is built around an UP axis that is world-up on the floor and
   * leans to the car's own up while it drives on a wall, so on a wall the
   * camera sits out over the pitch behind the car instead of inside the wall.
   * The heading is a smoothed unit vector, so driving up a wall, over the top
   * and back down never hits an angle wrap.
   */
  follow(dt: number, car: Vector3, fwd: Vector3, up: Vector3, vel: Vector3, ball: Vector3 | null, speed: number, boosting: boolean, onGround: boolean): void {
    // how much the orbit leans to the car's up (only while driving on a wall / ceiling)
    const wallWant = onGround ? MathUtils.clamp((0.92 - up.z) / 0.6, 0, 1) : 0;
    this.wallK += (wallWant - this.wallK) * Math.min(1, dt * (wallWant > this.wallK ? 6 : 2.5));
    const ou = this.orbitUp.set(up.x * this.wallK, up.y * this.wallK, 1 - this.wallK + up.z * this.wallK);
    if (ou.lengthSq() < 1e-4) ou.set(0, 0, 1);
    ou.normalize();

    // the heading the camera wants, flattened onto the orbit plane
    const want = this.want;
    let elev = 0;
    if (this.ballCam && ball) {
      want.set(ball.x - car.x, ball.y - car.y, ball.z - car.z - 60);
      const along = want.dot(ou);
      const flat = this.tmp.copy(want).addScaledVector(ou, -along);
      const fl = flat.length();
      elev = MathUtils.clamp(Math.atan2(along, Math.max(fl, 200)), -0.35, 0.8);
      if (fl > 30) want.copy(flat).divideScalar(fl);
      else want.copy(this.dir);
    } else {
      want.copy(fwd).addScaledVector(ou, -fwd.dot(ou));
      if (want.length() < 0.35) {
        want.copy(vel).addScaledVector(ou, -vel.dot(ou));
        if (want.length() < 200) want.copy(this.dir);
      }
      want.normalize();
    }
    const rate = (this.ballCam && ball ? CAM.ballCamRate * MathUtils.clamp(Math.hypot(ball.x - car.x, ball.y - car.y) / 600, 0.25, 1.4) : CAM.swivel) * this.sensitivity;
    // keep the stored heading on the current orbit plane, then turn it towards the want
    this.dir.addScaledVector(ou, -this.dir.dot(ou));
    if (this.dir.lengthSq() < 1e-6) this.dir.copy(want);
    this.dir.normalize();
    // a half-turn would lerp through zero: nudge sideways first
    if (this.dir.dot(want) < -0.95) this.dir.addScaledVector(this.tmp.crossVectors(ou, this.dir), 0.3).normalize();
    this.dir.lerp(want, Math.min(1, rate * dt)).normalize();
    this.pitch += (elev - this.pitch) * Math.min(1, 5 * dt);

    this.speedK += (MathUtils.clamp((speed - 1200) / 1100, 0, 1) * (boosting ? 1 : 0.6) - this.speedK) * Math.min(1, dt * 3);
    const dist = CAM.distance + this.speedK * 30;
    const height = CAM.height + Math.max(0, this.pitch) * -40;
    const pitch = CAM.angle + this.pitch * 0.7;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const h = this.dir;
    sim.x = car.x - h.x * cp * dist + ou.x * (height - sp * dist);
    sim.y = car.y - h.y * cp * dist + ou.y * (height - sp * dist);
    sim.z = car.z - h.z * cp * dist + ou.z * (height - sp * dist);
    sim.z = Math.max(sim.z, 40);
    // keep the camera inside the arena
    const d = arenaQuery(sim, nrm);
    if (d < 45) {
      sim.x += nrm.x * (45 - d);
      sim.y += nrm.y * (45 - d);
      sim.z += nrm.z * (45 - d);
    }
    this.target.set(sim.x * S, sim.z * S, -sim.y * S);
    // look along the orbit heading (not at the car: keeps the horizon steady)
    const lx = car.x + h.x * cp * 400 + ou.x * (70 + sp * 400 + height * 0.15);
    const ly = car.y + h.y * cp * 400 + ou.y * (70 + sp * 400 + height * 0.15);
    const lz = car.z + h.z * cp * 400 + ou.z * (70 + sp * 400 + height * 0.15);
    this.look.set(lx * S, lz * S, -ly * S);
    // a slight lean with the wall, mostly level (and never degenerate looking straight up a wall)
    const k = 0.4 * this.wallK;
    this.camera.up.set(ou.x * k, (1 - k) + ou.z * k, -ou.y * k).normalize();
    this.apply(dt, this.vfov(CAM.hfov + this.speedK * 8));
  }

  /** The goal cinematic: swing to beside the scored goal, slowly orbiting, looking at the explosion. */
  goal(dt: number, side: number, burst: Vector3): void {
    this.camera.up.set(0, 1, 0);
    this.goalT += dt;
    const s = side;
    const a = 0.6 + this.goalT * 0.12;
    const r = 2200;
    const gx = Math.sin(a) * r * 0.55;
    const gy = s * (ARENA.halfY - Math.cos(a) * r * 0.55);
    this.target.set(gx * S, 5.2, -gy * S);
    this.look.set(burst.x * S * 0.5, 2.2, -s * ARENA.halfY * S);
    this.apply(dt, this.vfov(84));
  }

  /** A free shot (replay director, overview): place and aim directly (sim uu). */
  shot(dt: number, pos: Vector3, at: Vector3, hfov: number): void {
    this.camera.up.set(0, 1, 0);
    this.target.set(pos.x * S, pos.z * S, -pos.y * S);
    this.look.set(at.x * S, at.z * S, -at.y * S);
    this.apply(dt, this.vfov(hfov));
  }

  private apply(dt: number, fovDeg: number): void {
    const cam = this.camera;
    if (Math.abs(cam.fov - fovDeg) > 0.01) {
      cam.fov += (fovDeg - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }
    cam.position.copy(this.target);
    cam.lookAt(this.look);
    if (this.blend < 1) {
      // dt is clamped: a slow frame never jumps the camera more than a 30 fps step
      this.blend = Math.min(1, this.blend + Math.min(dt, 1 / 30) / this.blendTime);
      const b = this.blend;
      // smootherstep: gentle out of the wide shot, gentle into the car
      const e = b * b * b * (b * (b * 6 - 15) + 10);
      this.q.copy(cam.quaternion);
      cam.position.lerpVectors(this.fromPos, this.target, e);
      cam.quaternion.slerpQuaternions(this.fromQ, this.q, e);
    }
    if (this.shake > 0.001) {
      const k = this.shake * this.shake * 0.12;
      this.tmp.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
      cam.position.add(this.tmp);
      this.shake = Math.max(0, this.shake - dt * 3.5);
    }
  }
}
