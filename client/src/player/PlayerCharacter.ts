import { EMOTE, EMOTE_SKIP_BONES } from '@rlb/shared';
import { Group, Vector3, type Mesh, type Object3D } from 'three';
import { PoseBuffer, type PoseDefinition } from '../animation/PoseBuffer.js';
import { BloxityEmotePlayer } from '../animation/BloxityEmotes.js';
import { PlayerRig } from '../animation/rig/PlayerRig.js';
import { playerModelLoader } from './PlayerModelLoader.js';

const deg = (d: number): number => (d * Math.PI) / 180;

/** Seated in the cockpit, hands on the wheel (from the plane game's rider pose, adapted to a car). */
export const SEATED: PoseDefinition = {
  LegL1: { x: deg(-78), y: deg(6) },
  LegR1: { x: deg(-78), y: deg(-6) },
  // racing position: legs stretched forward into the footwell (a 96 deg knee hung the feet down
  // through the floor of the low cars, and out of the body for long-legged avatars)
  LegL2: { x: deg(16) },
  LegR2: { x: deg(16) },
  ArmL1: { x: deg(-58), y: deg(-14) },
  ArmR1: { x: deg(-58), y: deg(14) },
  ArmL2: { x: deg(34) },
  ArmR2: { x: deg(34) },
  Spine1: { x: deg(8) },
  Spine2: { x: deg(2) },
  Neck1: { x: deg(-6) },
};

/** What a lobby walker is doing. */
export interface WalkMotion {
  /** Ground speed (m/s). */
  speed: number;
  airborne: boolean;
  /** The Bloxity emote playing ('' none) and seconds since it began. */
  emote: string;
  emoteTime: number;
}

/** The lobby height of a walker: the avatar is PLAYER_HEIGHT (3.2) units tall, a person ~1.8 m. */
export const WALKER_SCALE = 1.8 / 3.2;

const NO_SKIP: ReadonlySet<string> = new Set();

/** What the driver is doing, for secondary motion. */
export interface RiderMotion {
  steer: number;
  /** Lateral acceleration (sideways g, + = pushed left). */
  lateral: number;
  /** Forward acceleration (g). */
  surge: number;
  boosting: boolean;
  airborne: boolean;
  /** Angle (rad) from the car's heading to the ball, for the head turn. */
  look: number;
  /** 0..1 cheering (a goal for this team). */
  cheer: number;
  /** The Bloxity emote this driver is playing ('' none) and seconds since it began. */
  emote: string;
  emoteTime: number;
}

/**
 * The player's blocky avatar, posed sitting in the car.
 *
 *   root     placed in the cockpit by the car
 *     visual  lean and bounce
 *       model  the bundled FBX or the player's Bloxity body, posed by the rig
 */
export class PlayerCharacter {
  readonly root = new Group();
  private readonly visual = new Group();
  private readonly defaultModel: Object3D;
  private model: Object3D;
  private rig: PlayerRig;
  private readonly pose = new PoseBuffer();
  private t = Math.random() * 10;
  private lean = 0;
  private pitch = 0;
  private head = 0;
  private clock = 0;
  /** The Bloxity emote layer (arms, torso, head; never the legs), over the seated pose. */
  readonly emote = new BloxityEmotePlayer();

  constructor() {
    this.defaultModel = playerModelLoader.createInstance();
    this.model = this.defaultModel;
    this.model.rotation.y = Math.PI / 2;
    this.root.add(this.visual);
    this.visual.add(this.model);
    this.rig = new PlayerRig(this.model, this.model);
  }

  get body(): { visual: Group; model: Object3D } {
    return { visual: this.visual, model: this.model };
  }

  /** Wear a different body, or null for the bundled one. */
  setModel(next: Object3D | null): Object3D {
    const target = next ?? this.defaultModel;
    if (target === this.model) return target;
    const previous = this.model;
    previous.removeFromParent();
    releaseBody(previous);
    target.rotation.y = Math.PI / 2;
    this.rig = new PlayerRig(target, target);
    this.rig.resetToBindPose();
    this.model = target;
    this.visual.add(target);
    this.bodyVersion += 1;
    return target;
  }

