import { ARENA } from '@rlb/shared';
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { S } from './units.js';

/** Seeded random, so the city is the same on every machine. */
let seed = 20261002;
const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;

/** The giant-ball tower (x beyond the arena's side wall, z), and how far behind each goal the big screens stand. */
const BALL_TOWER = [70, -40] as const;
const SCREEN_Z = 46;

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};

const tex = (c: HTMLCanvasElement, repeat = false): CanvasTexture => {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  }
  t.anisotropy = 4;
  return t;
};

const flatten = (g: BufferGeometry): BufferGeometry => (g.index ? g.toNonIndexed() : g);

/** Give a geometry a flat vertex colour so differently-coloured parts merge into one draw. */
const tint = (g: BufferGeometry, c: Color): BufferGeometry => {
  const f = flatten(g);
  const n = f.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  f.setAttribute('color', new Float32BufferAttribute(col, 3));
  return f;
};

/** Facade window patterns at night: the emissive map (lit windows) for one style. */
const windowStyle = (style: number): CanvasTexture => {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  const warm = ['#ffd38a', '#ffe6b0', '#ffb860'];
  const cool = ['#9fe0ff', '#d8f2ff', '#7fb8ff'];
  const pal = style === 1 ? cool : style === 3 ? [...warm, ...cool, '#ff8ad8'] : warm;
  if (style === 2) {
    // office floors: long horizontal light bands, some floors dark
    for (let y = 4; y < 128; y += 11) {
      if (rnd() < 0.35) continue;
      g.fillStyle = pick(cool);
      g.globalAlpha = 0.25 + rnd() * 0.45;
      g.fillRect(0, y, 128, 4);
    }
  } else {
    const sx = style === 1 ? 8 : 10;
    for (let x = 2; x < 128; x += sx) {
      for (let y = 2; y < 128; y += 9) {
        if (rnd() < 0.72) continue;
        g.fillStyle = pick(pal);
        g.globalAlpha = 0.3 + rnd() * 0.7;
        g.fillRect(x, y, sx - 4, 5);
      }
    }
  }
  g.globalAlpha = 1;
  return tex(c, true);
};

/** Vertical neon signs (8 blades, 128x512) on top, colourful billboards (4, 512x256) below. */
const KANJI = ['ネオン東京', 'ロケット', 'ラーメン', 'ホテル街', 'ブースト', '夜市場', 'カラオケ', '未来都市'];
const ADS: [string, string, string, string][] = [
  // headline, sub, colour A, colour B
  ['BOOST', 'エナジー', '#ff2f7a', '#ffb02f'],
  ['NEO', 'TOKYO', '#2fd0ff', '#7a2fff'],
  ['ロケット', 'ROCKET', '#ffe04a', '#ff5a2a'],
  ['HYPER', 'ハイパー', '#46ff8a', '#2f7aff'],
];
const NEON = ['#ff3fa8', '#2ff3ff', '#ffe04a', '#ff5a2a', '#8a5bff', '#46ff8a', '#ff3030', '#ffffff'];
const signAtlas = (): CanvasTexture => {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 1024);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  KANJI.forEach((t, i) => {
    const x = i * 128;
    const col = NEON[i]!;
    const light = i % 3 === 2; // some are lit white boxes with coloured characters
    g.fillStyle = light ? '#f4f0e8' : '#0a0612';
    g.fillRect(x + 8, 6, 112, 500);
    g.strokeStyle = col;
    g.lineWidth = 6;
    g.shadowColor = col;
    g.shadowBlur = 18;
    g.strokeRect(x + 14, 12, 100, 488);
    g.font = '900 78px "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif';
    const chars = [...t];
    chars.forEach((ch, k) => {
      const cy = 256 + (k - (chars.length - 1) / 2) * 90;
      g.fillStyle = light ? (i % 2 ? '#d01818' : '#1838c8') : '#ffffff';
      g.fillText(ch, x + 64, cy);
      if (!light) {
        g.fillStyle = col;
        g.globalAlpha = 0.55;
        g.fillText(ch, x + 64, cy);
        g.globalAlpha = 1;
      }
    });
    g.shadowBlur = 0;
  });
  ADS.forEach(([head, sub, a, b], i) => {
    const x = (i % 2) * 512;
    const y = 512 + Math.floor(i / 2) * 256;
    const grad = g.createLinearGradient(x, y, x + 512, y + 256);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.fillRect(x + 4, y + 4, 504, 248);
    // a big shape and some stripes, like a product ad
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.arc(x + 400, y + 128, 100, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = 0; k < 6; k += 1) g.fillRect(x + 4, y + 200 + k * 9, 504, 4);
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 10;
    g.textAlign = 'left';
    g.font = '900 italic 96px "Titillium Web", "Yu Gothic", "Meiryo", sans-serif';
    g.fillText(head, x + 30, y + 100);
    g.font = '700 44px "Yu Gothic", "Meiryo", "Titillium Web", sans-serif';
    g.fillText(sub, x + 34, y + 172);
    g.textAlign = 'center';
    g.shadowBlur = 0;
  });
  return tex(c);
};

