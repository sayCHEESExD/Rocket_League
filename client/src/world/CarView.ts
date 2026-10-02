import { TEAMS, type AvatarAppearance, type AvatarProportions } from '@rlb/shared';
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DoubleSide,
  PlaneGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from 'three';
import { AvatarDresser } from '../bloxity/AvatarDresser.js';
import { NameTag } from '../player/NameTag.js';
import { PlayerCharacter, type RiderMotion } from '../player/PlayerCharacter.js';
import { CAR_MODELS, GROUND, buildCar, type BuiltCar } from './cars/CarModels.js';
import { S } from './units.js';

export { GROUND as GROUND_Y };

/** Tinted glass, dark like the reference cars' - the driver still shows through. */
const glassMaterial = new MeshStandardMaterial({
  color: 0x0c1520,
  metalness: 0.85,
  roughness: 0.04,
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
  envMapIntensity: 2,
  side: DoubleSide,
  // the glass loft dips into the body and runs just under the roof lid: push it back in depth so
  // the opaque paint always wins where they nearly coincide (that was the shimmer on some cars)
  polygonOffset: true,
  polygonOffsetFactor: 2,
  polygonOffsetUnits: 4,
});

/** The team marker under every car: a soft glow in the team colour on whatever it drives on. */
let glowTex: CanvasTexture | null = null;
const glowTexture = (): CanvasTexture => {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.translate(64, 32);
  g.scale(2, 1);
  // a ring, dark in the middle: it outlines the car in its team colour without washing out the
  // car's own contact shadow underneath
  const grad = g.createRadialGradient(0, 0, 2, 0, 0, 31);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(-32, -32, 64, 64);
  glowTex = new CanvasTexture(c);
  return glowTex;
};
const glowGeo = new PlaneGeometry(2.2, 1.4).rotateX(-Math.PI / 2);
const glowMaterials = TEAMS.map(
  (t) => new MeshBasicMaterial({ map: glowTexture(), color: new Color(t.color).multiplyScalar(1.5), transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
);

const flameGeo = (() => {
  const g = new ConeGeometry(0.06, 0.5, 10, 1, true);
  g.rotateZ(Math.PI / 2);
  g.translate(-0.25, 0, 0);
  return g;
})();
const flameCore = new MeshBasicMaterial({ color: new Color(5.5, 5, 3.4), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
const flameOuter = new MeshBasicMaterial({ color: new Color(4, 1.4, 0.3), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, toneMapped: false });

/** Rubber for every tyre. */
const tyreMaterial = new MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.88, side: DoubleSide });

/** Every wheel of one car model in two draw calls: the tyres and the rims. */
export class WheelPool {
  /** The tyres (first) and the rims. */
  readonly meshes: InstancedMesh[];
  private n = 0;
  private readonly cap: number;
  constructor(tyre: BufferGeometry, rim: BufferGeometry, rimMetal: number, max: number) {
    const rimMaterial = new MeshStandardMaterial({ vertexColors: true, metalness: rimMetal, roughness: 0.26, side: DoubleSide, envMapIntensity: 1.3 });
    this.meshes = [new InstancedMesh(tyre, tyreMaterial, max), new InstancedMesh(rim, rimMaterial, max)];
    for (const m of this.meshes) {
      m.frustumCulled = false;
      m.castShadow = true;
      m.name = 'wheels';
    }
    this.cap = max;
  }
  begin(): void {
    this.n = 0;
  }
  push(m: Matrix4): void {
    if (this.n < this.cap) {
      for (const mesh of this.meshes) mesh.setMatrixAt(this.n, m);
      this.n += 1;
    }
  }
  end(): void {
    // draw only the wheels in use (unused slots used to cost their full geometry)
    for (const mesh of this.meshes) {
      mesh.count = this.n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

/** One wheel pool per car model and detail level, created on demand and added to `parent`. */
export class Wheels {
  private readonly pools = new Map<number, WheelPool>();
  constructor(private readonly parent: Group | { add(o: unknown): void }, private readonly max: number) {}
  pool(model: number, lod = 0): WheelPool {
    const key = model * 2 + lod;
    let p = this.pools.get(key);
    if (!p) {
      const b = buildCar(model);
      const l = b.lods[lod]!;
      p = new WheelPool(l.tyre, l.rim, b.rimMetal, this.max);
      this.pools.set(key, p);
      for (const m of p.meshes) (this.parent as Group).add(m);
    }
    return p;
  }
  begin(): void {
    for (const p of this.pools.values()) p.begin();
  }
  end(): void {
    for (const p of this.pools.values()) p.end();
  }
}

/** A soft round shadow, shared texture. */
let shadowTex: CanvasTexture | null = null;
export const shadowTexture = (): CanvasTexture => {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(0,0,0,0.6)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.32)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  shadowTex = new CanvasTexture(c);
  shadowTex.colorSpace = SRGBColorSpace;
  return shadowTex;
};

let TAG_W = 1;
let TAG_H = 1;
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const spinQ = new Quaternion();
const tmpV = new Vector3();
const ONE = new Vector3(1, 1, 1);
const MIRROR = new Vector3(1, 1, -1);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const hip = new Vector3();

/**
 * One car as everyone sees it: one of the five bodies in its OWN colours (the
 * same on both teams), tinted glass with the player's Bloxity avatar in the
 * driver's seat, emissive lights, boost flames, wheels (drawn by the shared
 * per-model pool). The team shows as a team-colour underglow and name plate.
 */
export class CarView {
  readonly root = new Group();
  private body: Mesh;
  private glass: Mesh;
  readonly rider = new PlayerCharacter();
  private readonly dresser: AvatarDresser;
  readonly tag = new NameTag();
  private readonly flames = new Group();
  private team = -1;
  private model = -1;
  private readonly glow: Mesh;
  private readonly marker: boolean;
  private built!: BuiltCar;
  private wheelSpin = 0;
  private steerVis = 0;
  boostVis = 0;
  private flick = 0;
  private seatVersion = -1;
  private seatFrames = 0;
  showName = true;

  /** `showroom`: the garage car - no team marker. */
  constructor(team: number, model: number, showroom = false) {
    this.team = team;
    this.body = new Mesh();
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.glow = new Mesh(glowGeo, glowMaterials[team === 1 ? 1 : 0]);
    this.glow.position.set(0.05, GROUND + 0.012, 0);
    this.glow.renderOrder = 2;
    this.marker = !showroom;
    this.glow.visible = this.marker;
    this.root.add(this.glow);
    this.glass = new Mesh(undefined, glassMaterial);
    this.glass.renderOrder = 3;
    this.root.add(this.body, this.glass, this.rider.root, this.flames);
    this.dresser = new AvatarDresser(this.rider);
    for (const s of [-1, 1]) {
      const outer = new Mesh(flameGeo, flameOuter);
      const core = new Mesh(flameGeo, flameCore);
      core.scale.set(0.7, 0.55, 0.55);
      outer.userData['side'] = s;
      core.userData['side'] = s;
      this.flames.add(outer, core);
    }
    this.flames.visible = false;
    this.tag.sprite.position.set(0, 1.05, 0);
    this.tag.sprite.scale.multiplyScalar(0.42);
    TAG_W = this.tag.sprite.scale.x;
    TAG_H = this.tag.sprite.scale.y;
    this.root.add(this.tag.sprite);
    this.setModel(model);
  }

  get modelId(): number {
    return this.model;
  }

  setModel(model: number): void {
    const id = CAR_MODELS[model] ? model : 0;
    if (id === this.model) return;
    this.model = id;
    this.rebuild();
  }

  /** The team changes the marker and the plate, never the paint. */
  setTeam(team: number): void {
    if (team === this.team) return;
    this.team = team;
    this.glow.material = glowMaterials[team === 1 ? 1 : 0]!;
  }

  /** Detail level: 0 near, 1 far (coarser loft, plainer wheels - same livery). */
  private lod = 0;

  private rebuild(): void {
    const b = buildCar(this.model);
    this.built = b;
    this.body.material = b.material;
    this.applyLod();
    const spec = CAR_MODELS[this.model]!;
    const nz = spec.nozzles;
    for (const f of this.flames.children) {
      const n = nz[(f.userData['side'] as number) > 0 ? 0 : 1] ?? nz[0]!;
      f.position.set(n[0] - 0.02, GROUND + n[1], n[2]);
    }
    this.rider.root.scale.setScalar(spec.seat.scale);
    this.seatVersion = -1;
  }

  private applyLod(): void {
    const l = this.built.lods[this.lod]!;
    this.body.geometry = l.body;
    this.glass.geometry = l.glass;
  }

  /** Every plate looks the same: nobody can tell a bot's car from a player's. */
  setName(name: string): void {
    this.tag.set(name, TEAMS[this.team]?.color ?? null, '');
  }

  setLook(appearance: AvatarAppearance, proportions: AvatarProportions): void {
    this.dresser.setLook(appearance, proportions);
  }

  /** Put the avatar's hips on the seat, re-measured whenever its body changes. */
  private seat(): void {
    const v = this.rider.bodyVersion;
    if (v === this.seatVersion && this.seatFrames > 3) return;
    if (v !== this.seatVersion) {
      this.seatFrames = 0;
      // the rider sits inside the car, whose body already casts the shadow: its own dozen avatar
      // meshes would only cost shadow-pass draw calls (~2 ms) for nothing visible
      this.rider.root.traverse((o) => (o.castShadow = false));
    }
    this.seatVersion = v;
    this.seatFrames += 1;
    const spec = CAR_MODELS[this.model]!.seat;
    const r = this.rider.root;
    if (!this.rider.hipLocal(hip)) return;
    r.position.set(spec.x - hip.x * spec.scale, GROUND + spec.h - hip.y * spec.scale, -hip.z * spec.scale);
  }

  /**
   * Per frame: wheels (pushed into the shared pool in world space), flames,
   * rider. `speed` is forward speed in uu/s; `steer` -1..1.
   */
  update(dt: number, speed: number, steer: number, boosting: boolean, onGround: boolean, wheels: Wheels, motion: RiderMotion, cameraDistance: number): void {
    const b = this.built;
    this.wheelSpin += (speed * S * dt) / b.wheelR;
    // capped so a steered tyre stays inside its wheel well
    this.steerVis += (steer * 0.3 - this.steerVis) * Math.min(1, dt * 14);
    // the underglow is light on the surface under the car, so it goes out in the air
    this.glow.visible = this.marker && onGround;
    this.boostVis += ((boosting ? 1 : 0) - this.boostVis) * Math.min(1, dt * (boosting ? 30 : 12));
    this.flick += dt;
    this.flames.visible = this.boostVis > 0.05;
    if (this.flames.visible) {
      const f = 0.75 + Math.sin(this.flick * 47) * 0.12 + Math.random() * 0.18;
      this.flames.scale.set(this.boostVis * f * 1.2, 0.8 + this.boostVis * 0.4, 0.8 + this.boostVis * 0.4);
    }
    this.root.updateMatrixWorld();
    // far cars swap to the coarse body and wheels (with a band so they do not flicker)
    const want = this.lod === 0 ? (cameraDistance > 26 ? 1 : 0) : cameraDistance < 21 ? 0 : 1;
    if (want !== this.lod) {
      this.lod = want;
      this.applyLod();
    }
    const pool = wheels.pool(this.model, this.lod);
    const drop = onGround ? 0 : -0.03;
    spinQ.setFromAxisAngle(AXIS_Z, -this.wheelSpin);
    for (let i = 0; i < 4; i += 1) {
      const [x, y, z] = b.wheelPos[i]!;
      tmpQ.setFromAxisAngle(AXIS_Y, i < 2 ? -this.steerVis : 0).multiply(spinQ);
      tmpV.set(x, y + drop, z);
      // left wheels are mirrored so every rim faces outwards
      tmpM.compose(tmpV, tmpQ, z < 0 ? MIRROR : ONE);
      tmpM.premultiply(this.root.matrixWorld);
      pool.push(tmpM);
    }
    if (cameraDistance < 45) {
      this.rider.update(dt, motion);
      this.seat();
    }
    this.tag.sprite.visible = this.showName;
    const k = Math.max(0.55, Math.min(1.6, cameraDistance / 9));
    this.tag.sprite.scale.set(TAG_W * k, TAG_H * k, 1);
    this.tag.sprite.position.y = 0.85 + k * 0.12;
  }

  dispose(): void {
    this.dresser.dispose();
    this.rider.dispose();
    this.tag.dispose();
    this.root.removeFromParent();
  }
}

