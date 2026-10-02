import { mat, sec } from '../loft.js';
import { chrome, gloss, grille, inPoly, led, satin, slats, wheelDist, type CarModel } from '../paintkit.js';

/**
 * TEMPEST - the teal and yellow modern muscle car (reference 4): tall and boxy, a high
 * flat hood with a yellow centre panel, a tall vertical front - teal bumper frame, a thin
 * LED headlight bar under the hood lip with angled ends, a big black slatted grille with
 * an LED line, vertical DRLs in the corners - yellow door panels, angular black cladding
 * round the wheels, an upright greenhouse with a black roof, black multi-spoke rims with
 * a yellow pinstripe and yellow calipers.
 */
export const tempest: CarModel = {
  id: 2,
  name: 'TEMPEST',
  tagline: 'Wide-body modern muscle. Sharp LEDs, big grille.',
  body: [
    sec(0.835, { yb: 0.1, ht: 0.37, w: 0.41, hw: 0.2, wb: 0.38, hs: 0.36, ws: 0.408, wt: 0.355, crown: -0.004, rw: 0.015, rs: 0.01, rt: 0.015 }),
    sec(0.79, { yb: 0.075, ht: 0.396, w: 0.472, hw: 0.2, wb: 0.44, hs: 0.383, ws: 0.467, wt: 0.4, crown: -0.012, rw: 0.02, rs: 0.01, rt: 0.02 }),
    sec(0.68, { yb: 0.068, ht: 0.41, w: 0.49, hw: 0.22, hs: 0.395, ws: 0.482, wt: 0.41, crown: -0.03, rs: 0.01, rt: 0.025 }),
    sec(0.53, { yb: 0.068, ht: 0.416, w: 0.492, hw: 0.22, hs: 0.4, ws: 0.484, wt: 0.412, crown: -0.034, rs: 0.01, rt: 0.025 }),
    sec(0.38, { yb: 0.068, ht: 0.412, w: 0.479, hw: 0.22, hk: 0.12, wk: 0.473, hs: 0.398, ws: 0.471, wt: 0.405, crown: -0.02, rs: 0.01, rt: 0.025 }),
    sec(0.2, { yb: 0.068, ht: 0.41, w: 0.469, hw: 0.22, hk: 0.12, wk: 0.463, hs: 0.395, ws: 0.461, wt: 0.4, crown: -0.005, rs: 0.01, rt: 0.025 }),
    sec(0.0, { yb: 0.068, ht: 0.412, w: 0.469, hw: 0.22, hk: 0.12, wk: 0.463, hs: 0.396, ws: 0.461, wt: 0.4, crown: 0, rs: 0.01, rt: 0.025 }),
    sec(-0.2, { yb: 0.07, ht: 0.418, w: 0.481, hw: 0.225, hs: 0.4, ws: 0.473, wt: 0.41, crown: -0.008, rs: 0.01, rt: 0.025 }),
    sec(-0.36, { yb: 0.072, ht: 0.425, w: 0.496, hw: 0.23, hs: 0.405, ws: 0.487, wt: 0.42, crown: -0.02, rs: 0.01, rt: 0.025 }),
    sec(-0.48, { yb: 0.08, ht: 0.425, w: 0.491, hw: 0.235, hs: 0.405, ws: 0.481, wt: 0.415, crown: -0.015, rs: 0.01, rt: 0.025 }),
    sec(-0.58, { yb: 0.1, ht: 0.41, w: 0.466, hw: 0.24, hs: 0.392, ws: 0.456, wt: 0.395, rs: 0.01, rt: 0.02 }),
    sec(-0.635, { yb: 0.12, ht: 0.39, w: 0.44, hw: 0.245, hs: 0.375, ws: 0.43, wt: 0.37, rs: 0.01, rt: 0.015 }),
  ],
  cabin: [
    { x: 0.23, yb: 0.392, yt: 0.406, wb: 0.41, wt: 0.395 },
    { x: 0.11, yb: 0.398, yt: 0.55, wb: 0.41, wt: 0.335 },
    { x: -0.05, yb: 0.404, yt: 0.622, wb: 0.405, wt: 0.318 },
    { x: -0.33, yb: 0.41, yt: 0.628, wb: 0.405, wt: 0.318 },
    { x: -0.48, yb: 0.414, yt: 0.565, wb: 0.41, wt: 0.335 },
    { x: -0.565, yb: 0.414, yt: 0.43, wb: 0.414, wt: 0.405 },
  ],
  roof: [0.0, -0.46],
  palette: {
    teal: mat(0x00a3ae, 0.24, 0.32, 1),
    yellow: mat(0xe6b400, 0.24, 0.25, 1),
    black: satin(),
    gloss: gloss(0x0b0c0f),
    chrome: chrome(),
    grille: grille(),
    led: led(0xf2fbff),
    tail: led(0xff1c1c),
    caliper: mat(0xe6b400, 0.3, 0.3, 1),
  },
  paint(p, c) {
    const { x, h, z } = p;
    const T = c.teal!;
    const K = c.black!;
    // the front, head-on
    const front = (): typeof T | null => {
      if (h < 0.1) return K;
      if (h > 0.355) return null;
      // headlight bar under the hood lip: a thin LED line, angled down at its outer end
      if (h > 0.322) {
        if (z < 0.1) return K;
        const end = z > 0.39 ? (z - 0.39) * 0.9 : 0;
        if (Math.abs(h - 0.338 + end) < 0.0055 && z < 0.44) return c.led!;
        return c.gloss!;
      }
      if (h > 0.3) return T; // bumper top
      // the teal frame round the grille, vertical DRLs in its corners
      if (z > 0.37) return z > 0.392 && z < 0.404 && h > 0.15 && h < 0.26 ? c.led! : T;
      if (z > 0.352 || h < 0.125) return T;
      if (Math.abs(h - 0.268) < 0.0035 && z < 0.33) return c.led!;
      return slats(h, 0.019, c.gloss!, c.grille!, 0.3);
    };
    if (p.surf === 'front') return front() ?? T;
    if (p.surf === 'rear') {
      if (Math.abs(h - 0.335) < 0.009 && z < 0.42) return c.tail!;
      return h < 0.25 ? K : T;
    }
    if (p.surf === 'lid') return K;
    if (h < 0.108) return K;
    if (x > 0.74 && p.nx > 0.35) {
      const f = front();
      if (f) return f;
    }
    // the yellow hood panel between two black crease lines, narrowing to the nose
    if (p.ny > 0.7 && x > 0.12) {
      const edge = 0.215 - Math.max(0, x - 0.55) * 0.18;
      if (Math.abs(z - edge) < 0.004) return K;
      if (z < edge) return c.yellow!;
    }
    // black cladding round the wheels and along the sill
    if (p.nz > 0.15) {
      if (wheelDist(p, 0.53, 0.19) < 0.25 || wheelDist(p, -0.42, 0.19) < 0.254) return K;
      if (h < 0.165) return K;
      // the yellow door panel with a sharp slanted front edge, a shut line
      if (inPoly(x, h, [0.27, 0.205, 0.21, 0.335, -0.21, 0.35, -0.25, 0.205])) return c.yellow!;
      if (h > 0.17 && h < 0.39 && Math.abs(x - 0.3) < 0.0022) return K;
    }
    return T;
  },
  wheels: { r: 0.19, width: 0.14, front: 0.53, rear: -0.42, track: 0.432, style: 'multi10', rim: 0x1c1e24, lip: 0x26292f, accent: 0xf7d21a, metal: 0.7 },
  caliper: 'caliper',
  pillar: 'gloss',
  parts: (p) => {
    // angular black arch cladding
    p.flare('black', 0.53, 0.19, 0.205, 0.25, 0.05, Math.PI - 0.05, 0.44, 0.505, 6);
    p.flare('black', -0.42, 0.19, 0.207, 0.254, 0.05, Math.PI - 0.05, 0.45, 0.512, 6);
    p.plan('black', [[0.865, 0], [0.865, 0.36], [0.82, 0.45], [0.74, 0.47]], 0.06, 0.016);
    // roof rails and scoop, the rear spoiler, diffuser and exhausts
    for (const zz of [-0.27, 0.27]) {
      p.box('black', 0.34, 0.014, 0.018, -0.23, 0.652, zz);
      for (const xx of [-0.08, -0.38]) p.box('black', 0.02, 0.02, 0.016, xx, 0.64, zz);
    }
    p.plan('black', [[-0.05, 0], [-0.05, 0.07], [-0.2, 0.09], [-0.22, 0]], 0.636, 0.026);
    p.side('black', [[-0.44, 0.592], [-0.53, 0.585], [-0.535, 0.598], [-0.45, 0.606]], null, 0.66);
    p.side('black', [[-0.6, 0.42], [-0.68, 0.45], [-0.68, 0.462], [-0.61, 0.434]], null, 0.86);
    p.plan('black', [[-0.6, 0], [-0.6, 0.36], [-0.69, 0.34], [-0.69, 0]], 0.08, 0.012);
    for (const zz of [0.1, 0.22]) p.cyl('chrome', 0.024, 0.024, 0.05, -0.65, 0.15, zz, 'x', 14, true);
    p.mirror('teal', 'black', 0.18, 0.445, 0.455);
  },
  seat: { x: -0.2, h: 0.2, scale: 0.17 },
  nozzles: [[-0.65, 0.19, 0.15], [-0.65, 0.19, -0.15]],
};
