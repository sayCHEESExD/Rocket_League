import { ARENA, TEAMS } from '@rlb/shared';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { barrierMaterial } from './Barrier.js';
import { BoostPads } from './BoostPads.js';
import { City } from './City.js';
import { adBoardTexture, balloonGeometry, balloonMaterial, Stadium } from './Stadium.js';
import type { ArenaTheme } from './Themes.js';
import { S } from './units.js';

const R = ARENA.round;
const HX = ARENA.halfX;
const HY = ARENA.halfY;
const H = ARENA.height;
const X0 = HX - R;
const Y0 = HY - R;
const C0 = ARENA.corner - R * Math.SQRT2;
const X1 = C0 - Y0;
const Y1 = C0 - X0;
const GW = ARENA.goal.halfWidth;
const GH = ARENA.goal.height;
const GD = ARENA.goal.depth;
/** Walls are opaque padding up to here, glass above. */
const SOLID_TOP = 560;

const BLUE = new Color(TEAMS[0].color);
const ORANGE = new Color(TEAMS[1].color);

/** Inset octagon, CCW from above, with outward edge normals. */
const OCT: [number, number][] = [
  [X0, -Y1],
  [X0, Y1],
  [X1, Y0],
  [-X1, Y0],
  [-X0, Y1],
  [-X0, -Y1],
  [-X1, -Y0],
  [X1, -Y0],
];
const S2 = Math.SQRT1_2;
const NRM: [number, number][] = [
  [1, 0],
  [S2, S2],
  [0, 1],
  [-S2, S2],
  [-1, 0],
  [-S2, -S2],
  [0, -1],
  [S2, -S2],
];

/** One ring of the arena shell: the octagon offset by d, as (x, y) points; same count for every d. */
const ring = (d: number): [number, number][] => {
  const pts: [number, number][] = [];
  const ARC = 6;
  for (let i = 0; i < 8; i += 1) {
    const v = OCT[i]!;
    const nPrev = NRM[(i + 7) % 8]!;
    const nCur = NRM[i]!;
    const a0 = Math.atan2(nPrev[1], nPrev[0]);
    let a1 = Math.atan2(nCur[1], nCur[0]);
    if (a1 < a0) a1 += Math.PI * 2;
    for (let k = 0; k <= ARC; k += 1) {
      const a = a0 + ((a1 - a0) * k) / ARC;
      pts.push([v[0] + Math.cos(a) * d, v[1] + Math.sin(a) * d]);
    }
    // extra points along edge i (from v to next vertex), offset by d
    const next = OCT[(i + 1) % 8]!;
    const n = NRM[i]!;
    const along: number[] = [];
    if (i === 0 || i === 4) for (let s = 1; s < 8; s += 1) along.push(s / 8);
    if (i === 2 || i === 6) {
      // back walls: vertices exactly at the goal posts
      const xs = i === 2 ? [GW, -GW] : [-GW, GW];
      for (const x of xs) along.push((x - v[0]) / (next[0] - v[0]));
    }
    for (const t of along) pts.push([v[0] + (next[0] - v[0]) * t + n[0] * d, v[1] + (next[1] - v[1]) * t + n[1] * d]);
  }
  return pts;
};

/** The shell's cross-section, floor to ceiling: [d, z]. */
const PROFILE: [number, number][] = (() => {
  const p: [number, number][] = [];
  const N = 10;
  for (let k = 0; k <= N; k += 1) {
    const a = (k / N) * (Math.PI / 2);
    p.push([R * Math.sin(a), R - R * Math.cos(a)]);
  }
  for (const z of [GH, SOLID_TOP, 900, 1300, H - R]) if (z > R && z < H - R + 1) p.push([R, z]);
  p.sort((a, b) => a[1] - b[1]);
  for (let k = 1; k <= N; k += 1) {
    const a = Math.PI / 2 + (k / N) * (Math.PI / 2);
    p.push([R * Math.sin(a), H - R - R * Math.cos(a)]);
  }
  return p;
})();

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Team tint by length, with a white middle, for the opaque padding. */
const panelColor = (out: Color, x: number, y: number, z: number): Color => {
  const t = y / HY;
  // linear values: a deep blue-grey padding (the old values rendered pale grey)
  const base = z < R ? 0.075 : 0.045;
  out.setRGB(base * 0.8, base * 0.88, base * 1.1);
  const team = t < 0 ? BLUE : ORANGE;
  const k = smooth(0.3, 0.95, Math.abs(t)) * 0.22;
  out.lerp(team, k);
  // the ramp itself a touch lighter, and a dark kick band where it meets the wall
  if (z < R) out.multiplyScalar(1.18);
  if (z > R + 10 && z < R + 70) out.multiplyScalar(0.55);
  void x;
  return out;
};

/** Shell mesh between profile rows [from, to); quads in a goal mouth are left out. */
type Paint = (out: Color, x: number, y: number, z: number) => Color;

/** Grand Prix Park's walls: light concrete, the ramp paler, a soft team tint towards each end. */
const dayPanelColor: Paint = (out, _x, y, z) => {
  const t = y / HY;
  if (z < R) out.setRGB(0.6, 0.62, 0.66);
  else out.setRGB(0.4, 0.43, 0.5);
  out.lerp(t < 0 ? BLUE : ORANGE, smooth(0.3, 0.95, Math.abs(t)) * 0.35);
  return out;
};

