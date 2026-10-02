import { BufferGeometry, MeshPhysicalMaterial, type Texture } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BLOCK, GROUND, bakeLivery, cab, loft, shell, type Carve, type Mat, type Pt } from './loft.js';
import { breaker } from './models/breaker.js';
import { frostbite } from './models/frostbite.js';
import { hotshot } from './models/hotshot.js';
import { tempest } from './models/tempest.js';
import { viper } from './models/viper.js';
import type { CarModel } from './paintkit.js';
import { Parts } from './parts.js';
import { wheelGeometry } from './wheels.js';

export { GROUND };
export type { CarModel };

/**
 * THE FIVE CARS, recreated from the user's reference images - one file each in
 * `models/` (shape, palette, painted livery, parts, wheels). Bodies are filleted-section
 * lofts with a baked livery (see loft.ts); all five share ONE hitbox in the sim.
 */
export const CAR_MODELS: CarModel[] = [viper, breaker, tempest, hotshot, frostbite];

/** One level of detail: body (with roof panel, pillars and parts), glass, wheel. */
export interface CarLod {
  body: BufferGeometry;
  glass: BufferGeometry;
  tyre: BufferGeometry;
  rim: BufferGeometry;
}

export interface BuiltCar {
  /** [near, far]: the far one has a coarser loft and plainer wheels, same livery. */
  lods: [CarLod, CarLod];
  material: MeshPhysicalMaterial;
  rimMetal: number;
  /** Wheel centres (front-left, front-right, rear-left, rear-right) and radius. */
  wheelPos: [number, number, number][];
  wheelR: number;
}

const cache = new Map<number, BuiltCar>();
/** Livery resolution: phones get half (a quarter of the memory). */
const LIVERY_W = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 512 : 1024;

/** How strongly painted LEDs and glowing paint emit (HDR: above the bloom threshold). */
const GLOW = 6;

/** The arena's car reflection strength and paint brightness (ThemeLook.carEnv / carShade). */
let carEnv = 1;
const carShade = { value: 1 };
export const setCarEnvironment = (env: number, shade = 1): void => {
  carEnv = env;
  carShade.value = shade;
  for (const b of cache.values()) b.material.envMapIntensity = 0.95 * env;
};

