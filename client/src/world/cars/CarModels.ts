import { BufferGeometry, MeshPhysicalMaterial, type Texture } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BLOCK, GROUND, bakeLivery, cab, loft, type Carve, type Mat, type Pt, type Station } from './loft.js';
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
  const names = Object.keys(model.palette);
  const swatch = (n: string): number => {
    const i = names.indexOf(n);
    if (i < 0) throw new Error(`${model.name}: no paint "${n}"`);
    return i;
  };
  const paletteList = names.map((n) => model.palette[n]!);
  // under the glass is the cabin: a dark interior, not paint showing through the windows
  const cabX0 = model.cabin[model.cabin.length - 1]!.x;
  const cabX1 = model.cabin[0]!.x;
  const interior: Mat = { r: 14, g: 15, b: 18, rough: 0.8, metal: 0, clear: 0, glow: 0 };
  const cabinAt = (x: number): number => {
    const cs = model.cabin;
    for (let i = 0; i + 1 < cs.length; i += 1) {
      const a = cs[i]!;
      const b = cs[i + 1]!;
      if (x <= a.x && x >= b.x) return a.wb + ((x - a.x) / (b.x - a.x || 1)) * (b.wb - a.wb);
    }
    return 0;
  };
  const paint = (p: Pt): Mat => {
    const inside = p.surf === 'body' && p.ny > 0.35 && p.x < cabX1 && p.x > cabX0;
    p.cab = inside ? p.z - cabinAt(p.x) : 9;
    if (inside && p.x < cabX1 - 0.012 && p.x > cabX0 + 0.012 && p.cab < -0.012) return interior;
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

  // the roof panel: a thin painted lid over the top of the glass
  const roofSts = model.cabin.filter((s) => s.x <= model.roof[0] + 0.13 && s.x >= model.roof[1] - 0.13);
  const lidStations: Station[] = roofSts.map((s) => {
    const cr = s.crown ?? 0.012;
    return {
      x: Math.min(model.roof[0], Math.max(model.roof[1], s.x)),
      p: [
        [s.yt - 0.03, 0, 0],
        [s.yt - 0.03, s.wt + 0.005, 0.003],
        [s.yt - 0.022, s.wt + 0.016, 0.004],
        [s.yt - 0.01, s.wt + 0.017, 0.006],
        [s.yt + 0.004, s.wt + 0.006, 0.01],
        [s.yt + cr * 0.8 + 0.008, s.wt - 0.05, 0.05],
        [s.yt + cr + 0.012, s.wt * 0.38, s.wt * 0.3],
        [s.yt + cr + 0.012, 0, 0],
      ],
    };
  });
  const lid = lidStations.filter((s, i) => lidStations.findIndex((o) => Math.abs(o.x - s.x) < 1e-4) === i);
  const parts = new Parts(swatch);
  model.parts(parts);
  // brake calipers: on the discs behind the spokes, they do not spin
  for (const wx of [wh.front, wh.rear]) {
    parts.box(model.caliper, 0.05, 0.075, 0.03, wx - wh.r * 0.42, wh.r * 1.32, wh.track - wh.width * 0.12, { z: 0.55 }, true);
  }
  // window pillars (A at the windscreen, B in the middle, C at the back)
  const cs = model.cabin;
  const first = cs[0]!;
  const last = cs[cs.length - 1]!;
  const front = cs.find((s) => s.x <= model.roof[0] + 0.001) ?? cs[1]!;
  const back = [...cs].reverse().find((s) => s.x >= model.roof[1] - 0.001) ?? cs[cs.length - 2]!;
  parts.beam(model.pillar, [first.x, first.yt, first.wb * 0.985], [front.x, front.yt - 0.012, front.wt + 0.012], 0.026, 0.02);
  parts.beam(model.pillar, [back.x, back.yt - 0.012, back.wt + 0.012], [last.x, last.yt, last.wb * 0.985], 0.032, 0.02);
  const mid = (front.x + back.x) / 2;
  const midSt = cs.reduce((p, c) => (Math.abs(c.x - mid) < Math.abs(p.x - mid) ? c : p), cs[1]!);
  parts.beam(model.pillar, [mid, midSt.yb + 0.02, midSt.wb + 0.002], [mid, midSt.yt - 0.018, midSt.wt + 0.014], 0.022, 0.016);

  const t0 = performance.now();
  const liv = bakeLivery(model.body, lid.length >= 2 ? lid : null, paletteList, paint, LIVERY_W);
  const bakeMs = performance.now() - t0;
  const lod = (far: boolean): CarLod => {
    const fil = far ? 2 : 4;
    const list = [loft({ stations: model.body, block: BLOCK.body, caps: 'blocks', step: far ? 0.075 : 0.035, fil }, carve)];
    if (lid.length >= 2) list.push(loft({ stations: lid, block: BLOCK.lid, caps: swatch(model.pillar), step: far ? 0.1 : 0.04, fil }));
    const wheel = wheelGeometry(wh, far ? 1 : 0);
    return {
      body: mergeGeometries([...list, ...parts.list])!,
      glass: loft({ stations: cs.map((s) => cab(s.x, s.yb, s.yt, s.wb, s.wt, s.crown)), block: BLOCK.palette, caps: 0, step: far ? 0.12 : 0.04, fil: far ? 2 : 3 }),
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