const shell = (rows: [number, number][], paint: Paint | null): BufferGeometry => {
  const rings = rows.map(([d, z]) => ring(d).map(([x, y]) => [x, y, z] as const));
  // arc length around the wall line and up the profile, in metres (barrier UVs)
  const wallRing = ring(R);
  const arc: number[] = [0];
  for (let i = 1; i <= wallRing.length; i += 1) {
    const a = wallRing[i - 1]!;
    const b = wallRing[i % wallRing.length]!;
    arc.push(arc[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]) * S);
  }
  const prof: number[] = [0];
  for (let r = 1; r < rows.length; r += 1) prof.push(prof[r - 1]! + Math.hypot(rows[r]![0] - rows[r - 1]![0], rows[r]![1] - rows[r - 1]![1]) * S);
  const bar: number[] = [];
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const c = new Color();
  const n = rings[0]!.length;
  const push = (p: readonly [number, number, number]): void => {
    pos.push(p[0] * S, p[2] * S, -p[1] * S);
    if (paint) {
      paint(c, p[0], p[1], p[2]);
      col.push(c.r, c.g, c.b);
      // panels run along the wall; the curve's height maps up the texture
      uv.push((Math.abs(p[0]) > HX - R - 1 ? p[1] : p[0] + p[1] * 0.0001) / 384, p[2] / 192);
    }
  };
  for (let r = 0; r + 1 < rings.length; r += 1) {
    const A = rings[r]!;
    const B = rings[r + 1]!;
    for (let i = 0; i < n; i += 1) {
      const a0 = A[i]!;
      const a1 = A[(i + 1) % n]!;
      const b0 = B[i]!;
      const b1 = B[(i + 1) % n]!;
      const cx = (a0[0] + a1[0] + b0[0] + b1[0]) / 4;
      const cy = (a0[1] + a1[1] + b0[1] + b1[1]) / 4;
      const cz = (a0[2] + a1[2] + b0[2] + b1[2]) / 4;
      if (Math.abs(cx) < GW && cz < GH && Math.abs(cy) > HY - R - 5) continue;
      push(a0);
      push(b0);
      push(a1);
      push(a1);
      push(b0);
      push(b1);
      if (!paint) {
        const u0 = arc[i]!;
        const u1 = arc[i + 1]!;
        const v0 = prof[r]!;
        const v1 = prof[r + 1]!;
        bar.push(u0, v0, u0, v1, u1, v0, u1, v0, u0, v1, u1, v1);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  if (paint) {
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  } else g.setAttribute('uv', new Float32BufferAttribute(bar, 2));
  g.computeVertexNormals();
  return g;
};

/** A thin glowing ribbon around the shell at height z (on the wall plane). */
const ribbon = (z: number, height: number, inset: number): BufferGeometry => {
  const pts = ring(R - inset);
  const pos: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    if (z < GH && Math.abs(cx) < GW && Math.abs(cy) > HY - R - 5) continue;
    const q = [
      [a[0], a[1], z],
      [a[0], a[1], z + height],
      [b[0], b[1], z],
      [b[0], b[1], z],
      [a[0], a[1], z + height],
      [b[0], b[1], z + height],
    ];
    for (const p of q) pos.push(p[0]! * S, p[2]! * S, -p[1]! * S);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
};
// ------------------------------------------------------------------ textures

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};

let seed = 777;
const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/**
 * The pitch as a wet city street: dark asphalt with grain, cracks and puddles,
 * and worn road paint - an orange centre ring, dashed bands, zebra crossings,
 * lane lines and team-coloured ends. Returns the colour map and a roughness
 * map in which the puddles are near-mirrors.
 */
const asphalt = (): { map: CanvasTexture; rough: CanvasTexture } => {
  seed = 777;
  const W = 1024;
  const Hh = 1536;
  const LY = HY + GD;
  const px = (x: number): number => ((x + HX) / (2 * HX)) * W;
  const py = (y: number): number => ((LY - y) / (2 * LY)) * Hh;
  const sc = W / (2 * HX);
  const [cv, g] = canvas(W, Hh);
  const [rc, r] = canvas(W, Hh);
  g.fillStyle = '#3a4252';
  g.fillRect(0, 0, W, Hh);
  r.fillStyle = 'rgb(190,190,190)';
  r.fillRect(0, 0, W, Hh);
  // tonal patches
  for (let i = 0; i < 70; i += 1) {
    const x = rnd() * W;
    const y = rnd() * Hh;
    const rad = 40 + rnd() * 160;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const light = rnd() < 0.5;
    grad.addColorStop(0, light ? 'rgba(70,80,100,0.22)' : 'rgba(8,10,16,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // paint, on its own layer so it can be worn away
  const [pc, p] = canvas(W, Hh);
  const orange = '#f0782a';
  p.lineCap = 'butt';
  p.strokeStyle = orange;
  p.lineWidth = 70 * sc;
  p.beginPath();
  p.arc(px(0), py(0), 1000 * sc, 0, Math.PI * 2);
  p.stroke();
  p.lineWidth = 34 * sc;
  p.beginPath();
  p.arc(px(0), py(0), 170 * sc, 0, Math.PI * 2);
  p.stroke();
  // halfway: a dashed orange band
  p.fillStyle = orange;
  for (let x = -X0; x < X0; x += 520) p.fillRect(px(x), py(45), 340 * sc, 90 * sc);
  // big angular road-paint bands either side of the centre
  for (const sx of [-1, 1]) {
    p.beginPath();
    p.moveTo(px(sx * 1500), py(-1500));
    p.lineTo(px(sx * 1700), py(-1500));
    p.lineTo(px(sx * 1700), py(1100));
    p.lineTo(px(sx * 2600), py(1100));
    p.lineTo(px(sx * 2600), py(1300));
    p.lineTo(px(sx * 1500), py(1300));
    p.closePath();
    p.fill();
  }
  // zebra crossings at the side walls
  p.fillStyle = '#e8ecf4';
  for (const sx of [-1, 1]) for (let y = -700; y < 700; y += 170) p.fillRect(px(sx > 0 ? 3200 : -3750), py(y + 80), 550 * sc, 80 * sc);
  // dashed lane lines down the length
  for (const x of [-2300, 2300]) for (let y = -3800; y < 3800; y += 460) p.fillRect(px(x) - 15 * sc, py(y + 260), 30 * sc, 260 * sc);
  // the ends: team-coloured hatching, goal boxes, goal lines
  for (const [team, sign] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const col = TEAMS[team].color;
    p.save();
    p.beginPath();
    p.rect(0, Math.min(py(sign * 3300), py(sign * LY)), W, Math.abs(py(sign * LY) - py(sign * 3300)));
    p.clip();
    p.strokeStyle = col;
    p.globalAlpha = 0.55;
    p.lineWidth = 46 * sc;
    for (let k = -30; k < 30; k += 1) {
      p.beginPath();
      p.moveTo(px(k * 400), py(sign * 3300));
      p.lineTo(px(k * 400 + 1800), py(sign * LY));
      p.stroke();
    }
    p.restore();
    p.globalAlpha = 1;
    p.strokeStyle = col;
    p.lineWidth = 40 * sc;
    const yl = sign * Y0;
    p.strokeRect(px(-GW - 200), Math.min(py(yl), py(sign * (Y0 - 700))), px(GW + 200) - px(-GW - 200), Math.abs(py(sign * (Y0 - 700)) - py(yl)));
    p.strokeStyle = '#e8ecf4';
    p.lineWidth = 60 * sc;
    p.beginPath();
    p.moveTo(px(-GW), py(sign * HY));
    p.lineTo(px(GW), py(sign * HY));
    p.stroke();
  }
  // wear the paint away in flecks and scuffs
  p.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i += 1) {
    p.globalAlpha = 0.2 + rnd() * 0.6;
    p.beginPath();
    p.ellipse(rnd() * W, rnd() * Hh, 1 + rnd() * 6, 1 + rnd() * 3, rnd() * Math.PI, 0, Math.PI * 2);
    p.fill();
  }
  p.globalAlpha = 1;
  p.globalCompositeOperation = 'source-over';
  g.globalAlpha = 0.86;
  g.drawImage(pc, 0, 0);
  g.globalAlpha = 1;
  r.globalAlpha = 0.6;
  r.filter = 'brightness(0.8)';
  r.drawImage(pc, 0, 0);
  r.filter = 'none';
  r.globalAlpha = 1;
  // cracks
  g.strokeStyle = 'rgba(8,10,14,0.85)';
  for (let i = 0; i < 150; i += 1) {
    let x = rnd() * W;
    let y = rnd() * Hh;
    g.lineWidth = 0.6 + rnd() * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    const n = 4 + Math.floor(rnd() * 8);
    for (let k = 0; k < n; k += 1) {
      x += (rnd() - 0.5) * 30;
      y += (rnd() - 0.5) * 30;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // puddles: darker, bluer, and glassy in the roughness map
  for (let i = 0; i < 46; i += 1) {
    const x = rnd() * W;
    const y = rnd() * Hh;
    const rx = 12 + rnd() * 60;
    const ry = 8 + rnd() * 40;
    const a = rnd() * Math.PI;
    for (const [ctx, fill] of [
      [g, 'rgba(14,18,30,0.35)'],
      [r, 'rgb(80,80,80)'],
    ] as const) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let k = 0; k < 9; k += 1) {
        const t = (k / 9) * Math.PI * 2;
        const w = 0.7 + rnd() * 0.5;
        const ex = Math.cos(t) * rx * w;
        const ey = Math.sin(t) * ry * w;
        const qx = x + ex * Math.cos(a) - ey * Math.sin(a);
        const qy = y + ex * Math.sin(a) + ey * Math.cos(a);
        if (k === 0) ctx.moveTo(qx, qy);
        else ctx.lineTo(qx, qy);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  // fine grain over everything
  const img = g.getImageData(0, 0, W, Hh);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
  }
  g.putImageData(img, 0, 0);
  const map = new CanvasTexture(cv);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  map.minFilter = LinearMipmapLinearFilter;
  const rough = new CanvasTexture(rc);
  rough.anisotropy = 8;
  return { map, rough };
};

/**
 * Grand Prix Park's pitch, after RL's sunny race-day fields: a mown turf
 * field ringed by red-and-white kerbs inside a dark asphalt track with white
 * boundary lines and lane dashes, yellow road-paint chevrons on the turf, and
 * zebra-striped, team-tinted goal boxes on the asphalt at each end.
 */
const dayPitch = (): { map: CanvasTexture; rough: CanvasTexture } => {
  seed = 99;
  const W = 1024;
  const Hh = 1536;
  const LY = HY + GD;
  const px = (x: number): number => ((x + HX) / (2 * HX)) * W;
  const py = (y: number): number => ((LY - y) / (2 * LY)) * Hh;
  const sc = W / (2 * HX);
  const [cv, g] = canvas(W, Hh);
  const [rc, r] = canvas(W, Hh);
  g.fillStyle = '#1d2026';
  g.fillRect(0, 0, W, Hh);
  r.fillStyle = 'rgb(205,205,205)';
  r.fillRect(0, 0, W, Hh);
  for (let i = 0; i < 60; i += 1) {
    const x = rnd() * W;
    const y = rnd() * Hh;
    const rad = 40 + rnd() * 140;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, rnd() < 0.5 ? 'rgba(110,115,125,0.18)' : 'rgba(20,22,28,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  /** A rounded rectangle path in uu (x0..x1, y0..y1). */
  const rr = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, rad: number): void => {
    ctx.beginPath();
    ctx.roundRect(px(x0), py(y1), px(x1) - px(x0), py(y0) - py(y1), rad * sc);
  };
  const TX = 2900;
  const TY = 3500;
  const TR = 700;
  // kerbs: white band, red dashes on it
  rr(g, -TX - 120, -TY - 120, TX + 120, TY + 120, TR + 120);
  g.fillStyle = '#f2f2f2';
  g.fill();
  rr(g, -TX - 60, -TY - 60, TX + 60, TY + 60, TR + 60);
  g.strokeStyle = '#d42a2a';
  g.lineWidth = 120 * sc;
  g.setLineDash([230 * sc, 230 * sc]);
  g.stroke();
  g.setLineDash([]);
  // turf with mowing stripes
  g.save();
  rr(g, -TX, -TY, TX, TY, TR);
  g.clip();
  for (let k = -12; k < 12; k += 1) {
    g.fillStyle = k % 2 ? '#2a7a2a' : '#369133';
    g.fillRect(0, py((k + 1) * 420), W, py(k * 420) - py((k + 1) * 420) + 1);
  }
  for (let i = 0; i < 9000; i += 1) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(20,60,20,0.25)' : 'rgba(150,210,120,0.18)';
    g.fillRect(rnd() * W, rnd() * Hh, 1.5, 1.5);
  }
  g.fillStyle = '#f2c22e';
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      g.beginPath();
      g.moveTo(px(sx * 2600), py(sy * 1250));
      g.lineTo(px(sx * 2600), py(sy * 1480));
      g.lineTo(px(sx * 980), py(sy * 2620));
      g.lineTo(px(sx * 980), py(sy * 3300));
      g.lineTo(px(sx * 780), py(sy * 3300));
      g.lineTo(px(sx * 780), py(sy * 2500));
      g.closePath();
      g.fill();
    }
  g.strokeStyle = '#f4f6f8';
  g.lineWidth = 45 * sc;
  g.beginPath();
  g.moveTo(px(-TX), py(0));
  g.lineTo(px(TX), py(0));
  g.stroke();
  g.beginPath();
  g.arc(px(0), py(0), 900 * sc, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  r.save();
  rr(r, -TX, -TY, TX, TY, TR);
  r.fillStyle = 'rgb(240,240,240)';
  r.fill();
  r.restore();
  // asphalt paint: the boundary line, lane dashes, goal boxes
  g.strokeStyle = '#eef0f2';
  g.lineWidth = 50 * sc;
  rr(g, -3680, -4720, 3680, 4720, 1150);
  g.stroke();
  g.fillStyle = '#eef0f2';
  for (const x of [-3330, 3330]) for (let y = -4100; y < 4100; y += 700) g.fillRect(px(x) - 35 * sc, py(y + 380), 70 * sc, 380 * sc);
  for (const [team, sy] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const col = TEAMS[team].color;
    const y0 = sy * 3950;
    const y1 = sy * Y0;
    const top = Math.min(py(y0), py(y1));
    const h = Math.abs(py(y1) - py(y0));
    g.globalAlpha = 0.1;
    g.fillStyle = col;
    g.fillRect(px(-1500), top, px(1500) - px(-1500), h);
    g.globalAlpha = 1;
    g.fillStyle = '#eef0f2';
    for (let x = -1400; x < 1400; x += 280) g.fillRect(px(x), Math.min(py(y0), py(sy * 4250)), 140 * sc, 300 * sc);
    g.strokeStyle = '#eef0f2';
    g.lineWidth = 50 * sc;
    g.beginPath();
    g.moveTo(px(-1500), py(y1));
    g.lineTo(px(-1500), py(y0));
    g.lineTo(px(1500), py(y0));
    g.lineTo(px(1500), py(y1));
    g.stroke();
    // inside the goal: team colour, white goal line
    g.globalAlpha = 0.3;
    g.fillStyle = col;
    g.fillRect(px(-GW), Math.min(py(sy * HY), py(sy * LY)), px(GW) - px(-GW), Math.abs(py(sy * LY) - py(sy * HY)));
    g.globalAlpha = 1;
    g.lineWidth = 60 * sc;
    g.beginPath();
    g.moveTo(px(-GW), py(sy * HY));
    g.lineTo(px(GW), py(sy * HY));
    g.stroke();
  }
  // grain
  const img = g.getImageData(0, 0, W, Hh);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
  }
  g.putImageData(img, 0, 0);
  const map = new CanvasTexture(cv);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  map.minFilter = LinearMipmapLinearFilter;
  const rough = new CanvasTexture(rc);
  rough.anisotropy = 8;
  return { map, rough };
};

/** Riveted metal plates (light; the vertex colours make them gunmetal). */
const metalPanels = (): CanvasTexture => {
  const [cv, g] = canvas(256, 256);
  g.fillStyle = '#d8dce4';
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 2; row += 1) {
    const off = row % 2 ? 64 : 0;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, row * 128 + 2);
    g.lineTo(256, row * 128 + 2);
    for (let x = off; x <= 256; x += 128) {
      g.moveTo(x, row * 128);
      g.lineTo(x, row * 128 + 128);
    }
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(0, row * 128 + 6, 256, 2);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let x = off + 10; x < 256 + off; x += 128) {
      for (const dx of [0, 108]) {
        g.beginPath();
        g.arc((x + dx) % 256, row * 128 + 16, 3, 0, Math.PI * 2);
        g.arc((x + dx) % 256, row * 128 + 112, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
};

/** One LED dot per texel cell (repeats along a strip). */
const dotTexture = (): CanvasTexture => {
  const [cv, g] = canvas(32, 32);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 32, 32);
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 12);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new CanvasTexture(cv);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
};

/** A 5x7 LED font: just what the goal screens say. */
const FONT: Record<string, string> = {
  S: '01111100001000001110000010000111110',
  C: '01110100011000010000100001000101110',
  O: '01110100011000110001100011000101110',
  R: '11110100011000111110101001001010001',
  E: '11111100001000011110100001000011111',
  '0': '01110100011000110001100011000101110',
  '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111',
  '3': '11111000100010000010000011000101110',
  '4': '00010001100101010010111110001000010',
  '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110',
  '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110',
  '9': '01110100011000101111000010001001100',
};

/** Text as dot-matrix LEDs centred on (cx, cy), every dot drawn (unlit ones faint). */
const ledText = (g: CanvasRenderingContext2D, text: string, cx: number, cy: number, cell: number, color: string): void => {
  const cols = text.length * 6 - 1;
  const x0 = cx - (cols * cell) / 2;
  const y0 = cy - (7 * cell) / 2;
  g.shadowColor = color;
  g.shadowBlur = cell * 1.2;
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const glyph = FONT[text[Math.floor(x / 6)]!];
      const on = x % 6 < 5 && glyph?.[y * 5 + (x % 6)] === '1';
      g.fillStyle = on ? color : 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.arc(x0 + x * cell + cell / 2, y0 + y * cell + cell / 2, cell * 0.38, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.shadowBlur = 0;
};

/** A strip of LED dots round the shell at height z, coloured by team half (vertex colours). */
const ledRibbon = (z: number, height: number, inset: number, dotsPerMetre: number, mid?: Color): BufferGeometry => {
  const pts = ring(R - inset);
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const n = pts.length;
  let arc = 0;
  const c = new Color();
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * S;
    const u0 = arc * dotsPerMetre;
    arc += len;
    const u1 = arc * dotsPerMetre;
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    if (z < GH + 60 && Math.abs(cx) < GW + 80 && Math.abs(cy) > HY - R - 5) continue;
    const v1 = Math.max(1, Math.round(height * S * dotsPerMetre));
    const quad: [number, number, number, number, number][] = [
      [a[0], a[1], z, u0, 0],
      [a[0], a[1], z + height, u0, v1],
      [b[0], b[1], z, u1, 0],
      [b[0], b[1], z, u1, 0],
      [a[0], a[1], z + height, u0, v1],
      [b[0], b[1], z + height, u1, v1],
    ];
    for (const [x, y, zz, u, v] of quad) {
      pos.push(x * S, zz * S, -y * S);
      uv.push(u, v);
      if (mid) c.copy(mid);
      else c.copy(y < 0 ? BLUE : ORANGE);
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
};

/** Chevrons pointing right (mirror the UVs for the other side); scrolls via offset. */
const chevronTexture = (team: number): CanvasTexture => {
  const [cv, g] = canvas(128, 64);
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, 128, 64);
  const cols = [TEAMS[team]!.color, '#ffffff'];
  for (let k = 0; k < 2; k += 1) {
    const x = k * 64;
    g.fillStyle = cols[k]!;
    g.shadowColor = cols[k]!;
    g.shadowBlur = 8;
    g.beginPath();
    g.moveTo(x + 8, 6);
    g.lineTo(x + 30, 6);
    g.lineTo(x + 54, 32);
    g.lineTo(x + 30, 58);
    g.lineTo(x + 8, 58);
    g.lineTo(x + 32, 32);
    g.closePath();
    g.fill();
  }
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  return t;
};

// ------------------------------------------------------------------ the view

interface GoalScreens {
  score: { tex: CanvasTexture; ctx: CanvasRenderingContext2D };
  sides: { tex: CanvasTexture; ctx: CanvasRenderingContext2D }[];
  chevrons: CanvasTexture[];
}

/** What stands round the arena: the neon City or the day Stadium. */
interface Surroundings {
  readonly root: Group;
  setScoreboard(blue: number, orange: number, clock: string): void;
  update(dt: number): void;
}

/**
 * The arena, dressed for one theme. The shell, pads, goal boxes, nets and
 * frames are shared (the physical arena never changes); the rest is per theme:
 *
 * - 'neon' - ARENA 1, "NEON PARK", after Rocket League's Neo Tokyo: a wet city
 *   street of a pitch with worn road paint, dark riveted walls with blue and
 *   orange LED dot strips, goals under angled LED hoods with scrolling chevrons
 *   and a dot-matrix SCORE, flanking LED screens, a dense neon city at night.
 * - 'day' - ARENA 2, "GRAND PRIX PARK", after RL's sunny race-day fields: turf
 *   inside an asphalt track with kerbs, light concrete walls with ad boards,
 *   white goal frames under balloon arches, a full stadium in summer sun.
 */
export class ArenaView {
  readonly root = new Group();
  readonly pads = new BoostPads();
  readonly surroundings: Surroundings;
  private readonly goalLights: MeshBasicMaterial[] = [];
  private readonly goalBase: Color[] = [];
  private readonly screens: GoalScreens[] = [];
  private barrier!: ShaderMaterial;
  private readonly nets: ShaderMaterial[] = [];
  private clock = 0;
  private scoreKey = '';

  constructor(readonly theme: ArenaTheme = 'neon') {
    this.root.name = 'arena';
    this.surroundings = theme === 'day' ? new Stadium() : new City();
    this.buildFloor();
    this.buildShell();
    this.buildGoals();
    this.root.add(this.pads.root, this.surroundings.root);
  }

  /** Free every GPU resource this view made (on an arena change). */
  dispose(): void {
    this.root.traverse((o) => {
      // meshes, instanced meshes and sprites (the pad halos) alike
      const m = o as Partial<Mesh>;
      if (!m.material) return;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v && (v as { isTexture?: boolean }).isTexture) (v as CanvasTexture).dispose();
        if ((mat as ShaderMaterial).uniforms) for (const u of Object.values((mat as ShaderMaterial).uniforms)) if (u.value?.isTexture) u.value.dispose();
        mat.dispose();
      }
    });
  }

  private add(geo: BufferGeometry, mat: Material, name: string, order = 0): Mesh {
    const m = new Mesh(geo, mat);
    m.name = name;
    m.renderOrder = order;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.root.add(m);
    return m;
  }

  private buildFloor(): void {
    const LY = HY + GD;
    const pos: number[] = [];
    const uv: number[] = [];
    const v = (x: number, y: number): void => {
      pos.push(x * S, 0, -y * S);
      uv.push((x + HX) / (2 * HX), (y + LY) / (2 * LY));
    };
    for (let i = 0; i < 8; i += 1) {
      const a = OCT[i]!;
      const b = OCT[(i + 1) % 8]!;
      v(0, 0);
      v(a[0], a[1]);
      v(b[0], b[1]);
    }
    for (const s of [-1, 1]) {
      const y0 = s * Y0;
      const y1 = s * (HY + GD);
      const quad: [number, number][] = [
        [-GW, y0],
        [GW, y0],
        [GW, y1],
        [-GW, y0],
        [GW, y1],
        [-GW, y1],
      ];
      for (const [x, y] of quad) v(x, y);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const day = this.theme === 'day';
    const { map, rough } = day ? dayPitch() : asphalt();
    const mat = new MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, metalness: day ? 0 : 0.18, envMapIntensity: day ? 0.45 : 1.25, side: DoubleSide });
    this.add(g, mat, 'pitch').receiveShadow = true;
  }

  private buildShell(): void {
    const solidRows = PROFILE.filter(([, z]) => z <= SOLID_TOP);
    const glassRows = PROFILE.filter(([, z]) => z >= SOLID_TOP);
    const day = this.theme === 'day';
    const walls = day
      ? new MeshStandardMaterial({ vertexColors: true, map: metalPanels(), metalness: 0.08, roughness: 0.7, envMapIntensity: 0.6, side: DoubleSide })
      : new MeshStandardMaterial({ vertexColors: true, map: metalPanels(), metalness: 0.6, roughness: 0.42, envMapIntensity: 1.1, side: DoubleSide });
    this.add(shell(solidRows, day ? dayPanelColor : panelColor), walls, 'walls').receiveShadow = true;

    const wall = shell(glassRows, null);
    const cap = (() => {
      const pos: number[] = [];
      const uv: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const a = OCT[i]!;
        const b = OCT[(i + 1) % 8]!;
        for (const [x, y] of [[0, 0], [b[0], b[1]], [a[0], a[1]]] as const) {
          pos.push(x * S, H * S, -y * S);
          uv.push(x * S, y * S);
        }
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
      return g;
    })();
    this.barrier = day
      ? barrierMaterial({ cell: 7.5, tint: 0xd8ecff, line: 0xeef6ff, fill: 0.0, lines: 0.11, pent: 0, teams: true, width: 0.008, pentR: 0.36, pentOutline: true, farFade: 1.0 })
      : barrierMaterial({ cell: 7.5, tint: 0x6f9cff, line: 0xcfe2ff, fill: 0.01, lines: 0.15, pent: 0, teams: true, width: 0.008, pentR: 0.36, pentOutline: true });
    this.add(wall, this.barrier, 'enclosure-walls', 5);
    this.add(cap, this.barrier, 'enclosure-roof', 5);

    if (day) {
      // pitch-side ad boards along the foot of the wall, a white trim where the lattice starts
      const boards = adBoardTexture();
      boards.repeat.set(-1, 1); // the ribbon's u runs right-to-left as seen from inside: un-mirror the text
      this.add(ledRibbon(R + 12, 120, 3, 1 / 19.2, new Color(1, 1, 1)), new MeshBasicMaterial({ map: boards, vertexColors: true, side: DoubleSide }), 'ad-boards', 1);
      this.add(ribbon(SOLID_TOP - 8, 10, 3), new MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.4, side: DoubleSide }), 'trims');
      return;
    }

    // LED dot strips: team colours along the top of the ramp, a cool row at the top of the wall
    const dots = dotTexture();
    const led = new MeshBasicMaterial({ map: dots, vertexColors: true, toneMapped: false, color: new Color(3.2, 3.2, 3.2), side: DoubleSide });
    this.add(mergeGeometries([ledRibbon(R + 26, 26, 3, 3.2), ledRibbon(R + 70, 26, 3, 3.2)])!, led, 'led-ramp', 1);
    this.add(ledRibbon(SOLID_TOP - 50, 22, 3, 3, new Color(0.25, 0.75, 1)), led, 'led-top', 1);
    // a crisp edge where the lattice starts and a glow line round the top of the walls
    const trims = mergeGeometries([ribbon(SOLID_TOP - 6, 8, 3), ribbon(H - R - 20, 10, 3)])!;
    this.add(trims, new MeshBasicMaterial({ color: new Color(0.35, 0.65, 1).multiplyScalar(2.2), toneMapped: false, side: DoubleSide }), 'trims');
  }

  /**
   * NEO TOKYO GOALS: a dark interior with the lattice net inset (no coplanar
   * faces), a gunmetal frame with team LED strips, an angled LED hood above
   * the mouth with scrolling chevrons and the team's SCORE in dot matrix, and
   * two angled LED screens flanking it, showing SCORE in orange dot matrix.
   */
  private buildGoals(): void {
    const inset = 0.05;
    for (const [team, s] of [
      [0, -1],
      [1, 1],
    ] as const) {
      const col = new Color(TEAMS[team].color);
      const hot = col.clone().multiplyScalar(5);
      const zc = (y: number): number => -s * y * S;
      const box = (shrink: number): BufferGeometry => {
        const parts: BufferGeometry[] = [];
        const back = new PlaneGeometry(GW * 2 * S - shrink * 2, GH * S - shrink);
        back.translate(0, (GH * S - shrink) / 2, zc(HY + GD) + s * shrink);
        parts.push(back);
        for (const sx of [-1, 1]) {
          const side = new PlaneGeometry(GD * S, GH * S - shrink);
          side.rotateY(Math.PI / 2);
          side.translate(sx * (GW * S - shrink), (GH * S - shrink) / 2, zc(HY + GD / 2));
          parts.push(side);
        }
        const roof = new PlaneGeometry(GW * 2 * S - shrink * 2, GD * S);
        roof.rotateX(Math.PI / 2);
        roof.translate(0, GH * S - shrink, zc(HY + GD / 2));
        parts.push(roof);
        return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
      };
      const day = this.theme === 'day';
      this.add(
        box(0),
        day
          ? new MeshStandardMaterial({ color: col.clone().multiplyScalar(0.45), metalness: 0.1, roughness: 0.6, side: DoubleSide })
          : new MeshStandardMaterial({ color: col.clone().multiplyScalar(0.05), emissive: col.clone().multiplyScalar(0.05), metalness: 0.6, roughness: 0.5, side: DoubleSide }),
        `goal${team}-inner`,
      ).receiveShadow = true;
      const net = box(inset);
      const pos = net.getAttribute('position') as BufferAttribute;
      const uvs = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i += 1) {
        const fx = pos.getX(i);
        const fy = pos.getY(i);
        const fz = pos.getZ(i);
        const onSide = Math.abs(Math.abs(fx) - (GW * S - inset)) < 1e-3;
        const onRoof = Math.abs(fy - (GH * S - inset)) < 1e-3 && !onSide;
        uvs[i * 2] = onSide ? fz : fx;
        uvs[i * 2 + 1] = onRoof ? fz : fy;
      }
      net.setAttribute('uv', new BufferAttribute(uvs, 2));
      const netMat = barrierMaterial({ cell: 1.4, tint: col.getHex(), line: col.clone().lerp(new Color(0xffffff), 0.4).getHex(), fill: 0.0, lines: 0.9, pent: 0, teams: false, width: 0.025 });
      netMat.polygonOffset = true;
      netMat.polygonOffsetFactor = -2;
      netMat.polygonOffsetUnits = -2;
      this.nets.push(netMat);
      this.add(net, netMat, `goal${team}-net`, 4);

      // frame
      const frame: BufferGeometry[] = [];
      const lit: BufferGeometry[] = [];
      const bar = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, rad: number, list: BufferGeometry[]): void => {
        const a = new Vector3(ax * S, az * S, -ay * S);
        const b = new Vector3(bx * S, bz * S, -by * S);
        const len = a.distanceTo(b);
        const g = new BoxGeometry(rad * 2, len + rad * 2, rad * 2);
        const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
        g.applyMatrix4(new Matrix4().makeRotationFromQuaternion(q));
        g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        list.push(g.toNonIndexed());
      };
      for (const sx of [-1, 1]) {
        let prev: [number, number] | null = null;
        for (let i = 0; i <= 8; i += 1) {
          const z = (R * i) / 8;
          const y = Y0 + Math.sqrt(Math.max(0, R * R - (R - z) * (R - z)));
          if (prev) bar(sx * GW, s * prev[0], prev[1], sx * GW, s * y, z, 0.24, frame);
          prev = [y, z];
        }
        bar(sx * GW, s * HY, R, sx * GW, s * HY, GH, 0.24, frame);
        bar(sx * (GW - 26), s * (HY - 10), R, sx * (GW - 26), s * (HY - 10), GH - 26, 0.04, lit);
      }
      bar(-GW, s * HY, GH, GW, s * HY, GH, 0.24, frame);
      bar(-GW + 26, s * (HY - 10), GH - 26, GW - 26, s * (HY - 10), GH - 26, 0.04, lit);
      this.add(
        mergeGeometries(frame)!,
        day ? new MeshStandardMaterial({ color: 0xf2f4f8, metalness: 0.3, roughness: 0.35 }) : new MeshStandardMaterial({ color: 0x323846, metalness: 0.75, roughness: 0.3 }),
        `goal${team}-frame`,
      );
      const frameMesh = this.root.getObjectByName(`goal${team}-frame`)!;
      frameMesh.castShadow = true;
      frameMesh.receiveShadow = true;
      const glow = new MeshBasicMaterial({ color: (day ? col.clone().multiplyScalar(2.2) : hot).clone(), toneMapped: false });
      this.goalLights[team] = glow;
      this.goalBase[team] = glow.color.clone();
      this.add(mergeGeometries(lit)!, glow, `goal${team}-strips`);
      if (day) this.balloonArch(team, zc);
      else this.neonHood(team, s, zc, glow);
      this.goalFloor(col, hot, zc, team);
    }
    this.setScoreboard(0, 0, '5:00');
  }

  /**
   * Grand Prix goals: an arch of balloon clusters (team colour and white)
   * standing just behind the wall plane, so its crown shows above the goal
   * through the lattice and nothing sticks into the drivable wall.
   */
  private balloonArch(team: number, zc: (y: number) => number): void {
    const col = new Color(TEAMS[team]!.color);
    const light = new Color(TEAMS[team]!.light);
    const white = new Color(0xffffff);
    const rx = (GW + 420) * S;
    const ry = (GH + 560) * S;
    const z = zc(HY + 120);
    const spots: [number, number, number, Color][] = [];
    const N = 52;
    for (let i = 0; i <= N; i += 1) {
      const t = (i / N) * Math.PI;
      const x = Math.cos(t) * rx;
      const y = Math.sin(t) * ry;
      if (y < SOLID_TOP * S - 1.2) continue; // hidden behind the wall
      // the arch's normal in its own plane, for the cluster's spread
      const nx = Math.cos(t) * ry;
      const ny = Math.sin(t) * rx;
      const nl = Math.hypot(nx, ny);
      const c = i % 3 === 0 ? white : i % 3 === 1 ? col : light;
      for (const [a, b] of [
        [0.42, 0],
        [-0.42, 0],
        [0, 0.42],
        [0, -0.42],
      ] as const)
        spots.push([x + (nx / nl) * a, y + (ny / nl) * a, z + b, c]);
    }
    const mesh = new InstancedMesh(balloonGeometry(), balloonMaterial(), spots.length);
    const d = new Object3D();
    spots.forEach(([x, y, zz, c], i) => {
      d.position.set(x, y, zz);
      d.scale.setScalar(0.5);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      mesh.setColorAt(i, c);
    });
    mesh.name = `goal${team}-balloons`;
    mesh.castShadow = true;
    this.root.add(mesh);
  }

  /** Neo Tokyo goals: the angled LED hood and the two flanking SCORE screens. */
  private neonHood(team: number, s: number, zc: (y: number) => number, glow: MeshBasicMaterial): void {
    {

      // the hood above the mouth, built facing +z (the field) and turned for the blue end
      const hood = new Group();
      hood.position.set(0, (GH + 120) * S + 2.0, zc(HY + 140));
      hood.rotation.y = s > 0 ? 0 : Math.PI;
      const tilt = new Group();
      tilt.rotation.x = 0.42;
      hood.add(tilt);
      const HW = (GW + 520) * 2 * S;
      const housing = new Mesh(new BoxGeometry(HW + 0.6, 3.8, 0.9), new MeshStandardMaterial({ color: 0x1a1e28, metalness: 0.7, roughness: 0.35 }));
      housing.position.z = -0.55;
      tilt.add(housing);
      // centre: SCORE n in dot matrix
      const [sc, sctx] = canvas(512, 160);
      const scoreTex = new CanvasTexture(sc);
      scoreTex.colorSpace = SRGBColorSpace;
      const centre = new Mesh(new PlaneGeometry(9, 2.8), new MeshBasicMaterial({ map: scoreTex, toneMapped: false, color: new Color(1.8, 1.8, 1.8) }));
      centre.position.z = 0.01;
      tilt.add(centre);
      // chevrons both sides, scrolling towards the middle
      const chevrons: CanvasTexture[] = [];
      for (const side of [-1, 1]) {
        const ct = chevronTexture(team);
        ct.repeat.set(side > 0 ? -5 : 5, 1);
        chevrons.push(ct);
        const strip = new Mesh(new PlaneGeometry(HW / 2 - 5, 2.6), new MeshBasicMaterial({ map: ct, toneMapped: false, color: new Color(2.2, 2.2, 2.2) }));
        strip.position.set(side * (HW / 4 + 2.5), 0, 0.01);
        tilt.add(strip);
      }
      // neon outline round the hood
      const outline: BufferGeometry[] = [];
      for (const y of [-1.95, 1.95]) {
        const b = new BoxGeometry(HW + 0.8, 0.12, 0.12);
        b.translate(0, y, 0.05);
        outline.push(b.toNonIndexed());
      }
      for (const x of [-(HW / 2 + 0.35), HW / 2 + 0.35]) {
        const b = new BoxGeometry(0.12, 4, 0.12);
        b.translate(x, 0, 0.05);
        outline.push(b.toNonIndexed());
      }
      tilt.add(new Mesh(mergeGeometries(outline)!, glow));
      hood.traverse((o) => (o.castShadow = true));
      this.root.add(hood);

      // flanking LED screens, angled towards the pitch
      const sides: { tex: CanvasTexture; ctx: CanvasRenderingContext2D }[] = [];
      for (const sx of [-1, 1]) {
        const [c2, g2] = canvas(128, 160);
        const t2 = new CanvasTexture(c2);
        t2.colorSpace = SRGBColorSpace;
        const panel = new Group();
        panel.position.set(sx * (GW + 900) * S, (SOLID_TOP + 40) * S + 3, zc(HY + 170));
        panel.rotation.y = (s > 0 ? 0 : Math.PI) - sx * s * 0.55;
        const frameBox = new Mesh(new BoxGeometry(4.6, 5.8, 0.5), new MeshStandardMaterial({ color: 0x1a1e28, metalness: 0.7, roughness: 0.35 }));
        frameBox.position.z = -0.32;
        const screen = new Mesh(new PlaneGeometry(4.1, 5.2), new MeshBasicMaterial({ map: t2, toneMapped: false, color: new Color(1.7, 1.7, 1.7) }));
        const rim: BufferGeometry[] = [];
        for (const y of [-2.95, 2.95]) {
          const b = new BoxGeometry(4.8, 0.1, 0.1);
          b.translate(0, y, 0.02);
          rim.push(b.toNonIndexed());
        }
        for (const x of [-2.35, 2.35]) {
          const b = new BoxGeometry(0.1, 6, 0.1);
          b.translate(x, 0, 0.02);
          rim.push(b.toNonIndexed());
        }
        panel.add(frameBox, screen, new Mesh(mergeGeometries(rim)!, glow));
        this.root.add(panel);
        sides.push({ tex: t2, ctx: g2 });
      }
      this.screens[team] = { score: { tex: scoreTex, ctx: sctx }, sides, chevrons };
    }
  }

  /** The glowing goal line and the team light pooled on the goal floor. */
  private goalFloor(col: Color, hot: Color, zc: (y: number) => number, team: number): void {
    {
      // goal line and the light inside
      const line = new PlaneGeometry(2 * GW * S, 0.5);
      line.rotateX(-Math.PI / 2);
      line.translate(0, 0.02, zc(HY + 25));
      this.add(line, new MeshBasicMaterial({ color: hot, transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), `goal${team}-line`, 3);
      const pool = new PlaneGeometry(2 * GW * S - 0.4, GD * S - 0.4);
      pool.rotateX(-Math.PI / 2);
      pool.translate(0, 0.025, zc(HY + GD / 2));
      this.add(pool, new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false }), `goal${team}-floor`, 3);
    }
  }

  /** Each goal's hood shows that team's score; the city's big screens show the game. */
  setScoreboard(blue: number, orange: number, clock: string): void {
    this.surroundings.setScoreboard(blue, orange, clock);
    const key = `${blue}|${orange}`;
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    [blue, orange].forEach((score, team) => {
      const sc = this.screens[team];
      if (!sc) return;
      const g = sc.score.ctx;
      g.fillStyle = '#04050a';
      g.fillRect(0, 0, 512, 160);
      const colour = team === 0 ? '#5fb0ff' : '#ff9a3c';
      const num = String(score);
      ledText(g, 'SCORE', 196, 80, 11, colour);
      ledText(g, num, 430, 80, num.length > 1 ? 9 : 11, '#ffffff');
      sc.score.tex.needsUpdate = true;
      // the flanking screens: SCORE over a big number, all in dot matrix
      for (const { tex, ctx: s2 } of sc.sides) {
        s2.fillStyle = '#04050a';
        s2.fillRect(0, 0, 128, 160);
        ledText(s2, 'SCORE', 64, 26, 4, colour);
        const num = String(score);
        ledText(s2, num, 64, 98, num.length > 1 ? 10 : 13, '#ffffff');
        tex.needsUpdate = true;
      }
    });
  }

  update(dt: number, pads: Int32Array, goalPulse: [number, number], _hype: number): void {
    this.clock += dt;
    this.pads.update(dt, pads);
    this.surroundings.update(dt);
    this.barrier.uniforms['uTime']!.value = this.clock;
    this.barrier.uniforms['uPulse']!.value = [goalPulse[0], goalPulse[1]];
    for (const n of this.nets) n.uniforms['uTime']!.value = this.clock;
    for (let t = 0; t < 2; t += 1) {
      const m = this.goalLights[t];
      const b = this.goalBase[t];
      if (m && b) m.color.copy(b).multiplyScalar(1 + (goalPulse[t] ?? 0) * 1.8 + Math.sin(this.clock * 2 + t) * 0.08);
      const sc = this.screens[t];
      if (sc) sc.chevrons.forEach((c, k) => (c.offset.x = (k === 0 ? -1 : 1) * this.clock * 0.6 * (1 + (goalPulse[t] ?? 0) * 3)));
    }
  }
}