const carMaterial = (albedo: Texture, orm: Texture): MeshPhysicalMaterial => {
  const m = new MeshPhysicalMaterial({
    map: albedo,
    roughnessMap: orm,
    metalnessMap: orm,
    clearcoatMap: orm,
    roughness: 1,
    metalness: 1,
    clearcoat: 0.6,
    clearcoatRoughness: 0.08,
    vertexColors: true,
    envMapIntensity: 0.95 * carEnv,
  });
  // glow comes from the ORM alpha: emission = the painted colour * alpha * GLOW
  m.onBeforeCompile = (sh) => {
    sh.uniforms['carGlow'] = { value: GLOW };
    sh.uniforms['carShade'] = carShade;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float carGlow;\nuniform float carShade;\nvoid main() {')
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= carShade;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb / carShade * texture2D( roughnessMap, vRoughnessMapUv ).a * carGlow;');
  };
  m.customProgramCacheKey = () => 'car-livery';
  return m;
};

/**
 * One car model's geometry and material, always in its own colours: team identity comes
 * from the name plates, the underglow and the HUD, never from repainting.
 */
export const buildCar = (id: number): BuiltCar => {
  const model = CAR_MODELS[id] ?? CAR_MODELS[0]!;
  const hit = cache.get(model.id);
  if (hit) return hit;
  // the cockpit: every car is an open top, so the driver shows - a dark tub with a seat
  // and a roll hoop, from the windscreen base back to just behind the hoop
  const interior: Mat = { r: 14, g: 15, b: 18, rough: 0.8, metal: 0, clear: 0, glow: 0 };
  const palette: Record<string, Mat> = { ...model.palette, __interior: interior };
  const names = Object.keys(palette);
  const swatch = (n: string): number => {
    const i = names.indexOf(n);
    if (i < 0) throw new Error(`${model.name}: no paint "${n}"`);
    return i;
  };
  const paletteList = names.map((n) => palette[n]!);
  const cs = model.cabin;
  /** The glass cabin's section at x (linear between stations). */
  const cabAt = (x: number): { yb: number; yt: number; wb: number; wt: number } => {
    for (let i = 0; i + 1 < cs.length; i += 1) {
      const a = cs[i]!;
      const b = cs[i + 1]!;
      if (x <= a.x && x >= b.x) {
        const t = (x - a.x) / (b.x - a.x || 1);
        return { yb: a.yb + (b.yb - a.yb) * t, yt: a.yt + (b.yt - a.yt) * t, wb: a.wb + (b.wb - a.wb) * t, wt: a.wt + (b.wt - a.wt) * t };
      }
    }
    const e = x > cs[0]!.x ? cs[0]! : cs[cs.length - 1]!;
    return { yb: e.yb, yt: e.yt, wb: e.wb, wt: e.wt };
  };
  const hoopX = model.seat.x - 0.17;
  const pitX0 = Math.max(cs[cs.length - 1]!.x, hoopX - 0.06);
  const pitX1 = cs[0]!.x;
  const paint = (p: Pt): Mat => {
    const inside = p.surf === 'body' && p.ny > 0.35 && p.x < pitX1 && p.x > pitX0;
    p.cab = inside ? p.z - cabAt(p.x).wb : 9;
    if (inside && p.x < pitX1 - 0.012 && p.x > pitX0 + 0.012 && p.cab < -0.012) return interior;
    return model.paint(p, model.palette);
  };

  // wheel wells: the solid loft is pushed in round each wheel so a tyre never shows through
  // the flank - deeper at the front, where the wheels steer (the visual steer is capped in CarView)
  const wh = model.wheels;
  const wells = [
    { x: wh.front, inner: wh.track - wh.width / 2 - 0.05 },
    { x: wh.rear, inner: wh.track - wh.width / 2 - 0.018 },
  ];
  const wellR = wh.r + 0.028;
  const carve: Carve = (x, h, z, below) => {
    if (!below) return null;
    for (const w of wells) {
      const dx = x - w.x;
      const dy = h - wh.r;
      if (dx * dx + dy * dy < wellR * wellR && z > w.inner) return w.inner;
    }
    return null;
  };

  const parts = new Parts(swatch);
  model.parts(parts);
  // brake calipers: on the discs behind the spokes, they do not spin
  for (const wx of [wh.front, wh.rear]) {
    parts.box(model.caliper, 0.05, 0.075, 0.03, wx - wh.r * 0.42, wh.r * 1.32, wh.track - wh.width * 0.12, { z: 0.55 }, true);
  }
  // a short raked windscreen in a frame (A pillars and a top rail), cut well below the old roof
  const first = cs[0]!;
  const screenX = first.x - (first.x - model.roof[0]) * 0.55;
  const top = cabAt(screenX);
  parts.beam(model.pillar, [first.x, first.yt, first.wb * 0.985], [screenX, top.yt - 0.004, top.wt + 0.026], 0.024, 0.018);
  parts.box(model.pillar, 0.022, 0.016, (top.wt + 0.026) * 2, screenX, top.yt + 0.002, 0);
  // a low roll hoop behind the driver - below their head, so the chase camera sees them
  const hoop = cabAt(hoopX);
  const hoopTop = hoop.yb + 0.085;
  parts.beam(model.pillar, [hoopX, hoop.yb - 0.01, 0.24], [hoopX - 0.02, hoopTop, 0.22], 0.022, 0.022);
  parts.box(model.pillar, 0.022, 0.022, 0.462, hoopX - 0.02, hoopTop, 0);

  const t0 = performance.now();
  const liv = bakeLivery(model.body, null, paletteList, paint, LIVERY_W);
  const bakeMs = performance.now() - t0;
  const lod = (far: boolean): CarLod => {
    const fil = far ? 2 : 4;
    const list = [loft({ stations: model.body, block: BLOCK.body, caps: 'blocks', step: far ? 0.075 : 0.035, fil }, carve)];
    const wheel = wheelGeometry(wh, far ? 1 : 0);
    return {
      body: mergeGeometries([...list, ...parts.list])!,
      glass: shell(cs.map((s) => cab(s.x, s.yb, s.yt, s.wb, s.wt, s.crown)), first.x, screenX, 2, 0, far ? 0.08 : 0.03, far ? 2 : 3),
      tyre: wheel.tyre,
      rim: wheel.rim,
    };
  };
  const built: BuiltCar = {
    lods: [lod(false), lod(true)],
    material: carMaterial(liv.albedo, liv.orm),
    rimMetal: wh.metal ?? 0.8,
    wheelPos: [
      [wh.front, GROUND + wh.r, -wh.track],
      [wh.front, GROUND + wh.r, wh.track],
      [wh.rear, GROUND + wh.r, -wh.track],
      [wh.rear, GROUND + wh.r, wh.track],
    ],
    wheelR: wh.r,
  };
  cache.set(model.id, built);
  if (import.meta.env.DEV) console.debug(`[cars] ${model.name}: livery ${bakeMs.toFixed(0)} ms, built ${(performance.now() - t0).toFixed(0)} ms`);
  return built;
};