/** Street-level ground: dark wet asphalt city blocks with lane paint (emissive so it reads at night). */
const groundTextures = (): { map: CanvasTexture; glow: CanvasTexture } => {
  const N = 1024;
  const [c, g] = canvas(N, N);
  const [e, h] = canvas(N, N);
  g.fillStyle = '#14171f';
  g.fillRect(0, 0, N, N);
  h.fillStyle = '#000';
  h.fillRect(0, 0, N, N);
  // 1 px = 1 m; the texture repeats every 1024 m; streets every 64 m
  for (let k = 0; k < N; k += 64) {
    g.fillStyle = '#0d0f15';
    g.fillRect(k, 0, 16, N);
    g.fillRect(0, k, N, 16);
    h.fillStyle = 'rgba(255,190,90,0.5)';
    for (let d = 0; d < N; d += 8) {
      h.fillRect(k + 7.5, d, 1, 4);
      h.fillRect(d, k + 7.5, 4, 1);
    }
  }
  return { map: tex(c, true), glow: tex(e, true) };
};

/**
 * A rectangular tube swept along a closed curve: one continuous skin, so no
 * two faces ever overlap (overlapping boxes per segment were the monorail's
 * shimmer). The section is centred `side` / `lift` off the curve.
 */
const sweep = (curve: CatmullRomCurve3, n: number, hw: number, hh: number, side = 0, lift = 0): BufferGeometry => {
  const up = new Vector3(0, 1, 0);
  const rings: Vector3[][] = [];
  const p = new Vector3();
  const t = new Vector3();
  const s = new Vector3();
  const u = new Vector3();
  for (let i = 0; i < n; i += 1) {
    curve.getPointAt(i / n, p);
    curve.getTangentAt(i / n, t);
    s.crossVectors(t, up).normalize();
    u.crossVectors(s, t).normalize();
    const c = p.clone().addScaledVector(s, side).addScaledVector(u, lift);
    rings.push([
      c.clone().addScaledVector(s, -hw).addScaledVector(u, -hh),
      c.clone().addScaledVector(s, hw).addScaledVector(u, -hh),
      c.clone().addScaledVector(s, hw).addScaledVector(u, hh),
      c.clone().addScaledVector(s, -hw).addScaledVector(u, hh),
    ]);
  }
  const pos: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const A = rings[i]!;
    const B = rings[(i + 1) % n]!;
    for (let k = 0; k < 4; k += 1) {
      const k1 = (k + 1) % 4;
      for (const v of [A[k]!, B[k]!, A[k1]!, A[k1]!, B[k]!, B[k1]!]) pos.push(v.x, v.y, v.z);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2)); // untextured; merges with boxes
  g.computeVertexNormals();
  return g;
};

/** Scale a box's UVs to its size so windows keep a constant size (sides only). */
const facade = (w: number, h: number, d: number): BufferGeometry => {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const n = g.getAttribute('normal');
  for (let i = 0; i < uv.count; i += 1) {
    if (Math.abs(n.getY(i)) > 0.5) {
      uv.setXY(i, 0, 0); // roofs: unlit
      continue;
    }
    const across = Math.abs(n.getX(i)) > 0.5 ? d : w;
    uv.setXY(i, uv.getX(i) * (across / 30), uv.getY(i) * (h / 30));
  }
  return flatten(g);
};

