import {
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
  IcosahedronGeometry,
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
  TubeGeometry,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Seeded random, so the stadium is the same on every machine. */
let seed = 4242;
const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;

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

/** One party balloon (a slightly tall sphere); instanced everywhere balloons are used. */
export const balloonGeometry = (): BufferGeometry => new SphereGeometry(1, 8, 6).scale(1, 1.18, 1);

/** Balloons are glossy latex: a lit standard material, coloured per instance. */
export const balloonMaterial = (): MeshStandardMaterial => new MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.05, envMapIntensity: 0.8 });

/** Pitch-side advertising boards (two designs side by side; the strip repeats). */
export const adBoardTexture = (): CanvasTexture => {
  const [c, g] = canvas(1024, 64);
  const boards: [string, string, string][] = [
    ['GRAND PRIX PARK', '#0d1a3c', '#ff8a1f'],
    ['BLOXITY', '#101418', '#2f7bff'],
  ];
  boards.forEach(([text, bg, accent], i) => {
    const x = i * 512;
    g.fillStyle = bg;
    g.fillRect(x, 0, 512, 64);
    g.fillStyle = accent;
    g.beginPath();
    g.arc(x + 46, 32, 20, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x + 46, 32, 9, 0, Math.PI * 2);
    g.fill();
    g.font = '900 italic 34px "Titillium Web", sans-serif';
    g.textBaseline = 'middle';
    g.fillText(text, x + 82, 34);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(x + 508, 0, 4, 64);
  });
  return tex(c, true);
};

/** Seats with a packed crowd: rows of colourful dots over blue seating. */
const crowdTexture = (): CanvasTexture => {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#34506f';
  g.fillRect(0, 0, 256, 256);
  const shirts = ['#ffffff', '#ff8a1f', '#2f7bff', '#e8e04a', '#e04848', '#48c060', '#202020', '#a070e0', '#ffb0c8', '#60d0ff'];
  const skin = ['#f2d0b0', '#d8a880', '#a87850', '#704830'];
  for (let row = 0; row < 16; row += 1) {
    const y = row * 16;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, y + 13, 256, 3);
    for (let x = 2; x < 256; x += 7) {
      if (rnd() < 0.12) continue;
      const px = x + (rnd() - 0.5) * 2;
      g.fillStyle = pick(shirts);
      g.fillRect(px, y + 6, 5, 7);
      g.fillStyle = pick(skin);
      g.beginPath();
      g.arc(px + 2.5, y + 4, 2.3, 0, Math.PI * 2);
      g.fill();
    }
  }
  return tex(c, true);
};

/** Pale glass curtain wall: mullions and floor lines over sky-blue glass. */
const glassTexture = (): CanvasTexture => {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#5b8fcf';
  g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 8) {
    g.fillStyle = rnd() < 0.5 ? '#eaf4ff' : '#c4dcf4';
    g.fillRect(x, 0, 2, 128);
  }
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let y = 0; y < 128; y += 6) g.fillRect(0, y, 128, 1);
  return tex(c, true);
};

/** Checkered race banner (orange board, black/white checks, a white stripe). */
const checkerTexture = (): CanvasTexture => {
  const [c, g] = canvas(64, 256);
  g.fillStyle = '#ff7a1a';
  g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 13; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      g.fillStyle = (x + y) % 2 ? '#111111' : '#ffffff';
      g.fillRect(6 + x * 13, 8 + y * 13, 13, 13);
    }
  }
  g.fillStyle = '#ffffff';
  g.fillRect(6, 190, 52, 6);
  g.beginPath();
  g.arc(32, 222, 14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ff7a1a';
  g.beginPath();
  g.arc(32, 222, 7, 0, Math.PI * 2);
  g.fill();
  return tex(c);
};

/** Box with UVs scaled to metres / `unit`, so the pattern keeps one size on every face. */
const scaledBox = (w: number, h: number, d: number, unit: number): BufferGeometry => {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const n = g.getAttribute('normal');
  for (let i = 0; i < uv.count; i += 1) {
    if (Math.abs(n.getY(i)) > 0.5) {
      uv.setXY(i, 0.01, 0.01);
      continue;
    }
    const across = Math.abs(n.getX(i)) > 0.5 ? d : w;
    uv.setXY(i, (uv.getX(i) * across) / unit, (uv.getY(i) * h) / unit);
  }
  return flatten(g);
};

