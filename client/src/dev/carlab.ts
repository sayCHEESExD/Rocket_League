/**
 * DEV ONLY - the car lab (`/carlab.html`, never in the build). One car, large,
 * from four angles at once (the reference 3/4 front, side, front, rear 3/4) in
 * a studio, with the game's renderer settings - for modelling the bodies against
 * the user's reference images. Renders on a timer (works in a hidden tab).
 *   #car=0..4  &rider=0|1  &view=sheet|ref|side|front|rear|top  &bg=studio|day|neon
 */
import { DEFAULT_APPEARANCE, DEFAULT_PROPORTIONS } from '@rlb/shared';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  BoxGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { CarView, Wheels } from '../world/CarView.js';
import { CAR_MODELS, GROUND } from '../world/cars/CarModels.js';
import { dayEnvironment, neonEnvironment } from '../world/Environment.js';
import { HemisphereLight } from 'three';
import { LOOKS } from '../world/Themes.js';
import { setCarEnvironment } from '../world/cars/CarModels.js';
import { playerModelLoader } from '../player/PlayerModelLoader.js';

await playerModelLoader.load();

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

/** A photo studio: dark blue dome, big soft boxes above and to the sides. */
const studioEnvironment = (): Texture => {
  const s = new Scene();
  s.add(new Mesh(new SphereGeometry(50, 32, 16), new MeshBasicMaterial({ color: 0x0d1a44, side: BackSide })));
  const box = (w: number, h: number, x: number, y: number, z: number, k: number, col = 0xffffff): void => {
    const m = new Mesh(new BoxGeometry(w, h, 0.5), new MeshBasicMaterial({ color: new Color(col).multiplyScalar(k) }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  box(30, 10, 0, 30, 0, 3);
  box(10, 20, 30, 8, 10, 1.4);
  box(10, 20, -30, 8, -10, 1.0, 0xbfd8ff);
  box(40, 3, 0, 4, -35, 1.3);
  box(40, 3, 0, 4, 35, 0.8, 0x6fa8ff);
  const p = new PMREMGenerator(renderer);
  const t = p.fromScene(s, 0.02).texture;
  p.dispose();
  return t;
};

const envs: Record<string, Texture> = {};
const scene = new Scene();
scene.add(new AmbientLight(0xbfd4ff, 0.5));
const key = new DirectionalLight(0xffffff, 3.2);
key.position.set(3, 6, 2.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
for (const k of ['left', 'bottom'] as const) key.shadow.camera[k] = -3;
for (const k of ['right', 'top'] as const) key.shadow.camera[k] = 3;
key.shadow.bias = -0.0003;
const rim = new DirectionalLight(0x8fc4ff, 1.4);
rim.position.set(-4, 2.5, -3);
const hemi = new HemisphereLight(0xffffff, 0x444444, 1);
scene.add(key, rim, hemi);
const floor = new Mesh(new CircleGeometry(12, 64), new MeshStandardMaterial({ color: 0x1a2456, metalness: 0.2, roughness: 0.55 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = GROUND - 0.001;
floor.receiveShadow = true;
scene.add(floor);

const wheels = new Wheels(scene as never, 4);
let car: CarView | null = null;
let carId = -1;
const params = (): URLSearchParams => new URLSearchParams(location.hash.slice(1));

const setup = (): void => {
  const p = params();
  const id = Math.max(0, Math.min(CAR_MODELS.length - 1, Number(p.get('car') ?? 0)));
  if (id !== carId) {
    car?.dispose();
    car = new CarView(0, id, true);
    car.showName = false;
    car.setLook(DEFAULT_APPEARANCE, DEFAULT_PROPORTIONS);
    scene.add(car.root);
    carId = id;
  }
  car!.rider.root.visible = p.get('rider') === '1';
  const bg = p.get('bg') ?? 'studio';
  envs[bg] ??= bg === 'day' ? dayEnvironment(renderer) : bg === 'neon' ? neonEnvironment(renderer) : studioEnvironment();
  scene.environment = envs[bg]!;
  scene.background = new Color(bg === 'day' ? 0x8ec3f0 : bg === 'neon' ? 0x070914 : 0x0f1d4e);
  // day / neon: the arena's own lights, exposure and car reflection strength
  const look = bg === 'day' ? LOOKS.day : bg === 'neon' ? LOOKS.neon : null;
  hemi.visible = !!look;
  if (look) {
    hemi.color.set(look.hemi[0]);
    hemi.groundColor.set(look.hemi[1]);
    hemi.intensity = look.hemi[2];
    key.color.set(look.sun[0]);
    key.intensity = look.sun[1];
    key.position.set(look.sun[2], look.sun[3], look.sun[4]).normalize().multiplyScalar(6);
    renderer.toneMappingExposure = look.exposure;
    setCarEnvironment(look.carEnv, look.carShade);
    rim.visible = false;
  } else {
    key.color.set(0xffffff);
    key.intensity = 3.2;
    key.position.set(3, 6, 2.5);
    renderer.toneMappingExposure = 1;
    setCarEnvironment(1);
    rim.visible = true;
  }
  (document.getElementById('label') as HTMLElement).textContent = `${CAR_MODELS[id]!.name}  #car=${id}`;
};
window.addEventListener('hashchange', setup);
setup();

/** Camera views, car-local (three: +X forward, +Y up, +Z right), metres. */
const VIEWS: Record<string, { pos: [number, number, number]; at: [number, number, number]; fov: number }> = {
  ref: { pos: [2.55, 0.95, -1.95], at: [0.04, 0.06, 0], fov: 25 },
  ref2: { pos: [2.7, 0.55, -1.6], at: [0.1, 0.0, 0], fov: 22 },
  side: { pos: [0.1, 0.18, -3.9], at: [0.1, 0.03, 0], fov: 25 },
  front: { pos: [3.9, 0.3, 0], at: [0, 0.05, 0], fov: 22 },
  rear: { pos: [-2.5, 0.85, 1.9], at: [0, 0.05, 0], fov: 30 },
  top: { pos: [0.1, 4.2, 0.001], at: [0.1, 0, 0], fov: 28 },
  chase: { pos: [-3.0, 0.75, 0], at: [0.6, 0.15, 0], fov: 34 },
};
const cam = new PerspectiveCamera(30, 1, 0.05, 100);
const look = new Vector3();

const draw = (): void => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (!car) return;
  wheels.begin();
  car.update(0, 0, 0, false, true, wheels, { steer: 0, lateral: 0, surge: 0, boosting: false, airborne: false, look: 0, cheer: 0, emote: '', emoteTime: 0 }, params().get('lod') === '1' ? 30 : 3);
  wheels.end();
  const view = params().get('view') ?? 'sheet';
  const cells = view === 'sheet' ? ['ref', 'side', 'front', 'rear'] : [view];
  const cols = cells.length > 1 ? 2 : 1;
  const rows = Math.ceil(cells.length / cols);
  const cw = Math.floor(w / cols);
  const ch = Math.floor(h / rows);
  renderer.setScissorTest(true);
  cells.forEach((name, i) => {
    const v = VIEWS[name] ?? VIEWS['ref']!;
    const x = (i % cols) * cw;
    const y = h - (Math.floor(i / cols) + 1) * ch;
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    cam.aspect = cw / ch;
    cam.fov = v.fov * (cam.aspect < 1.4 ? 1.4 / cam.aspect : 1);
    cam.position.set(...v.pos);
    cam.lookAt(look.set(...v.at));
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
  });
  renderer.setScissorTest(false);
};
setInterval(draw, 100);
(window as unknown as { lab: unknown }).lab = { scene, renderer, get car() { return car; }, VIEWS, draw };