/** The RL ball's panel pattern as an emissive map, for the giant ball sculpture. */
const ballTexture = (): CanvasTexture => {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#ffb060';
  g.lineWidth = 3;
  g.shadowColor = '#ff8a30';
  g.shadowBlur = 8;
  const r = 22;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 13; col += 1) {
      const cx = col * r * 1.75 + (row % 2) * r * 0.87;
      const cy = row * r * 1.5 + 16;
      g.beginPath();
      for (let k = 0; k <= 6; k += 1) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.stroke();
    }
  }
  return tex(c, true);
};

/** A searchlight beam: an open cone, brightest at the lamp, fading up its length and at its edges. */
const beamMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
    uniforms: { uColor: { value: new Color(0.55, 0.7, 1.0) } },
    vertexShader: `varying float vV; varying vec3 vN; varying vec3 vView;
      void main(){ vV = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vView = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; varying float vV; varying vec3 vN; varying vec3 vView;
      void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vView))), 1.6); float a = pow(vV, 2.2) * edge * 0.16; gl_FragColor = vec4(uColor * a, a); }`,
  });

interface Beam {
  pivot: Object3D;
  phase: number;
  speed: number;
  tilt: number;
}

/**
 * THE CITY around Neon Park, after Neo Tokyo: the arena sits at street level
 * in a dense grid of dark towers right up against it - lit windows, stacks of
 * vertical kanji signs and colourful billboards facing the pitch, LED edge
 * strips, an elevated monorail sweeping over one corner with a train running
 * on it, searchlights raking a cloudy night sky, a giant ball on a rooftop,
 * glowing balloons and big screens behind the goals.
 *
 * Built once from a fixed seed into a few dozen draw calls.
 */
export class City {
  readonly root = new Group();
  private readonly traffic: InstancedMesh;
  private readonly lanes: { r: number; h: number; speed: number; phase: number; dir: number }[] = [];
  private readonly beacons = new MeshBasicMaterial({ color: new Color(4, 0.3, 0.3), toneMapped: false });
  private readonly dummy = new Object3D();
  private screens: { tex: CanvasTexture; ctx: CanvasRenderingContext2D }[] = [];
  private screenKey = '';
  private t = 0;
  private readonly skyMat: ShaderMaterial;
  private readonly beams: Beam[] = [];
  private track!: CatmullRomCurve3;
  private train!: Group[];
  private balloons!: InstancedMesh;
  private readonly balloonSpots: { x: number; y: number; z: number; s: number; p: number }[] = [];
  private ball!: Mesh;

  constructor() {
    seed = 20261002;
    this.skyMat = this.buildSky();
    this.buildGround();
    this.buildTowers();
    this.buildMonorail();
    this.buildLandmarks();
    // flying traffic, high between the towers
    const car = new BoxGeometry(1.6, 0.5, 0.7);
    this.traffic = new InstancedMesh(car, new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 50);
    const c = new Color();
    for (let i = 0; i < 50; i += 1) {
      this.lanes.push({ r: 160 + rnd() * 240, h: 70 + rnd() * 70, speed: (8 + rnd() * 14) / 250, phase: rnd() * Math.PI * 2, dir: rnd() < 0.5 ? 1 : -1 });
      this.traffic.setColorAt(i, c.set(pick(['#ffe8b0', '#ff5050', '#7fe0ff', '#ffffff'])).multiplyScalar(3));
    }
    this.traffic.frustumCulled = false;
    this.root.add(this.traffic);
  }

  private add(g: BufferGeometry, m: Material, name: string): Mesh {
    const mesh = new Mesh(g, m);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.root.add(mesh);
    return mesh;
  }

