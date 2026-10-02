import { mat, sec } from '../loft.js';
import { chrome, gloss, grille, led, satin, slats, wheelDist, type CarModel } from '../paintkit.js';

/**
 * BREAKER - the orange gridded all-rounder (reference 5, Octane-like): a short nose
 * between big rounded fenders, a tall cabin, a glowing orange grid over red-orange paint,
 * white piping on the arch lips, the shoulders and round the glass, a black lower body
 * and bumper, round blue lamps on the fender fronts, a high gridded wing on black struts
 * with blue tip lights, big silver six-spoke wheels.
 */
export const breaker: CarModel = {
  id: 1,
  name: 'BREAKER',
  tagline: 'The all-rounder. Tall, tough, and big on wheels.',
  body: [
    sec(0.785, { yb: 0.15, ht: 0.27, w: 0.31, hw: 0.21, wb: 0.28, hs: 0.258, ws: 0.305, wt: 0.25, crown: 0.0, rw: 0.04, rs: 0.025, rt: 0.04 }),
    sec(0.73, { yb: 0.13, ht: 0.33, w: 0.42, hw: 0.23, wb: 0.38, hs: 0.31, ws: 0.41, wt: 0.33, crown: -0.035, rw: 0.06, rs: 0.03, rt: 0.06 }),
    sec(0.63, { yb: 0.12, ht: 0.41, w: 0.505, hw: 0.26, hs: 0.38, ws: 0.49, wt: 0.4, crown: -0.08, rw: 0.08, rs: 0.035, rt: 0.08 }),
    sec(0.5, { yb: 0.12, ht: 0.43, w: 0.522, hw: 0.27, hs: 0.4, ws: 0.505, wt: 0.41, crown: -0.088, rw: 0.08, rs: 0.035, rt: 0.08 }),
    sec(0.37, { yb: 0.12, ht: 0.415, w: 0.5, hw: 0.265, hs: 0.39, ws: 0.486, wt: 0.4, crown: -0.06, rw: 0.08, rs: 0.035, rt: 0.08 }),
    sec(0.25, { yb: 0.12, ht: 0.395, w: 0.432, hw: 0.25, hs: 0.375, ws: 0.424, wt: 0.37, crown: -0.022, rw: 0.06, rs: 0.03, rt: 0.06 }),
    sec(0.08, { yb: 0.12, ht: 0.392, w: 0.412, hw: 0.245, hs: 0.372, ws: 0.405, wt: 0.355, crown: 0, rw: 0.06, rs: 0.03, rt: 0.06 }),
    sec(-0.1, { yb: 0.125, ht: 0.398, w: 0.414, hw: 0.25, hs: 0.378, ws: 0.407, wt: 0.356, crown: 0, rw: 0.06, rs: 0.03, rt: 0.06 }),
    sec(-0.25, { yb: 0.13, ht: 0.415, w: 0.47, hw: 0.26, hs: 0.39, ws: 0.458, wt: 0.385, crown: -0.03, rw: 0.08, rs: 0.035, rt: 0.08 }),
    sec(-0.4, { yb: 0.14, ht: 0.432, w: 0.522, hw: 0.27, hs: 0.402, ws: 0.505, wt: 0.41, crown: -0.07, rw: 0.08, rs: 0.035, rt: 0.08 }),
    sec(-0.52, { yb: 0.15, ht: 0.415, w: 0.495, hw: 0.27, hs: 0.39, ws: 0.48, wt: 0.395, crown: -0.05, rw: 0.08, rs: 0.035, rt: 0.08 }),
    sec(-0.6, { yb: 0.17, ht: 0.385, w: 0.43, hw: 0.27, hs: 0.365, ws: 0.42, wt: 0.35, crown: -0.02, rw: 0.05, rs: 0.03, rt: 0.05 }),
  ],
  cabin: [
    { x: 0.24, yb: 0.36, yt: 0.375, wb: 0.36, wt: 0.348 },
    { x: 0.12, yb: 0.365, yt: 0.565, wb: 0.355, wt: 0.272 },
    { x: -0.1, yb: 0.375, yt: 0.625, wb: 0.348, wt: 0.27, crown: 0.016 },
    { x: -0.33, yb: 0.385, yt: 0.605, wb: 0.348, wt: 0.27 },
    { x: -0.46, yb: 0.392, yt: 0.43, wb: 0.355, wt: 0.33 },
  ],
  roof: [0.04, -0.37],
  palette: {
    orange: mat(0xe9380e, 0.3, 0.3, 1),
    grid: mat(0xffa22a, 0.3, 0.05, 0.7, 0.5),
    white: mat(0xf4f5f7, 0.3, 0.1, 1),
    black: satin(),
    gloss: gloss(0x0c0d10),
    chrome: chrome(),
    grille: grille(),
    blue: mat(0x3fb4ff, 0.2, 0, 0, 0.45),
    tail: led(0xff2a1a),
    caliper: mat(0x2a2d33, 0.4, 0.6, 0.6),
  },
  paint(p, c) {
    const { x, h, z } = p;
    const O = c.orange!;
    const K = c.black!;
    const W = c.white!;
    // the glowing grid: square cells, lines on the two axes that run across this surface
    const grid = (): typeof O => {
      const g = 0.085;
      const w = 0.0042;
      const on = (v: number): boolean => Math.abs(((((v / g) % 1) + 1) % 1) - 0.5) > 0.5 - w / g;
      const u = x + h * 0.15;
      return (Math.abs(p.ny) > 0.65 ? on(u) || on(z) : Math.abs(p.nx) > 0.65 ? on(z) || on(h) : on(u) || on(h)) ? c.grid! : O;
    };
    if (p.surf === 'front') {
      if (h < 0.2) return slats(h, 0.016, K, c.grille!);
      if (Math.abs(h - 0.235) < 0.004 && z < 0.2) return c.blue!;
      return K;
    }
    if (p.surf === 'rear') {
      if (Math.abs(h - 0.32) < 0.012 && z > 0.2 && z < 0.34) return c.tail!;
      return h < 0.27 ? K : grid();
    }
    if (p.surf === 'lid') return z > 0.25 && p.ny < 0.6 ? W : grid();
    if (h < 0.172) return K;
    // white piping: arch lips, the shoulder line over the fenders, round the base of the glass
    if (p.nz > 0.2) {
      const d0 = wheelDist(p, 0.5, 0.195);
      const d1 = wheelDist(p, -0.4, 0.195);
      if ((d0 > 0.222 && d0 < 0.236) || (d1 > 0.222 && d1 < 0.236)) return W;
      if (d0 < 0.222 || d1 < 0.222) return K;
    }
    if (Math.abs(p.cab) < 0.009) return W;
    if (p.ny > 0.5 && p.ny < 0.66 && p.nz > 0.35) return W;
    // the front: black bumper, round blue lamps on the fender fronts
    if (x > 0.6 && p.nx > 0.3) {
      for (const lz of [0.36, 0.445]) {
        const d = Math.hypot(z - lz, h - 0.33);
        if (d < 0.034) return d < 0.024 ? c.blue! : d < 0.028 ? c.chrome! : c.gloss!;
      }
      if (h < 0.235) return K;
    }
    return grid();
  },
  wheels: { r: 0.195, width: 0.15, front: 0.5, rear: -0.4, track: 0.455, style: 'six', rim: 0xc9ced7, lip: 0xdde1e8, accent: 0x9aa0aa, metal: 0.85 },
  caliper: 'caliper',
  pillar: 'gloss',
  parts: (p) => {
    // black bumper and grille block, side skirts
    p.plan('black', [[0.81, 0], [0.81, 0.3], [0.77, 0.38], [0.7, 0.4]], 0.12, 0.09);
    p.box('black', 0.5, 0.05, 0.03, 0.05, 0.16, 0.405, undefined, true);
    // the wing on two short struts (low, so the driver shows over it), blue LEDs at its tips
    for (const zz of [-0.17, 0.17]) p.beam('black', [-0.5, 0.39, zz], [-0.54, 0.48, zz], 0.035, 0.022, false);
    p.wing('orange', -0.47, 0.49, 0.18, 0.036, 0.84, 0.08);
    p.box('white', 0.012, 0.012, 0.84, -0.652, 0.47, 0);
    p.side('black', [[-0.46, 0.42], [-0.67, 0.43], [-0.67, 0.53], [-0.48, 0.52]], 0.42, 0.432);
    p.box('blue', 0.03, 0.014, 0.014, -0.49, 0.525, 0.426, undefined, true);
    p.plan('black', [[-0.58, 0], [-0.58, 0.3], [-0.64, 0.28], [-0.64, 0]], 0.17, 0.06);
    // mirrors
    p.mirror('orange', 'black', 0.16, 0.43, 0.39);
  },
  seat: { x: -0.17, h: 0.208, scale: 0.17 },
  nozzles: [[-0.62, 0.22, 0.13], [-0.62, 0.22, -0.13]],
};
