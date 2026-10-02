import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, LatheGeometry, Shape, TorusGeometry, Vector2 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { creased } from './loft.js';

/**
 * WHEELS: a tyre (rubber: its own rough material) and a rim (metal, vertex coloured),
 * both spinning about +Z with the design on the +Z face (left wheels are mirrored so
 * every design faces out). Rim designs follow the reference cars.
 */
export interface WheelSpec {
  r: number;
  width: number;
  front: number;
  rear: number;
  track: number;
  style: 'twin5' | 'snow' | 'turbine5' | 'multi10' | 'six';
  /** Rim (spokes) colour, its outer lip, an accent (pinstripe / centre), the brake disc hat. */
  rim: number;
  lip: number;
  accent: number;
  /** Rim metalness (white-painted rims are less metallic). */
  metal?: number;
  /** Sidewall lettering / stripe colour (null: plain rubber). */
  wall?: number | null;
}

const colour = (g: BufferGeometry, hex: number): BufferGeometry => {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new Color(hex);
  const n = geo.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new Float32BufferAttribute(a, 3));
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  return geo;
};

const finish = (parts: BufferGeometry[], crease = 35): BufferGeometry => creased(mergeGeometries(parts)!, crease);

/** A tapered spoke on the face plane: from radius r0 (width w0) to r1 (width w1), depth d, dished by `dish`. */
const spoke = (r0: number, r1: number, w0: number, w1: number, d: number, face: number, dish: number, angle: number, twist = 0): BufferGeometry => {
  const s = new Shape([new Vector2(-w0 / 2, r0), new Vector2(w0 / 2, r0), new Vector2(w1 / 2, r1), new Vector2(-w1 / 2, r1)]);
  const g = new ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: Math.min(w0, w1) * 0.12, bevelThickness: d * 0.25, bevelSegments: 1 });
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i += 1) {
    const y = p.getY(i);
    const x = p.getX(i);
    // dish: the hub end sits deeper in the wheel than the rim end; twist: one edge raised
    const k = Math.max(0, Math.min(1, (r1 - y) / (r1 - r0)));
    p.setZ(i, p.getZ(i) + face - d - dish * k + twist * (x / Math.max(w0, w1)));
  }
  g.rotateZ(angle);
  return g;
};