  /** A low, heavy cloud deck lit from below by the city, darkening to near-black overhead. */
  private buildSky(): ShaderMaterial {
    const mat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir; uniform float uTime;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int k = 0; k < 5; k++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = mix(vec3(0.10,0.07,0.16), vec3(0.015,0.02,0.045), smoothstep(0.0, 0.55, h));
          // clouds projected on a ceiling plane, drifting
          vec2 p = d.xz / max(h, 0.06) * 1.6 + vec2(uTime * 0.012, uTime * 0.006);
          float cl = smoothstep(0.38, 0.85, fbm(p));
          float under = exp(-h * 3.2); // the city's glow on the cloud bellies near the horizon
          vec3 lit = mix(vec3(0.16,0.12,0.24), vec3(0.42,0.20,0.30), under);
          c = mix(c, lit, cl * smoothstep(0.0, 0.08, h) * 0.85);
          c += vec3(0.45,0.20,0.32) * exp(-abs(h) * 16.0) * 0.45;
          c = mix(c, vec3(0.04,0.04,0.07), smoothstep(0.0, -0.15, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new Mesh(new SphereGeometry(1400, 32, 16), mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.root.add(sky);
    return mat;
  }

  private buildGround(): void {
    const { map, glow } = groundTextures();
    const g = new PlaneGeometry(2400, 2400);
    g.rotateX(-Math.PI / 2);
    for (const t of [map, glow]) t.repeat.set(2400 / 1024, 2400 / 1024);
    const mat = new MeshStandardMaterial({ map, emissiveMap: glow, emissive: new Color(1.4, 1.4, 1.4), roughness: 0.35, metalness: 0.4 });
    const m = this.add(g, mat, 'ground');
    m.position.y = -0.08;
    m.updateMatrix();
  }

  private buildTowers(): void {
    const styles = [0, 1, 2, 3].map((s) => windowStyle(s));
    const buckets: BufferGeometry[][] = [[], [], [], []];
    const roofs: BufferGeometry[] = [];
    const beacons: BufferGeometry[] = [];
    const signs: BufferGeometry[] = [];
    const strips: BufferGeometry[] = [];
    const hx = ARENA.halfX * S;
    const hy = (ARENA.halfY + ARENA.goal.depth) * S;
    const beacon = (x: number, y: number, z: number): void => {
      const b = new SphereGeometry(0.8, 6, 4);
      b.translate(x, y, z);
      beacons.push(flatten(b));
    };
    /** A quad from the atlas on a face: n = outward normal (x or z axis), at (x, y, z). */
    const quad = (x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, slot: { u0: number; u1: number; v0: number; v1: number }, off: number): void => {
      const g = new PlaneGeometry(w, h);
      const uv = g.getAttribute('uv');
      for (let k = 0; k < uv.count; k += 1) uv.setXY(k, uv.getX(k) ? slot.u1 : slot.u0, uv.getY(k) ? slot.v1 : slot.v0);
      g.rotateY(Math.atan2(nx, nz));
      g.translate(x + nx * off, y, z + nz * off);
      signs.push(flatten(g));
    };
    const blade = (): { u0: number; u1: number; v0: number; v1: number } => {
      const i = Math.floor(rnd() * KANJI.length);
      return { u0: (i * 128) / 1024, u1: ((i + 1) * 128) / 1024, v0: 0.5, v1: 1 };
    };
    const board = (): { u0: number; u1: number; v0: number; v1: number } => {
      const i = Math.floor(rnd() * ADS.length);
      const u0 = (i % 2) * 0.5;
      const v1 = 0.5 - Math.floor(i / 2) * 0.25;
      return { u0, u1: u0 + 0.5, v0: v1 - 0.25, v1 };
    };
    const STRIP = [new Color(0.2, 2.6, 3.2), new Color(3.2, 0.5, 2.0), new Color(2.6, 2.6, 2.8), new Color(3.2, 1.4, 0.3)];
    const SP = 30;
    for (let gx = -15; gx <= 15; gx += 1) {
      for (let gz = -15; gz <= 15; gz += 1) {
        const x = gx * SP + (rnd() - 0.5) * 3;
        const z = gz * SP + (rnd() - 0.5) * 3;
        const dist = Math.hypot(x, z);
        if (dist > 440) continue;
        // at most 23 m wide on a 30 m grid with 1.5 m of jitter: neighbours never touch
        const w = 14 + rnd() * 9;
        const d = 14 + rnd() * 9;
        // clear of the arena
        if (Math.abs(x) - w / 2 < hx + 10 && Math.abs(z) - d / 2 < hy + 10) continue;
        // clear of the ball tower and of the plazas in front of the two big screens
        if (Math.abs(x - (hx + BALL_TOWER[0])) < w / 2 + 19 && Math.abs(z - BALL_TOWER[1]) < d / 2 + 19) continue;
        if (Math.abs(x) - w / 2 < 24 && Math.abs(z) + d / 2 > hy && Math.abs(z) - d / 2 < hy + SCREEN_Z + 16) continue;
        const near = Math.max(Math.abs(x) - hx, Math.abs(z) - hy);
        if (near > 60 && rnd() < 0.15) continue;
        const hgt = near < 50 ? 34 + rnd() * 60 + (rnd() < 0.2 ? 50 : 0) : 50 + rnd() * 110 + (rnd() < 0.12 ? 80 : 0);
        const style = Math.floor(rnd() * 4);
        const bucket = buckets[style]!;
        // main block, sometimes with a setback crown
        const base = rnd() < 0.4 ? hgt * (0.6 + rnd() * 0.2) : hgt;
        bucket.push(facade(w, base, d).translate(x, base / 2, z));
        if (base < hgt) bucket.push(facade(w * 0.7, hgt - base, d * 0.7).translate(x, base + (hgt - base) / 2, z));
        const roof = new BoxGeometry(w * 0.3, 4, d * 0.3);
        roof.translate(x, hgt + 2, z);
        roofs.push(flatten(roof));
        if (rnd() < 0.5) beacon(x, hgt + 5, z);
        if (near > 120) continue;
        // the face that looks at the arena
        const faceX = Math.abs(x) - hx > Math.abs(z) - hy;
        const nx = faceX ? -Math.sign(x) : 0;
        const nz = faceX ? 0 : -Math.sign(z);
        const fx = x + (nx * w) / 2;
        const fz = z + (nz * d) / 2;
        const span = faceX ? d : w;
        const ax = faceX ? 0 : 1; // along-face direction
        const az = faceX ? 1 : 0;
        // vertical kanji blades near the corners, stacked up the facade
        // (stacked per side with a gap, so blades never overlap each other)
        const blades = near < 60 ? 2 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2);
        const stackTop = [8, 8];
        for (let k = 0; k < blades; k += 1) {
          const sideIdx = k % 2;
          const along = (sideIdx ? 1 : -1) * (span / 2 - 2.2);
          const bh = 10 + rnd() * 8;
          const y0 = stackTop[sideIdx]! + rnd() * 4;
          if (y0 + bh > hgt - 2) continue;
          stackTop[sideIdx] = y0 + bh + 3;
          quad(fx + ax * along, y0 + bh / 2, fz + az * along, nx, nz, bh / 4, bh, blade(), 0.4);
        }
        // a billboard across the middle of the face, on its own plane in front of the blades
        if (rnd() < 0.55 && hgt > 30) {
          const bw = Math.min(span - 6, 12 + rnd() * 10);
          const by = Math.min(hgt - bw / 4 - 3, 14 + rnd() * 30);
          quad(fx, by, fz, nx, nz, bw, bw / 2, board(), 1.0);
        }
        // LED edge strips up the two front corners, and a band round the top
        if (rnd() < 0.7) {
          const col = pick(STRIP);
          for (const side of [-1, 1]) {
            const s = new BoxGeometry(0.35, hgt, 0.35);
            s.translate(fx + ax * side * (span / 2), hgt / 2, fz + az * side * (span / 2));
            strips.push(tint(s, col));
          }
          const band = new BoxGeometry(faceX ? 0.6 : w + 0.4, 0.5, faceX ? d + 0.4 : 0.6);
          band.translate(fx, hgt - 0.6, fz);
          strips.push(tint(band, col));
        }
      }
    }
    const towerMats = styles.map((t) => new MeshLambertMaterial({ color: 0x10131c, emissiveMap: t, emissive: new Color(1.1, 1.1, 1.1) }));
    buckets.forEach((b, i) => {
      if (b.length) this.add(mergeGeometries(b)!, towerMats[i]!, `towers-${i}`);
    });
    this.add(mergeGeometries(roofs)!, new MeshStandardMaterial({ color: 0x1c2232, metalness: 0.5, roughness: 0.5 }), 'roofs');
    this.add(mergeGeometries(beacons)!, this.beacons, 'beacons');
    this.add(mergeGeometries(signs)!, new MeshBasicMaterial({ map: signAtlas(), toneMapped: false, color: new Color(1.9, 1.9, 1.9), side: DoubleSide }), 'neon-signs');
    this.add(mergeGeometries(strips)!, new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 'led-strips');
  }

  /**
   * The elevated monorail: a closed loop whose near stretch sweeps right over
   * one corner of the arena, lit along both edges with blue dots, on pillars
   * that stop short of the arena, with a four-car train running round it.
   */
  private buildMonorail(): void {
    const pts = [
      [-230, 34, -30],
      [-110, 36, -70],
      [-20, 37, -78],
      [50, 37, -52],
      [110, 36, -40],
      [220, 34, -110],
      [200, 33, -260],
      [40, 33, -300],
      [-140, 33, -250],
      [-260, 33, -150],
    ].map(([x, y, z]) => new Vector3(x, y, z));
    this.track = new CatmullRomCurve3(pts, true, 'centripetal');
    const N = 420;
    const beam: BufferGeometry[] = [sweep(this.track, N, 1.7, 1.1)];
    const lights: BufferGeometry[] = [];
    const pillars: BufferGeometry[] = [];
    const up = new Vector3(0, 1, 0);
    const hx = ARENA.halfX * S + 14;
    const hy = (ARENA.halfY + ARENA.goal.depth) * S + 14;
    const a = new Vector3();
    const b = new Vector3();
    const dir = new Vector3();
    const side = new Vector3();
    const blue = new Color(0.3, 0.9, 3.4);
    for (const s of [-1, 1]) lights.push(tint(sweep(this.track, N, 0.09, 0.15, s * 1.95, -0.5), blue));
    const white = new Color(2.6, 2.8, 3.2);
    let lastPillar = -1e9;
    for (let i = 0; i < N; i += 1) {
      this.track.getPointAt(i / N, a);
      this.track.getPointAt((i + 1) / N, b);
      dir.subVectors(b, a).normalize();
      side.crossVectors(dir, up).normalize();
      // white dots hung under both edges (below the beam, so they share no face with it)
      if (i % 3 === 0)
        for (const s of [-1, 1]) {
          const dot = new BoxGeometry(0.4, 0.4, 0.4);
          dot.translate(a.x + side.x * s * 1.45, a.y - 1.45, a.z + side.z * s * 1.45);
          lights.push(tint(dot, white));
        }
      const s = (i / N) * this.track.getLength();
      const overArena = Math.abs(a.x) < hx && Math.abs(a.z) < hy;
      if (s - lastPillar > 38 && !overArena) {
        lastPillar = s;
        const p = new CylinderGeometry(1.1, 1.5, a.y - 2.5, 8);
        p.translate(a.x, (a.y - 2.5) / 2, a.z);
        pillars.push(flatten(p));
        const cap = new BoxGeometry(4.6, 1.4, 4.6);
        cap.translate(a.x, a.y - 1.95, a.z);
        pillars.push(flatten(cap));
      }
    }
    const metal = new MeshStandardMaterial({ color: 0x3a4152, metalness: 0.7, roughness: 0.35 });
    this.add(mergeGeometries(beam)!, metal, 'monorail-track');
    this.add(mergeGeometries(pillars)!, metal, 'monorail-pillars');
    this.add(mergeGeometries(lights)!, new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 'monorail-lights');
    // the train: four rounded cars with a lit window band
    const [wc, wg] = canvas(64, 16);
    wg.fillStyle = '#1a2030';
    wg.fillRect(0, 0, 64, 16);
    wg.fillStyle = '#bfe8ff';
    for (let x = 2; x < 64; x += 8) wg.fillRect(x, 5, 6, 6);
    const windows = tex(wc, true);
    windows.repeat.set(2, 1);
    const body = new MeshStandardMaterial({ color: 0xdfe4ee, metalness: 0.5, roughness: 0.3, emissiveMap: windows, emissive: new Color(2.2, 2.2, 2.2) });
    const nose = new MeshBasicMaterial({ color: new Color(0.4, 1.2, 3.0), toneMapped: false });
    const carGeo = new BoxGeometry(3, 3.2, 13);
    this.train = [];
    for (let k = 0; k < 4; k += 1) {
      const car = new Group();
      const shell = new Mesh(carGeo, body);
      shell.position.y = 3.0;
      const stripe = new Mesh(new BoxGeometry(3.3, 0.25, 13.3), nose);
      stripe.position.y = 1.7;
      car.add(shell, stripe);
      this.root.add(car);
      this.train.push(car);
    }
  }

  /** Searchlights, the giant ball sculpture, balloons and the big screens behind the goals. */
  private buildLandmarks(): void {
    const hy = (ARENA.halfY + ARENA.goal.depth) * S;
    const hx = ARENA.halfX * S;
    // searchlights on rooftops round the arena
    const beamGeo = new ConeGeometry(14, 320, 20, 1, true);
    beamGeo.translate(0, -160, 0); // tip at the origin, opening along -y ...
    beamGeo.rotateX(Math.PI); // ... then along +y
    const beamMat = beamMaterial();
    const lampMat = new MeshBasicMaterial({ color: new Color(3, 3.2, 3.6), toneMapped: false });
    const spots: [number, number, number][] = [
      [-hx - 40, 70, -hy - 30],
      [hx + 45, 80, -hy - 20],
      [-hx - 55, 85, hy + 25],
      [hx + 40, 65, hy + 40],
      [-hx - 70, 95, 0],
      [hx + 75, 90, 10],
    ];
    spots.forEach(([x, y, z], i) => {
      const pivot = new Object3D();
      pivot.position.set(x, y, z);
      const cone = new Mesh(beamGeo, beamMat);
      cone.frustumCulled = false;
      const lamp = new Mesh(new CylinderGeometry(1.4, 1.8, 1.2, 10), lampMat);
      pivot.add(cone, lamp);
      this.root.add(pivot);
      this.beams.push({ pivot, phase: i * 1.7, speed: 0.18 + (i % 3) * 0.06, tilt: 0.35 + (i % 2) * 0.15 });
    });
    // the giant ball on a rooftop beside the pitch, on a lit pedestal
    const bx = hx + BALL_TOWER[0];
    const bz = BALL_TOWER[1];
    const tower = facade(34, 58, 34);
    tower.translate(bx, 29, bz);
    this.add(tower, new MeshLambertMaterial({ color: 0x10131c, emissiveMap: windowStyle(1), emissive: new Color(1.7, 1.7, 1.7) }), 'ball-tower');
    const pedestal = new CylinderGeometry(9, 11, 4, 24);
    pedestal.translate(bx, 60, bz);
    this.add(pedestal, new MeshStandardMaterial({ color: 0x2a3040, metalness: 0.7, roughness: 0.3 }), 'ball-pedestal');
    const ring = new CylinderGeometry(11.1, 11.1, 0.5, 32, 1, true);
    ring.translate(bx, 61.8, bz);
    this.add(ring, new MeshBasicMaterial({ color: new Color(3.2, 1.4, 0.3), toneMapped: false, side: DoubleSide }), 'ball-ring');
    const bt = ballTexture();
    bt.repeat.set(2, 2);
    this.ball = new Mesh(
      new SphereGeometry(15, 40, 24),
      new MeshStandardMaterial({ color: 0x3a3e48, metalness: 0.75, roughness: 0.3, emissiveMap: bt, emissive: new Color(2.4, 2.4, 2.4) }),
    );
    this.ball.position.set(bx, 77, bz);
    this.root.add(this.ball);
    // balloons drifting over the city
    const bal = new SphereGeometry(1, 16, 12);
    bal.scale(1, 1.15, 1);
    const [sc, sg] = canvas(64, 64);
    sg.fillStyle = '#ffffff';
    sg.fillRect(0, 0, 64, 64);
    sg.fillStyle = '#a0a0a0';
    for (let x = 0; x < 64; x += 16) sg.fillRect(x, 0, 8, 64);
    const stripes = tex(sc);
    this.balloons = new InstancedMesh(bal, new MeshBasicMaterial({ map: stripes, toneMapped: false }), 9);
    const c = new Color();
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2 + rnd() * 0.4;
      const r = 90 + rnd() * 160;
      this.balloonSpots.push({ x: Math.cos(a) * r, y: 60 + rnd() * 45, z: Math.sin(a) * r, s: 3 + rnd() * 2.5, p: rnd() * 6 });
      this.balloons.setColorAt(i, c.set(pick(NEON)).multiplyScalar(1.2));
    }
    this.balloons.frustumCulled = false;
    this.root.add(this.balloons);
    // big screens mounted on their own office blocks behind each goal (the grid keeps clear of them)
    const office = new MeshLambertMaterial({ color: 0x10131c, emissiveMap: windowStyle(2), emissive: new Color(1.1, 1.1, 1.1) });
    for (const sz of [1, -1]) {
      const z = sz * (hy + SCREEN_Z);
      const block = facade(46, 66, 22);
      block.translate(0, 33, z + sz * 12.6);
      this.add(block, office, 'screen-block');
      const [c2, ctx] = canvas(512, 208);
      const t = tex(c2);
      const screen = new Mesh(new PlaneGeometry(34, 13.8), new MeshBasicMaterial({ map: t, toneMapped: false, color: new Color(1.3, 1.3, 1.3) }));
      screen.position.set(0, 52, z - sz * 0.8);
      screen.rotation.y = sz > 0 ? Math.PI : 0;
      const housing = new Mesh(new BoxGeometry(36, 15.6, 1.2), new MeshStandardMaterial({ color: 0x14182a, metalness: 0.4, roughness: 0.5 }));
      housing.position.set(0, 52, z);
      this.root.add(housing, screen);
      this.screens.push({ tex: t, ctx });
    }
    this.setScoreboard(0, 0, '5:00');
  }

  setScoreboard(blue: number, orange: number, clock: string): void {
    const key = `${blue}|${orange}|${clock}`;
    if (key === this.screenKey) return;
    this.screenKey = key;
    for (const { tex: t, ctx: g } of this.screens) {
      g.fillStyle = '#05070f';
      g.fillRect(0, 0, 512, 208);
      g.fillStyle = '#1d52c8';
      g.fillRect(14, 40, 150, 128);
      g.fillStyle = '#d75f08';
      g.fillRect(348, 40, 150, 128);
      g.fillStyle = '#ffffff';
      g.font = '500 92px "Orbitron", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(blue), 89, 108);
      g.fillText(String(orange), 423, 108);
      g.font = '500 54px "Orbitron", sans-serif';
      g.fillText(clock, 256, 108);
      g.font = '700 22px "Titillium Web", sans-serif';
      g.fillStyle = '#7fd0ff';
      g.fillText('NEON PARK', 256, 24);
      t.needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.t += dt;
    this.skyMat.uniforms['uTime']!.value = this.t;
    const on = Math.sin(this.t * 2.2) > 0.2;
    this.beacons.color.setRGB(on ? 4 : 0.6, on ? 0.3 : 0.05, on ? 0.3 : 0.05);
    for (let i = 0; i < this.lanes.length; i += 1) {
      const l = this.lanes[i]!;
      const a = l.phase + this.t * l.speed * l.dir;
      this.dummy.position.set(Math.cos(a) * l.r, l.h + Math.sin(this.t * 0.5 + i) * 1.5, Math.sin(a) * l.r);
      this.dummy.rotation.set(0, -a + (l.dir > 0 ? 0 : Math.PI), 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.traffic.setMatrixAt(i, this.dummy.matrix);
    }
    this.traffic.instanceMatrix.needsUpdate = true;
    // searchlights sweep in slow figure-eights
    for (const b of this.beams) {
      const a = this.t * b.speed + b.phase;
      b.pivot.rotation.set(Math.sin(a) * b.tilt, 0, Math.cos(a * 0.7) * b.tilt);
    }
    // the train runs round the loop
    const L = this.track.getLength();
    const u0 = (this.t * 14) / L;
    const p = new Vector3();
    const look = new Vector3();
    this.train.forEach((car, k) => {
      const u = (((u0 - (k * 13.6) / L) % 1) + 1) % 1;
      this.track.getPointAt(u, p);
      this.track.getPointAt((u + 0.002) % 1, look);
      car.position.copy(p);
      car.lookAt(look);
    });
    this.ball.rotation.y = this.t * 0.25;
    this.balloonSpots.forEach((s, i) => {
      this.dummy.position.set(s.x + Math.sin(this.t * 0.05 + s.p) * 6, s.y + Math.sin(this.t * 0.4 + s.p) * 1.5, s.z);
      this.dummy.rotation.set(0, this.t * 0.1 + s.p, 0);
      this.dummy.scale.setScalar(s.s);
      this.dummy.updateMatrix();
      this.balloons.setMatrixAt(i, this.dummy.matrix);
    });
    this.dummy.scale.setScalar(1);
    this.balloons.instanceMatrix.needsUpdate = true;
  }
}
