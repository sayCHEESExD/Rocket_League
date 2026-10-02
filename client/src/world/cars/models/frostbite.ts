import { mat, sec, type Mat } from '../loft.js';
import { chrome, gloss, grille, inPoly, led, line, satin, voronoi2, wheelDist, type CarModel } from '../paintkit.js';

const vor = { id: 0, edge: 0 };

/**
 * FROSTBITE - the ice muscle car (reference 2): a long hood with a big blower, twin
 * navy stripes round a white centre band over everything, ice-shard camo on cyan, navy
 * flashes down the flanks, red trim round the arches, the sills, the chin and the
 * glass, a ducktail, white snowflake rims.
 */
export const frostbite: CarModel = {
  id: 4,
  name: 'FROSTBITE',
  tagline: 'Old-school muscle with a supercharger and ice in its veins.',
  body: [
    sec(0.845, { yb: 0.12, ht: 0.255, w: 0.385, hw: 0.19, wb: 0.35, hs: 0.24, ws: 0.38, wt: 0.33, crown: 0, rw: 0.015, rs: 0.01, rt: 0.02 }),
    sec(0.77, { yb: 0.095, ht: 0.31, w: 0.45, hw: 0.2, wb: 0.42, hs: 0.292, ws: 0.446, wt: 0.385, crown: 0, rs: 0.01, rt: 0.03 }),
    sec(0.6, { yb: 0.085, ht: 0.336, w: 0.462, hw: 0.21, hs: 0.316, ws: 0.457, wt: 0.4, crown: 0.005, rs: 0.01, rt: 0.035 }),
    sec(0.42, { yb: 0.085, ht: 0.346, w: 0.463, hw: 0.21, hs: 0.323, ws: 0.457, wt: 0.4, crown: 0.008, rs: 0.01, rt: 0.035 }),
    sec(0.2, { yb: 0.085, ht: 0.35, w: 0.46, hw: 0.21, hs: 0.326, ws: 0.454, wt: 0.395, crown: 0.01, rs: 0.01, rt: 0.035 }),
    sec(-0.05, { yb: 0.085, ht: 0.356, w: 0.462, hw: 0.21, hs: 0.329, ws: 0.456, wt: 0.395, crown: 0.01, rs: 0.01, rt: 0.035 }),
    sec(-0.27, { yb: 0.085, ht: 0.362, w: 0.472, hw: 0.21, hs: 0.333, ws: 0.464, wt: 0.4, crown: 0.008, rs: 0.01, rt: 0.035 }),
    sec(-0.46, { yb: 0.09, ht: 0.362, w: 0.469, hw: 0.21, hs: 0.332, ws: 0.461, wt: 0.4, rs: 0.01, rt: 0.035 }),
    sec(-0.58, { yb: 0.11, ht: 0.35, w: 0.45, hw: 0.215, hs: 0.322, ws: 0.442, wt: 0.385, rs: 0.01, rt: 0.03 }),
    sec(-0.64, { yb: 0.13, ht: 0.336, w: 0.43, hw: 0.22, hs: 0.312, ws: 0.422, wt: 0.37, rt: 0.02, rs: 0.01 }),
  ],
  cabin: [
    { x: 0.06, yb: 0.33, yt: 0.346, wb: 0.385, wt: 0.37 },
    { x: -0.06, yb: 0.34, yt: 0.49, wb: 0.385, wt: 0.3 },
    { x: -0.22, yb: 0.345, yt: 0.53, wb: 0.38, wt: 0.285 },
    { x: -0.37, yb: 0.35, yt: 0.49, wb: 0.385, wt: 0.3 },
    { x: -0.5, yb: 0.35, yt: 0.38, wb: 0.39, wt: 0.36 },
    { x: -0.565, yb: 0.345, yt: 0.356, wb: 0.39, wt: 0.375 },
  ],
  roof: [-0.08, -0.36],
  palette: {
    cyan: mat(0x2fc0e4, 0.27, 0.25, 1),
    ice: mat(0x7fd2ec, 0.27, 0.2, 1),
    snow: mat(0xf6fcff, 0.27, 0.12, 1),
    deep: mat(0x2a8fd0, 0.27, 0.28, 1),
    navy: mat(0x13306b, 0.27, 0.3, 1),
    white: mat(0xf7f9fb, 0.27, 0.1, 1),
    red: mat(0xe0263a, 0.27, 0.3, 1),
    black: satin(),
    gloss: gloss(0x0b0c0f),
    chrome: chrome(),
    grille: grille(),
    led: led(0xfff2d6),
    tail: led(0xff1c1c),
  },
  paint(p, c) {
    const { x, h, z } = p;
    // a wide white centre band between two navy stripes, a white pinstripe outside each
    const stripes = (zz: number): Mat | null => {
      if (zz < 0.058) return c.white!;
      if (zz < 0.128) return c.navy!;
      if (zz > 0.136 && zz < 0.146) return c.white!;
      return null;
    };
    if (p.surf === 'front') {
      if (h < 0.135) return h > 0.122 ? c.red! : c.black!;
      // two small square lamps a side, a black egg-crate grille with a chrome surround
      if (h > 0.198 && h < 0.224 && ((z > 0.26 && z < 0.29) || (z > 0.31 && z < 0.34))) return c.led!;
      if (z < 0.235 && h > 0.155 && h < 0.232) return z % 0.024 < 0.004 || h % 0.024 < 0.004 ? c.black! : c.grille!;
      if ((z < 0.245 && h > 0.148 && h < 0.24) || Math.abs(h - 0.143) < 0.004) return c.chrome!;
      return c.black!;
    }
    if (p.surf === 'rear') {
      if (h > 0.27 && h < 0.3 && z > 0.12 && z < 0.4) return z % 0.07 < 0.006 ? c.black! : c.tail!;
      if (h < 0.2) return c.black!;
      return stripes(z) ?? c.cyan!;
    }
    if (p.surf !== 'lid' && h < 0.106) return c.black!;
    // red frame round the base of the glass
    if (Math.abs(p.cab) < 0.012) return c.red!;
    if (p.surf !== 'lid' && h < 0.122 && p.ny < 0.3) return c.red!;
    if (p.ny > 0.55) {
      const st = stripes(z);
      if (st) return st;
    }
    if (p.nz > 0.3) {
      const d0 = wheelDist(p, 0.53, 0.178);
      const d1 = wheelDist(p, -0.4, 0.178);
      if ((d0 > 0.205 && d0 < 0.224) || (d1 > 0.208 && d1 < 0.227)) return c.red!;
      // angular navy flashes down the flank, edged in white
      const flash = [0.33, 0.2, 0.0, 0.205, -0.26, 0.245, -0.44, 0.305, -0.36, 0.25, -0.2, 0.15, 0.3, 0.14];
      if (inPoly(x, h, flash)) return c.navy!;
      if (line(x, h, [...flash, flash[0]!, flash[1]!]) < 0.008) return c.white!;
    }
    if (x > 0.78 && p.nx > 0.4 && h < 0.24) return c.black!;
    // ice: fine crackle over cyan - mostly paint, some frosted shards, a few bright flakes
    if (p.ny > 0.5) voronoi2(x * 17 + 40, z * 17, vor);
    else voronoi2(x * 17, h * 17 + Math.abs(p.nx) * 3, vor);
    if (vor.edge < 0.035) return c.deep!;
    return vor.id < 0.7 ? c.cyan! : vor.id < 0.93 ? c.ice! : c.snow!;
  },
  wheels: { r: 0.178, width: 0.135, front: 0.53, rear: -0.4, track: 0.42, style: 'snow', rim: 0xf2f7ff, lip: 0xf2f7ff, accent: 0x8fd4ff, metal: 0.25 },
  caliper: 'red',
  pillar: 'red',
  parts: (p) => {
    p.box('black', 0.26, 0.04, 0.2, 0.36, 0.36, 0);
    p.cyl('chrome', 0.055, 0.055, 0.22, 0.36, 0.405, 0, 'x', 18);
    p.box('chrome', 0.2, 0.05, 0.13, 0.36, 0.41, 0);
    p.cyl('black', 0.035, 0.035, 0.02, 0.48, 0.405, 0, 'x', 14);
    p.box('black', 0.13, 0.075, 0.16, 0.4, 0.47, 0);
    p.box('chrome', 0.012, 0.06, 0.14, 0.468, 0.47, 0);
    p.box('grille', 0.004, 0.05, 0.12, 0.476, 0.47, 0);
    p.box('chrome', 0.03, 0.022, 0.76, 0.85, 0.14, 0);
    p.plan('red', [[0.86, 0], [0.86, 0.34], [0.8, 0.42], [0.74, 0.44]], 0.082, 0.012);
    p.side('cyan', [[-0.55, 0.348], [-0.66, 0.37], [-0.66, 0.382], [-0.56, 0.362]], null, 0.82);
    for (const zz of [0.16, 0.26]) p.cyl('chrome', 0.022, 0.022, 0.05, -0.65, 0.12, zz, 'x', 14, true);
    p.mirror('cyan', 'black', 0.02, 0.39, 0.445);
  },
  seat: { x: -0.25, h: 0.175, scale: 0.17 },
  nozzles: [[-0.65, 0.17, 0.14], [-0.65, 0.17, -0.14]],
};
