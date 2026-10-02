import { mat, sec } from '../loft.js';
import { carbon, chrome, gloss, grille, honey, inPoly, led, satin, seg, slats, wheelDist, type CarModel } from '../paintkit.js';

/**
 * VIPER GT - the green supercar (reference 1): tall front fenders over big wheels, a
 * blunt black fascia framed in green (a centre bar and a brow), slim angular LEDs at
 * its top corners, a black slot across the hood, chunky black overfenders, a black
 * lower flank that sweeps up into a rear-quarter intake, a long raked cabin flowing
 * into the deck, and a low black wing. Twin-five-spoke black rims, red calipers.
 */
export const viper: CarModel = {
  id: 0,
  name: 'VIPER GT',
  tagline: 'Low, wide and mean. Wide-body supercar with a high wing.',
  body: [
    sec(0.875, { yb: 0.075, ht: 0.268, w: 0.365, hw: 0.14, wb: 0.32, hs: 0.258, ws: 0.36, wt: 0.3, crown: -0.008, rw: 0.02, rs: 0.012, rt: 0.02 }),
    sec(0.83, { yb: 0.068, ht: 0.302, w: 0.44, hw: 0.15, wb: 0.4, hs: 0.288, ws: 0.433, wt: 0.35, crown: -0.022, rw: 0.03, rs: 0.014, rt: 0.03 }),
    sec(0.72, { yb: 0.065, ht: 0.338, w: 0.474, hw: 0.17, hs: 0.32, ws: 0.464, wt: 0.38, crown: -0.048, rs: 0.014, rt: 0.045 }),
    sec(0.6, { yb: 0.065, ht: 0.362, w: 0.486, hw: 0.19, hs: 0.34, ws: 0.476, wt: 0.388, crown: -0.064, rs: 0.014, rt: 0.06 }),
    sec(0.5, { yb: 0.065, ht: 0.372, w: 0.488, hw: 0.2, hs: 0.35, ws: 0.478, wt: 0.39, crown: -0.066, rs: 0.014, rt: 0.06 }),
    sec(0.39, { yb: 0.065, ht: 0.366, w: 0.48, hw: 0.2, hs: 0.346, ws: 0.47, wt: 0.386, crown: -0.05, rs: 0.014, rt: 0.06 }),
    sec(0.28, { yb: 0.065, ht: 0.36, w: 0.462, hw: 0.2, hk: 0.11, wk: 0.458, hs: 0.34, ws: 0.452, wt: 0.376, crown: -0.026, rs: 0.014, rt: 0.05 }),
    sec(0.12, { yb: 0.065, ht: 0.362, w: 0.455, hw: 0.2, hk: 0.11, wk: 0.45, hs: 0.342, ws: 0.445, wt: 0.372, crown: -0.008, rs: 0.014, rt: 0.05 }),
    sec(-0.04, { yb: 0.065, ht: 0.368, w: 0.46, hw: 0.2, hk: 0.11, wk: 0.454, hs: 0.348, ws: 0.45, wt: 0.378, crown: -0.006, rs: 0.014, rt: 0.05 }),
    sec(-0.2, { yb: 0.067, ht: 0.378, w: 0.478, hw: 0.205, hs: 0.356, ws: 0.468, wt: 0.392, crown: -0.014, rs: 0.014, rt: 0.05 }),
    sec(-0.33, { yb: 0.07, ht: 0.388, w: 0.497, hw: 0.21, hs: 0.362, ws: 0.486, wt: 0.402, crown: -0.032, rs: 0.014, rt: 0.06 }),
    sec(-0.43, { yb: 0.075, ht: 0.388, w: 0.498, hw: 0.215, hs: 0.362, ws: 0.487, wt: 0.402, crown: -0.032, rs: 0.014, rt: 0.06 }),
    sec(-0.53, { yb: 0.085, ht: 0.376, w: 0.485, hw: 0.22, hs: 0.352, ws: 0.472, wt: 0.39, crown: -0.02, rs: 0.014, rt: 0.05 }),
    sec(-0.61, { yb: 0.1, ht: 0.36, w: 0.46, hw: 0.23, hs: 0.338, ws: 0.448, wt: 0.37, crown: -0.008, rs: 0.014, rt: 0.04 }),
    sec(-0.665, { yb: 0.13, ht: 0.336, w: 0.42, hw: 0.24, hs: 0.318, ws: 0.41, wt: 0.34, crown: -0.004, rs: 0.012, rt: 0.025 }),
  ],
  cabin: [
    { x: 0.31, yb: 0.33, yt: 0.346, wb: 0.38, wt: 0.362 },
    { x: 0.17, yb: 0.338, yt: 0.47, wb: 0.386, wt: 0.31 },
    { x: 0.01, yb: 0.348, yt: 0.56, wb: 0.388, wt: 0.284 },
    { x: -0.17, yb: 0.355, yt: 0.572, wb: 0.392, wt: 0.282 },
    { x: -0.33, yb: 0.362, yt: 0.515, wb: 0.398, wt: 0.3 },
    { x: -0.47, yb: 0.368, yt: 0.408, wb: 0.402, wt: 0.37 },
    { x: -0.53, yb: 0.368, yt: 0.38, wb: 0.402, wt: 0.392 },
  ],
  roof: [0.05, -0.3],
  palette: {
    green: mat(0x1ccc3a, 0.24, 0.42, 1),
    black: satin(),
    gloss: gloss(0x0b0c0f),
    carbon: carbon(),
    chrome: chrome(),
    grille: grille(),
    led: led(0xeef8ff),
    tail: led(0xff1c1c),
    red: mat(0xd41c1c, 0.3, 0.3, 1),
  },
  paint(p, c) {
    const { x, h, z } = p;
    const G = c.green!;
    const K = c.black!;
    // the front, drawn once as seen head-on: a black honeycomb grille split by a green beak,
    // a green bumper band, slim angular LED headlights at the corners, fog LEDs low down
    const front = (): typeof G | null => {
      if (h < 0.09) return K;
      if (h < 0.205) {
        if (z < 0.022 + (h - 0.09) * 0.2) return G;
        if (seg(z, h, 0.335, 0.118, 0.4, 0.124) < 0.0045) return c.led!;
        return honey(z, h, 0.015, K, c.grille!);
      }
      if (h < 0.224) return G;
      const lo = 0.228 + Math.max(0, z - 0.17) * 0.09;
      const hi = 0.262 + Math.max(0, z - 0.17) * 0.035;
      if (z > 0.16 && h > lo && h < hi) {
        if (Math.abs(h - (hi - 0.007)) < 0.0045 || (z < 0.176 && h > lo + 0.004)) return c.led!;
        return c.gloss!;
      }
      return null;
    };
    if (p.surf === 'front') return front() ?? G;
    if (p.surf === 'rear') {
      if (Math.abs(h - 0.292) < 0.007 && z < 0.38) return c.tail!;
      if (h > 0.31) return G;
      return h < 0.24 && z < 0.34 ? slats(h, 0.014, c.carbon!, c.grille!) : K;
    }
    if (p.surf === 'lid') return G;
    if (h < 0.118) return K;
    // ---- the front
    if (x > 0.7 && p.nx > 0.3) {
      const f = front();
      if (f) return f;
    }
    // the black slot across the front of the hood
    if (p.ny > 0.5 && x > 0.735 && x < 0.785 && z < 0.17) return x > 0.776 || x < 0.744 ? G : slats(z, 0.02, K, c.grille!, 0.3);
    // ---- the flank: black skirt rising into the rear quarter, the intake before the rear wheel
    if (p.nz > 0.25) {
      const skirt = 0.132 + Math.max(0, -0.02 - x) * 0.2;
      if (inPoly(x, h, [-0.12, 0.165, -0.2, 0.275, -0.285, 0.275, -0.285, 0.165])) return h > 0.18 && h < 0.262 && x < -0.14 ? slats(h, 0.014, K, c.grille!) : K;
      if (h < Math.min(skirt, 0.2) && x > -0.33) return K;
      // door shut lines and handle
      if (h > 0.14 && h < 0.33 && (Math.abs(x - 0.33) < 0.0022 || Math.abs(x + 0.1) < 0.0022)) return c.carbon!;
      if (Math.abs(h - 0.3) < 0.006 && x < -0.03 && x > -0.08) return c.carbon!;
    }
    // black behind the rear wheel and round the tail lights
    if (x < -0.58 && h < 0.25) return K;
    if (p.nz > 0.25 && wheelDist(p, -0.4, 0.17) < 0.2) return K;
    return G;
  },
  wheels: { r: 0.17, width: 0.135, front: 0.5, rear: -0.4, track: 0.41, style: 'twin5', rim: 0x24272d, lip: 0x31353c, accent: 0x15171b, metal: 0.7 },
  caliper: 'red',
  pillar: 'gloss',
  parts: (p) => {
    // chunky black overfenders, splitter, skirts, diffuser and fins, quad exhausts
    p.flare('black', 0.5, 0.17, 0.192, 0.236, 0.05, Math.PI - 0.05, 0.43, 0.5);
    p.flare('black', -0.4, 0.17, 0.194, 0.24, 0.05, Math.PI - 0.05, 0.445, 0.508);
    p.plan('carbon', [[0.905, 0], [0.905, 0.3], [0.87, 0.4], [0.78, 0.45], [0.72, 0.45]], 0.05, 0.014);
    p.box('black', 0.58, 0.05, 0.035, 0.05, 0.088, 0.464, undefined, true);
    p.plan('carbon', [[-0.6, 0], [-0.6, 0.38], [-0.705, 0.36], [-0.705, 0]], 0.07, 0.012);
    for (const zz of [0.09, 0.2, 0.31]) p.side('carbon', [[-0.58, 0.078], [-0.705, 0.078], [-0.705, 0.17], [-0.66, 0.17]], zz - 0.005, zz + 0.005);
    for (const zz of [0.07, 0.13]) p.cyl('chrome', 0.022, 0.022, 0.06, -0.668, 0.15, zz, 'x', 14, true);
    // the wing on short swan necks, with endplates - kept low so the driver shows over it
    p.beam('black', [-0.52, 0.36, 0.2], [-0.56, 0.45, 0.2], 0.024, 0.012);
    p.wing('black', -0.49, 0.45, 0.2, 0.032, 0.98, 0.1);
    p.side('black', [[-0.47, 0.36], [-0.7, 0.37], [-0.71, 0.5], [-0.49, 0.49]], 0.478, 0.488);
    p.mirror('green', 'black', 0.22, 0.405, 0.448);
  },
  seat: { x: -0.17, h: 0.17, scale: 0.17 },
  nozzles: [[-0.67, 0.21, 0.12], [-0.67, 0.21, -0.12]],
};