  update(dt: number, m: RiderMotion): void {
    this.t += dt;
    const k = Math.min(1, dt * 8);
    this.lean += (Math.max(-0.35, Math.min(0.35, m.lateral * 0.18)) - this.lean) * k;
    this.pitch += (Math.max(-0.25, Math.min(0.3, -m.surge * 0.1)) - this.pitch) * k;
    this.head += (Math.max(-1.1, Math.min(1.1, m.look)) - this.head) * Math.min(1, dt * 6);
    const p = this.pose;
    p.applyDefinition(SEATED);
    // hands turn the wheel
    const s = m.steer * 0.55;
    p.add('ArmL1', s * 0.5, 0, s * 0.4);
    p.add('ArmR1', -s * 0.5, 0, s * 0.4);
    p.add('Spine2', 0, -s * 0.15, 0);
    // body rides the forces
    p.add('Spine1', this.pitch, 0, this.lean);
    p.add('Neck1', -this.pitch * 0.6, this.head * 0.8, -this.lean * 0.5);
    if (m.boosting) p.add('Spine1', 0.12, 0, 0);
    if (m.airborne) {
      p.add('ArmL1', -0.25, 0, -0.2);
      p.add('ArmR1', -0.25, 0, 0.2);
    }
    if (m.cheer > 0) {
      const w = Math.sin(this.t * 14) * 0.25;
      p.add('ArmL1', -2.4 * m.cheer, 0, -0.4 * m.cheer + w);
      p.add('ArmR1', -2.4 * m.cheer, 0, 0.4 * m.cheer - w);
      p.add('ArmL2', -0.4 * m.cheer, 0, 0);
      p.add('ArmR2', -0.4 * m.cheer, 0, 0);
    }
    // a Bloxity emote, while the hands are free of the wheel (the same rule as the server's clear)
    this.clock += dt;
    this.emote.skip = SEATED_SKIP;
    try {
      const free = Math.abs(m.steer) <= EMOTE.steerStop && !m.boosting && !m.airborne;
      this.emote.update(dt, this.clock, m.emote, m.emoteTime, free);
    } catch {
      this.emote.clear(); // cosmetic: never allowed to break a frame
    }
    this.rig.applyPose(p, this.emote);
    // breathing / engine shake
    this.visual.position.y = Math.sin(this.t * 2.2) * 0.004 + (m.boosting ? Math.sin(this.t * 60) * 0.003 : 0);
  }

  private stride = 0;
  private gait = 0;
  private air = 0;

  /**
   * ON FOOT (the lobby): a procedural walk / run cycle - legs and arms in
   * opposition, knees bending on the back swing, a forward lean and a little
   * bounce with speed - an idle sway standing still, a tuck in the air, and
   * Bloxity emotes over the WHOLE body (nothing skipped), which stop as soon
   * as the walker moves.
   */
  walk(dt: number, m: WalkMotion): void {
    this.t += dt;
    const target = Math.min(1, m.speed / 4.5);
    this.gait += (target - this.gait) * Math.min(1, dt * 10);
    this.air += ((m.airborne ? 1 : 0) - this.air) * Math.min(1, dt * 12);
    this.stride += dt * (m.speed > 0.2 ? 3.6 + m.speed * 1.05 : 0);
    const a = this.gait * (1 - this.air);
    const s = Math.sin(this.stride);
    const run = Math.max(0, Math.min(1, (m.speed - 4.5) / 3));
    const p = this.pose;
    p.applyDefinition({});
    // legs (x+ swings a leg back) with the knee folding behind
    p.add('LegL1', s * 0.75 * a, 0, 0);
    p.add('LegR1', -s * 0.75 * a, 0, 0);
    p.add('LegL2', Math.max(0, s) * (1.0 + run * 0.5) * a, 0, 0);
    p.add('LegR2', Math.max(0, -s) * (1.0 + run * 0.5) * a, 0, 0);
    // arms counter-swing, elbows bent more when running
    p.add('ArmL1', -s * 0.65 * a, 0, -0.08);
    p.add('ArmR1', s * 0.65 * a, 0, 0.08);
    p.add('ArmL2', (0.25 + run * 0.7) * a, 0, 0);
    p.add('ArmR2', (0.25 + run * 0.7) * a, 0, 0);
    p.add('Spine1', 0.06 * a + run * 0.12 + Math.sin(this.t * 1.7) * 0.015 * (1 - a), s * 0.1 * a, 0);
    p.add('Neck1', -0.04 * a - run * 0.08, 0, 0);
    // in the air: knees up, arms out
    if (this.air > 0.01) {
      const k = this.air;
      p.add('LegL1', -0.6 * k, 0, 0);
      p.add('LegR1', -0.25 * k, 0, 0);
      p.add('LegL2', 0.9 * k, 0, 0);
      p.add('LegR2', 0.5 * k, 0, 0);
      p.add('ArmL1', -0.5 * k, 0, -0.55 * k);
      p.add('ArmR1', -0.5 * k, 0, 0.55 * k);
    }
    this.clock += dt;
    this.emote.skip = NO_SKIP;
    try {
      this.emote.update(dt, this.clock, m.emote, m.emoteTime, m.speed < 0.3 && !m.airborne);
    } catch {
      this.emote.clear();
    }
    this.rig.applyPose(p, this.emote);
    this.visual.position.y = Math.abs(Math.cos(this.stride)) * 0.07 * a;
  }

  /** Bumped whenever the body changes (the seat must be re-measured). */
  bodyVersion = 0;

  /** The midpoint of the hips in root space (unscaled), with the current pose applied. */
  hipLocal(out: Vector3): Vector3 | null {
    const l = this.rig.getBone('LegL1');
    const r = this.rig.getBone('LegR1');
    if (!l || !r) return null;
    this.root.updateMatrixWorld(true);
    const a = l.getWorldPosition(HIP_A);
    const b = r.getWorldPosition(HIP_B);
    out.copy(a).add(b).multiplyScalar(0.5);
    this.root.worldToLocal(out);
    return out;
  }

  dispose(): void {
    releaseBody(this.model);
    this.root.removeFromParent();
  }
}

const SEATED_SKIP: ReadonlySet<string> = new Set(EMOTE_SKIP_BONES);
const HIP_A = new Vector3();
const HIP_B = new Vector3();

/** Let go of a Bloxity body's materials when it is swapped out. */
const releaseBody = (model: Object3D): void => {
  if (model.userData['bloxityBody'] !== true) return;
  model.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
};
