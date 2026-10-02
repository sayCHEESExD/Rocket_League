import { mat, sec } from '../loft.js';
import { chrome, gloss, grille, honey, led, satin, type CarModel } from '../paintkit.js';

/**
 * HOTSHOT - the red hot hatch (reference 3): boxy and tall, a gloss black greenhouse
 * and roof, slim headlights joined by a light bar with a round badge, a big white aero
 * blade round black honeycomb intakes, white skirts, white mirrors, a roof spoiler and
 * a tall red wing on swan necks, silver twisted five-spoke rims.
 */
export const hotshot: CarModel = {
  id: 3,
  name: 'HOTSHOT',
  tagline: 'Hot hatch with a race kit. Boxy, nimble, loud.',
  body: [
    sec(0.8, { yb: 0.1, ht: 0.245, w: 0.385, hw: 0.15, wb: 0.34, hs: 0.23, ws: 0.38, wt: 0.3, crown: 0.004, rw: 0.03, rs: 0.02, rt: 0.03 }),
    sec(0.74, { yb: 0.084, ht: 0.3, w: 0.44, hw: 0.16, hs: 0.282, ws: 0.435, wt: 0.36, crown: 0.004, rs: 0.02, rt: 0.04 }),
    sec(0.62, { yb: 0.084, ht: 0.335, w: 0.452, hw: 0.17, hs: 0.316, ws: 0.447, wt: 0.38, crown: 0.01, rs: 0.02, rt: 0.05 }),
    sec(0.47, { yb: 0.084, ht: 0.356, w: 0.455, hw: 0.17, hs: 0.336, ws: 0.45, wt: 0.385, crown: 0.012, rs: 0.02, rt: 0.05 }),
    sec(0.3, { yb: 0.084, ht: 0.372, w: 0.452, hw: 0.175, hs: 0.352, ws: 0.447, wt: 0.385, crown: 0.012, rs: 0.02, rt: 0.05 }),
    sec(0.05, { yb: 0.084, ht: 0.385, w: 0.452, hw: 0.18, hs: 0.362, ws: 0.447, wt: 0.39, rs: 0.02, rt: 0.05 }),
    sec(-0.22, { yb: 0.084, ht: 0.395, w: 0.457, hw: 0.185, hs: 0.37, ws: 0.451, wt: 0.39, rs: 0.02, rt: 0.05 }),
    sec(-0.43, { yb: 0.087, ht: 0.395, w: 0.455, hw: 0.19, hs: 0.37, ws: 0.449, wt: 0.39, rs: 0.02, rt: 0.05 }),
    sec(-0.52, { yb: 0.1, ht: 0.39, w: 0.44, hw: 0.2, hs: 0.366, ws: 0.433, wt: 0.38, rs: 0.02, rt: 0.04 }),
    sec(-0.565, { yb: 0.115, ht: 0.384, w: 0.42, hw: 0.21, hs: 0.36, ws: 0.414, wt: 0.37, rs: 0.02, rt: 0.025 }),
  ],
  cabin: [
    { x: 0.31, yb: 0.36, yt: 0.376, wb: 0.405, wt: 0.395 },
    { x: 0.18, yb: 0.37, yt: 0.52, wb: 0.405, wt: 0.345 },
    { x: 0.02, yb: 0.375, yt: 0.6, wb: 0.4, wt: 0.335 },
    { x: -0.3, yb: 0.38, yt: 0.61, wb: 0.4, wt: 0.335 },
    { x: -0.46, yb: 0.385, yt: 0.588, wb: 0.4, wt: 0.345 },
    { x: -0.545, yb: 0.385, yt: 0.4, wb: 0.4, wt: 0.385 },
  ],
  roof: [0.06, -0.52],
  palette: {
    red: mat(0xbb1040, 0.25, 0.3, 1),
    white: mat(0xf3f4f6, 0.28, 0.1, 1),
    black: satin(),
    gloss: gloss(0x0a0b0e),
    chrome: chrome(),
    grille: grille(),
    led: led(0xe8f6ff),
    blue: led(0x6cc6ff),
    tail: led(0xff1d2c),
    caliper: mat(0xd41c1c, 0.3, 0.3, 1),
  },
  paint(p, c) {
    const { x, h, z } = p;
    const R = c.red!;
    const W = c.white!;
    const K = c.black!;
    // the front, as seen head-on: white lip and a big white blade round the black honeycomb
    // intake (black vents cut into its corners), a red bumper top, the gloss black grille band
    // with the light bar and the round badge, slim headlights with a blue LED underline
    const front = (): typeof R | null => {
      if (h < 0.098) return W;
      if (h < 0.205) {
        if (z > 0.3) return z > 0.335 && z < 0.372 && h > 0.112 && h < 0.19 ? honey(z, h, 0.012, K, c.grille!) : W;
        if (z > 0.285) return W;
        return honey(z, h, 0.016, K, c.grille!);
      }
      if (h < 0.214) return R;
      const d = Math.hypot(z, h - 0.236);
      if (d < 0.019) return d > 0.014 || (z < 0.0035 && h < 0.248) || Math.abs(h - 0.236 - z * 0.6) < 0.003 ? W : c.gloss!;
      if (z < 0.2 && h < 0.258) return Math.abs(h - 0.236) < 0.0028 ? c.led! : c.gloss!;
      const lo = 0.222 + (z - 0.2) * 0.12;
      const hi = 0.258 + (z - 0.2) * 0.07;
      if (z >= 0.2 && h > lo && h < hi) {
        if (h < lo + 0.008) return c.blue!;
        if (Math.abs(h - (hi - 0.006)) < 0.0028) return c.led!;
        return c.gloss!;
      }
      return null;
    };
    if (p.surf === 'front') return front() ?? R;
    if (p.surf === 'rear') {
      if (h > 0.29 && h < 0.33 && z > 0.24) return c.tail!;
      if (h < 0.17) return h < 0.12 ? W : K;
      return R;
    }
    if (p.surf === 'lid') return c.gloss!;
    if (h < 0.083) return K;
    if (h < 0.112) return W;
    if (x > 0.66 && p.nx > 0.3) {
      const f = front();
      if (f) return f;
    }
    if (x < -0.54 && h > 0.29 && h < 0.33 && p.nz > 0.2) return c.tail!;
    // door shut lines, a handle
    if (p.nz > 0.5 && h > 0.12 && h < 0.36 && (Math.abs(x - 0.26) < 0.0022 || Math.abs(x + 0.2) < 0.0022)) return K;
    if (p.nz > 0.5 && Math.abs(h - 0.31) < 0.006 && x < 0.16 && x > 0.1) return K;
    return R;
  },
  wheels: { r: 0.17, width: 0.128, front: 0.5, rear: -0.38, track: 0.41, style: 'turbine5', rim: 0xc5cad3, lip: 0xd8dce3, accent: 0x2a2d33, metal: 0.85 },
  caliper: 'caliper',
  pillar: 'gloss',
  parts: (p) => {
    p.plan('white', [[0.86, 0], [0.86, 0.3], [0.82, 0.4], [0.72, 0.45]], 0.06, 0.014);
    // the white blades: fins standing proud at the front corners, framing the intake
    p.side('white', [[0.855, 0.07], [0.815, 0.07], [0.79, 0.2], [0.808, 0.205], [0.835, 0.12], [0.86, 0.11]], 0.282, 0.3);
    p.side('white', [[0.83, 0.07], [0.74, 0.07], [0.74, 0.1], [0.8, 0.1]], 0.4, 0.44);
    p.box('white', 0.58, 0.04, 0.03, 0.06, 0.098, 0.452, undefined, true);
    p.plan('white', [[-0.56, 0], [-0.56, 0.38], [-0.62, 0.35], [-0.62, 0]], 0.09, 0.012);
    p.side('gloss', [[-0.48, 0.61], [-0.6, 0.6], [-0.6, 0.588], [-0.5, 0.596]], null, 0.72);
    for (const zz of [-0.2, 0.2]) p.beam('black', [-0.53, 0.44, zz], [-0.58, 0.67, zz], 0.026, 0.014, false);
    p.wing('red', -0.5, 0.68, 0.16, 0.03, 0.86, 0.1);
    p.side('red', [[-0.49, 0.63], [-0.67, 0.64], [-0.67, 0.71], [-0.5, 0.7]], 0.43, 0.44);
    for (const zz of [0.06, 0.11]) p.cyl('chrome', 0.02, 0.02, 0.05, -0.59, 0.125, zz, 'x', 14, true);
    p.mirror('white', 'black', 0.23, 0.435, 0.43);
  },
  seat: { x: -0.16, h: 0.218, scale: 0.17 },
  nozzles: [[-0.6, 0.16, 0.15], [-0.6, 0.16, -0.15]],
};