/** `lod` 1: the far wheel - fewer segments, no tread grooves, no lug nuts. */
export const wheelGeometry = (w: WheelSpec, lod = 0): { tyre: BufferGeometry; rim: BufferGeometry } => {
  const seg = lod ? 18 : 36;
  const r = w.r;
  const hw = w.width / 2;
  // ---- tyre: rounded shoulders, a flat tread, the sidewall curving in to the bead
  const rr = r * 0.74; // rim radius
  const prof = [
    new Vector2(rr * 0.99, -hw * 0.86),
    new Vector2(r * 0.86, -hw * 0.98),
    new Vector2(r * 0.95, -hw * 0.94),
    new Vector2(r * 0.99, -hw * 0.78),
    new Vector2(r, -hw * 0.55),
    new Vector2(r, hw * 0.55),
    new Vector2(r * 0.99, hw * 0.78),
    new Vector2(r * 0.95, hw * 0.94),
    new Vector2(r * 0.86, hw * 0.98),
    new Vector2(rr * 0.99, hw * 0.86),
  ];
  const tyreParts: BufferGeometry[] = [];
  const lathe = new LatheGeometry(lod ? [prof[0]!, prof[2]!, prof[4]!, prof[5]!, prof[7]!, prof[9]!] : prof, seg);
  lathe.rotateX(Math.PI / 2);
  tyreParts.push(colour(lathe, 0x1b1c20));
  // tread grooves: three dark rings round the crown
  for (const z of lod ? [] : [-hw * 0.3, hw * 0.3]) {
    const t = new TorusGeometry(r * 1.0005, 0.0025, 3, seg);
    t.translate(0, 0, z);
    tyreParts.push(colour(t, 0x0c0d0f));
  }
  if (w.wall != null) {
    // a thin coloured ring on the outer sidewall (the reference's lettering band)
    const t = new TorusGeometry(r * 0.88, 0.0035, 3, seg);
    t.translate(0, 0, hw * 0.97);
    tyreParts.push(colour(t, w.wall));
  }
  const tyre = finish(tyreParts, 50);

  // ---- rim
  const parts: BufferGeometry[] = [];
  const face = hw * 0.8; // the design's outer plane
  // barrel (inside the tyre), the dark well behind the spokes, the brake disc and hat
  const barrel = new CylinderGeometry(rr, rr, w.width * 0.86, lod ? 14 : 30, 1, true);
  barrel.rotateX(Math.PI / 2);
  parts.push(colour(barrel, 0x3a3d44));
  const well = new CylinderGeometry(rr * 0.97, rr * 0.97, 0.004, lod ? 14 : 30);
  well.rotateX(Math.PI / 2);
  well.translate(0, 0, -hw * 0.3);
  parts.push(colour(well, 0x101114));
  const disc = new CylinderGeometry(rr * 0.8, rr * 0.8, 0.014, lod ? 12 : 26);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, 0, -hw * 0.05);
  parts.push(colour(disc, 0x6d7079));
  const hat = new CylinderGeometry(rr * 0.38, rr * 0.38, 0.02, 18);
  hat.rotateX(Math.PI / 2);
  hat.translate(0, 0, 0.005);
  parts.push(colour(hat, 0x55585f));
  // outer lip
  const lip = new TorusGeometry(rr * 0.985, r * 0.035, lod ? 3 : 5, lod ? 16 : 36);
  lip.translate(0, 0, face);
  parts.push(colour(lip, w.lip));
  const lipFlat = new CylinderGeometry(rr * 1.0, rr * 0.93, 0.008, lod ? 16 : 36, 1, true);
  lipFlat.rotateX(Math.PI / 2);
  lipFlat.translate(0, 0, face - 0.004);
  parts.push(colour(lipFlat, w.lip));

  const R0 = rr * 0.24; // hub radius
  const R1 = rr * 0.93;
  const d = 0.014;
  const add = (g: BufferGeometry, hex: number): void => {
    parts.push(colour(g, hex));
  };
  switch (w.style) {
    case 'twin5': // five pairs of slim spokes, deeply dished (the green supercar)
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2;
        for (const o of [-0.11, 0.11]) add(spoke(R0, R1, rr * 0.13, rr * 0.08, d, face, 0.03, a + o * 0.55), w.rim);
      }
      break;
    case 'snow': // six snowflake arms with side branches, and a ring (the ice muscle car)
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        add(spoke(R0, R1, rr * 0.11, rr * 0.07, d, face, 0.012, a), w.rim);
        for (const side of [-1, 1]) {
          for (const at of [0.45, 0.7]) {
            const b = new BoxGeometry(rr * 0.05, rr * 0.22 * (at === 0.45 ? 1 : 0.75), d);
            b.translate(0, rr * 0.11, 0);
            b.rotateZ(side * 0.75);
            b.translate(0, R0 + (R1 - R0) * at, face - d / 2 - 0.004);
            b.rotateZ(a);
            add(b, w.rim);
          }
        }
      }
      {
        const ring = new TorusGeometry(rr * 0.5, rr * 0.03, 4, 30);
        ring.translate(0, 0, face - 0.01);
        add(ring, w.accent);
      }
      break;
    case 'turbine5': // five broad spokes with a twist (the hot hatch)
      for (let i = 0; i < 5; i += 1) add(spoke(R0, R1, rr * 0.3, rr * 0.2, d, face, 0.018, (i / 5) * Math.PI * 2, 0.006), w.rim);
      break;
    case 'multi10': // ten thin spokes, a coloured pinstripe ring (the teal/yellow car)
      for (let i = 0; i < 10; i += 1) add(spoke(R0, R1, rr * 0.075, rr * 0.06, d, face, 0.022, (i / 10) * Math.PI * 2), w.rim);
      {
        const ring = new TorusGeometry(rr * 0.9, r * 0.012, 3, 36);
        ring.translate(0, 0, face + 0.001);
        add(ring, w.accent);
      }
      break;
    case 'six': // six fat spokes, deep dish (the chunky all-rounder)
      for (let i = 0; i < 6; i += 1) add(spoke(R0, R1, rr * 0.3, rr * 0.36, d, face, 0.035, (i / 6) * Math.PI * 2), w.rim);
      break;
  }
  // centre cap and lug nuts
  const cap = new CylinderGeometry(R0 * 0.62, R0 * 0.75, 0.016, 16);
  cap.rotateX(Math.PI / 2);
  cap.translate(0, 0, face - 0.002);
  add(cap, w.accent);
  const nuts = lod ? 0 : w.style === 'six' ? 6 : 5;
  for (let i = 0; i < nuts; i += 1) {
    const a = (i / nuts) * Math.PI * 2 + Math.PI / nuts;
    const n = new CylinderGeometry(0.0055, 0.0055, 0.01, 6);
    n.rotateX(Math.PI / 2);
    n.translate(Math.cos(a) * R0 * 0.82, Math.sin(a) * R0 * 0.82, face - 0.006);
    add(n, 0xc8ccd4);
  }
  return { tyre, rim: finish(parts, 40) };
};