// The bowl follows a rounded rectangle round the arena (three.js metres, x across, z along).
const AX = 52;
const AZ = 72;
const RC = 24;

/** Points of the bowl's plan outline offset outwards by d (same count for every d, CCW). */
const outline = (d: number): [number, number][] => {
  const pts: [number, number][] = [];
  const corners: [number, number][] = [
    [AX - RC, AZ - RC],
    [-(AX - RC), AZ - RC],
    [-(AX - RC), -(AZ - RC)],
    [AX - RC, -(AZ - RC)],
  ];
  corners.forEach(([cx, cz], k) => {
    for (let i = 0; i <= 10; i += 1) {
      const a = (k + i / 10) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * (RC + d), cz + Math.sin(a) * (RC + d)]);
    }
    // the straight side after this corner, subdivided so long faces still shade and texture well
    const [nx, nz] = corners[(k + 1) % 4]!;
    const a = (k + 1) * (Math.PI / 2);
    for (let s = 1; s < 6; s += 1) {
      const t = s / 6;
      pts.push([cx + (nx - cx) * t + Math.cos(a) * (RC + d), cz + (nz - cz) * t + Math.sin(a) * (RC + d)]);
    }
  });
  return pts;
};

/** A band of the bowl lofted along the outline through a cross-section of [d, y] points. */
const loft = (profile: [number, number][], uUnit: number, vUnit: number): BufferGeometry => {
  const base = outline(0);
  const arc = [0];
  for (let i = 1; i <= base.length; i += 1) {
    const a = base[i - 1]!;
    const b = base[i % base.length]!;
    arc.push(arc[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const prof = [0];
  for (let k = 1; k < profile.length; k += 1) prof.push(prof[k - 1]! + Math.hypot(profile[k]![0] - profile[k - 1]![0], profile[k]![1] - profile[k - 1]![1]));
  const rings = profile.map(([d]) => outline(d));
  const pos: number[] = [];
  const uv: number[] = [];
  const n = base.length;
  for (let k = 0; k + 1 < profile.length; k += 1) {
    const y0 = profile[k]![1];
    const y1 = profile[k + 1]![1];
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const a0 = rings[k]![i]!;
      const a1 = rings[k]![j]!;
      const b0 = rings[k + 1]![i]!;
      const b1 = rings[k + 1]![j]!;
      const u0 = arc[i]! / uUnit;
      const u1 = arc[i + 1]! / uUnit;
      const v0 = prof[k]! / vUnit;
      const v1 = prof[k + 1]! / vUnit;
      const quad: [number[], number, number][] = [
        [[a0[0], y0, a0[1]], u0, v0],
        [[b0[0], y1, b0[1]], u0, v1],
        [[a1[0], y0, a1[1]], u1, v0],
        [[a1[0], y0, a1[1]], u1, v0],
        [[b0[0], y1, b0[1]], u0, v1],
        [[b1[0], y1, b1[1]], u1, v1],
      ];
      for (const [p, u, v] of quad) {
        pos.push(p[0]!, p[1]!, p[2]!);
        uv.push(u, v);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
};

/**
 * THE STADIUM around Grand Prix Park, after Rocket League's sunny race-day
 * fields: a full bowl of stands packed with a painted crowd, a glass canopy on
 * white ribs, two giant white arches over the long sides, bunting strung
 * round the canopy edge, checkered race towers and balloon columns at the
 * pitch side, trees, a ring of pale glass skyscrapers and a summer sky with
 * drifting clouds. Same API as the neon City: root, setScoreboard, update.
 */
export class Stadium {
  readonly root = new Group();
  private readonly skyMat: ShaderMaterial;
  private readonly dummy = new Object3D();
  private screens: { tex: CanvasTexture; ctx: CanvasRenderingContext2D }[] = [];
  private screenKey = '';
  private t = 0;

  constructor() {
    seed = 4242;
    this.skyMat = this.buildSky();
    this.buildGround();
    this.buildBowl();
    this.buildPitchside();
    this.buildSkyline();
    this.setScoreboard(0, 0, '5:00');
  }

  private add(g: BufferGeometry, m: Material, name: string): Mesh {
    const mesh = new Mesh(g, m);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.root.add(mesh);
    return mesh;
  }

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
          vec3 c = mix(vec3(0.42,0.66,0.93), vec3(0.02,0.17,0.62), pow(smoothstep(0.0, 1.0, h), 0.5));
          c = mix(c, vec3(0.45,0.52,0.48), smoothstep(0.0, -0.12, h));
          float sd = max(dot(d, normalize(vec3(0.48, 0.83, -0.31))), 0.0);
          c += vec3(1.0,0.92,0.75) * (pow(sd, 900.0) * 6.0 + pow(sd, 10.0) * 0.22);
          vec2 p = d.xz / max(h, 0.05) * 0.7 + vec2(uTime * 0.004, uTime * 0.0015);
          // fair-weather clouds low on the horizon only; a clear deep-blue zenith (the reference)
          float cl = smoothstep(0.56, 0.88, fbm(p)) * smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.22, 0.5, h));
          c = mix(c, vec3(1.0, 1.0, 1.02), cl * 0.8);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new Mesh(new SphereGeometry(1600, 32, 16), mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.root.add(sky);
    return mat;
  }

  private buildGround(): void {
    const grass = new PlaneGeometry(3200, 3200);
    grass.rotateX(-Math.PI / 2);
    grass.translate(0, -0.12, 0);
    this.add(grass, new MeshLambertMaterial({ color: 0x4f7d3a }), 'grass');
    // a concrete apron inside the bowl
    const apron = new PlaneGeometry(2 * AX + 4, 2 * AZ + 4);
    apron.rotateX(-Math.PI / 2);
    apron.translate(0, -0.06, 0);
    this.add(apron, new MeshLambertMaterial({ color: 0x8a8f96 }), 'apron');
  }

  private buildBowl(): void {
    const concrete = new MeshStandardMaterial({ color: 0xd4d8de, roughness: 0.75, metalness: 0.05, side: DoubleSide });
    const crowd = new MeshLambertMaterial({ map: crowdTexture(), side: DoubleSide });
    const boards = adBoardTexture();
    // front parapet with boards, lower tier, concourse, upper tier, back wall
    this.add(loft([[0, 0], [0, 2.6]], 16, 2.6), new MeshBasicMaterial({ map: boards, side: DoubleSide }), 'stand-boards');
    this.add(loft([[0, 2.6], [17, 13.5]], 13, 13), crowd, 'stand-lower');
    this.add(loft([[17, 13.5], [18.5, 13.5], [18.5, 16.5]], 20, 20), concrete, 'concourse');
    this.add(loft([[18.5, 16.5], [33, 29]], 13, 13), crowd, 'stand-upper');
    this.add(loft([[33, 29], [34, 33], [36, 33], [36, 0]], 20, 20), concrete, 'stand-back');
    // the glass canopy over the upper tier, on white ribs and back columns
    this.add(loft([[19, 38], [39, 35]], 20, 20), new MeshStandardMaterial({ color: 0x3f6fae, transparent: true, opacity: 0.55, roughness: 0.12, metalness: 0.6, side: DoubleSide, depthWrite: false }), 'canopy');
    const ribs: BufferGeometry[] = [];
    const inner = outline(19);
    const outer = outline(39);
    for (let i = 0; i < inner.length; i += 2) {
      const a = new Vector3(inner[i]![0], 38.4, inner[i]![1]);
      const b = new Vector3(outer[i]![0], 35.4, outer[i]![1]);
      const len = a.distanceTo(b);
      const rib = new BoxGeometry(0.6, 0.9, len);
      rib.lookAt(b.clone().sub(a));
      rib.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      ribs.push(flatten(rib));
      const col = new CylinderGeometry(0.5, 0.7, 35, 6);
      col.translate(b.x, 17.5, b.z);
      ribs.push(flatten(col));
    }
    // front edge beam of the canopy
    for (let i = 0; i < inner.length; i += 1) {
      const a = inner[i]!;
      const b = inner[(i + 1) % inner.length]!;
      const p = new Vector3(a[0], 38.4, a[1]);
      const q = new Vector3(b[0], 38.4, b[1]);
      const beam = new BoxGeometry(0.9, 1.2, p.distanceTo(q) + 0.4);
      beam.lookAt(q.clone().sub(p));
      beam.translate((p.x + q.x) / 2, 38.4, (p.z + q.z) / 2);
      ribs.push(flatten(beam));
    }
    // two giant arches over the long sides
    for (const sx of [-1, 1]) {
      const curve = new CatmullRomCurve3([
        new Vector3(sx * (AX + 30), 0, -(AZ + 20)),
        new Vector3(sx * (AX + 26), 40, -(AZ - 10)),
        new Vector3(sx * (AX + 22), 62, 0),
        new Vector3(sx * (AX + 26), 40, AZ - 10),
        new Vector3(sx * (AX + 30), 0, AZ + 20),
      ]);
      ribs.push(flatten(new TubeGeometry(curve, 60, 1.5, 8, false)));
    }
    this.add(mergeGeometries(ribs)!, new MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.35, metalness: 0.4 }), 'canopy-ribs');
    // bunting: festoons of little flags along the canopy edge
    const flags: { x: number; y: number; z: number; ry: number }[] = [];
    for (let i = 0; i < inner.length; i += 2) {
      const a = inner[i]!;
      const b = inner[(i + 2) % inner.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(2, Math.floor(len / 0.9));
      for (let k = 0; k < n; k += 1) {
        const t = k / n;
        flags.push({ x: a[0] + (b[0] - a[0]) * t, y: 37.6 - Math.sin(t * Math.PI) * 3.2, z: a[1] + (b[1] - a[1]) * t, ry: Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2 });
      }
    }
    const flagGeo = new BufferGeometry();
    flagGeo.setAttribute('position', new Float32BufferAttribute([-0.35, 0, 0, 0.35, 0, 0, 0, -0.7, 0], 3));
    flagGeo.computeVertexNormals();
    const bunting = new InstancedMesh(flagGeo, new MeshLambertMaterial({ side: DoubleSide }), flags.length);
    const c = new Color();
    const FLAG = ['#e83030', '#ffffff', '#2f7bff', '#ffd030', '#30b050', '#ff8a1f'];
    flags.forEach((f, i) => {
      this.dummy.position.set(f.x, f.y, f.z);
      this.dummy.rotation.set(0, f.ry, 0);
      this.dummy.updateMatrix();
      bunting.setMatrixAt(i, this.dummy.matrix);
      bunting.setColorAt(i, c.set(FLAG[i % FLAG.length]!));
    });
    this.root.add(bunting);
    // big screens on the back of the bowl behind each goal
    for (const sz of [1, -1]) {
      const z = sz * (AZ + 30);
      const [c2, ctx] = canvas(512, 208);
      const t = tex(c2);
      const screen = new Mesh(new PlaneGeometry(26, 10.6), new MeshBasicMaterial({ map: t, toneMapped: false, color: new Color(1.1, 1.1, 1.1) }));
      screen.position.set(0, 46, z - sz * 0.7);
      screen.rotation.y = sz > 0 ? Math.PI : 0;
      const housing = new Mesh(new BoxGeometry(28, 12.4, 1.2), new MeshStandardMaterial({ color: 0x1c2230, metalness: 0.4, roughness: 0.5 }));
      housing.position.set(0, 46, z);
      const post = new Mesh(new BoxGeometry(2, 40, 2), housing.material);
      post.position.set(0, 20, z + sz * 1.5);
      this.root.add(housing, screen, post);
      this.screens.push({ tex: t, ctx });
    }
  }

  /** Race-day dressing at the foot of the stands: checkered towers, balloon columns, tents. */
  private buildPitchside(): void {
    const towers: BufferGeometry[] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (const k of [0, 1]) {
          const g = new BoxGeometry(3.6, k ? 12 : 17, 0.5);
          g.rotateY(Math.atan2(-sx, -sz));
          g.translate(sx * (AX - 6 - k * 7), k ? 6 : 8.5, sz * (AZ - 14 + k * 6));
          towers.push(flatten(g));
        }
    this.add(mergeGeometries(towers)!, new MeshLambertMaterial({ map: checkerTexture() }), 'checker-towers');
    // balloon columns: spirals of team colour and white
    const spots: [number, number, string][] = [];
    for (const sx of [-1, 1]) for (const z of [-48, -16, 16, 48]) spots.push([sx * (AX - 3), z, z < 0 ? '#2f7bff' : '#ff8a1f']);
    const per = 44;
    const balloons = new InstancedMesh(balloonGeometry(), balloonMaterial(), spots.length * per);
    const c = new Color();
    let n = 0;
    for (const [x, z, team] of spots) {
      for (let k = 0; k < per; k += 1) {
        const a = k * 2.2;
        this.dummy.position.set(x + Math.cos(a) * 0.9, 0.6 + k * 0.24, z + Math.sin(a) * 0.9);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(0.62);
        this.dummy.updateMatrix();
        balloons.setMatrixAt(n, this.dummy.matrix);
        balloons.setColorAt(n, c.set(Math.floor(k / 2) % 2 ? '#ffffff' : team));
        n += 1;
      }
    }
    this.dummy.scale.setScalar(1);
    this.root.add(balloons);
    // marquee tents at the corners
    const tents: BufferGeometry[] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const roof = new ConeGeometry(4.2, 3, 4);
        roof.rotateY(Math.PI / 4);
        roof.translate(sx * (AX - 12), 4.5, sz * (AZ - 4));
        tents.push(flatten(roof));
      }
    this.add(mergeGeometries(tents)!, new MeshLambertMaterial({ color: 0xe04a3a }), 'tents');
  }

  /** Pale glass towers beyond the stadium, trees round it. */
  private buildSkyline(): void {
    const glass: BufferGeometry[] = [];
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * Math.PI * 2 + rnd() * 0.12;
      const r = 230 + rnd() * 300;
      const h = 110 + rnd() * 170;
      const w = 26 + rnd() * 22;
      const g = rnd() < 0.3 ? new CylinderGeometry(w / 2, w / 2, h, 16) : scaledBox(w, h, w * (0.7 + rnd() * 0.5), 12);
      if (g.type === 'CylinderGeometry') {
        const uv = g.getAttribute('uv');
        for (let k = 0; k < uv.count; k += 1) uv.setXY(k, (uv.getX(k) * Math.PI * w) / 12, (uv.getY(k) * h) / 12);
      }
      g.rotateY(rnd() * Math.PI);
      g.translate(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      glass.push(flatten(g));
    }
    const gt = glassTexture();
    this.add(mergeGeometries(glass)!, new MeshStandardMaterial({ map: gt, color: 0xc9e0ff, metalness: 0.75, roughness: 0.14, envMapIntensity: 1.3 }), 'glass-towers');
    // trees: blobs of green on short trunks
    const crowns = new InstancedMesh(new IcosahedronGeometry(1, 1), new MeshLambertMaterial({ color: 0xffffff }), 150);
    const trunks = new InstancedMesh(new CylinderGeometry(0.25, 0.35, 1, 5).translate(0, 0.5, 0), new MeshLambertMaterial({ color: 0x5a4030 }), 150);
    const c = new Color();
    for (let i = 0; i < 150; i += 1) {
      const a = rnd() * Math.PI * 2;
      const r = 120 + rnd() * 90;
      const x = Math.cos(a) * r * 0.9;
      const z = Math.sin(a) * r * 1.1;
      const s = 3 + rnd() * 3;
      this.dummy.position.set(x, 0, z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, s * 0.8, 1);
      this.dummy.updateMatrix();
      trunks.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.set(x, s * 0.8 + s * 0.7, z);
      this.dummy.scale.set(s, s * 1.15, s);
      this.dummy.updateMatrix();
      crowns.setMatrixAt(i, this.dummy.matrix);
      crowns.setColorAt(i, c.setRGB(0.16 + rnd() * 0.08, 0.36 + rnd() * 0.14, 0.12 + rnd() * 0.06));
    }
    this.dummy.scale.setScalar(1);
    this.root.add(trunks, crowns);
  }

  /** Draw anything on the two big screens (the lobby uses them for its headline). */
  drawScreens(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.screenKey = '';
    for (const { tex: t, ctx } of this.screens) {
      draw(ctx, 512, 208);
      t.needsUpdate = true;
    }
  }

  setScoreboard(blue: number, orange: number, clock: string): void {
    const key = `${blue}|${orange}|${clock}`;
    if (key === this.screenKey) return;
    this.screenKey = key;
    for (const { tex: t, ctx: g } of this.screens) {
      g.fillStyle = '#0a0f1c';
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
      g.fillStyle = '#ffc07a';
      g.fillText('GRAND PRIX PARK', 256, 24);
      t.needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.t += dt;
    this.skyMat.uniforms['uTime']!.value = this.t;
  }
}
