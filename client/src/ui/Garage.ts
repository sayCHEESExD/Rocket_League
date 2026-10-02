import { CAR_COUNT, type AvatarAppearance, type AvatarProportions } from '@rlb/shared';
import {
  AmbientLight,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  RingGeometry,
  Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { CAR_MODELS } from '../world/cars/CarModels.js';
import { CarView, Wheels } from '../world/CarView.js';

const KEY = 'rl.car';

export const savedCar = (): number => {
  try {
    const v = Number(window.localStorage.getItem(KEY));
    return Number.isInteger(v) && v >= 0 && v < CAR_COUNT ? v : 1;
  } catch {
    return 1;
  }
};

const saveCar = (v: number): void => {
  try {
    window.localStorage.setItem(KEY, String(v));
  } catch {
    /* private mode: the choice lasts this session only */
  }
};

const CSS = `
.garage{position:fixed;inset:0;z-index:30;display:none;pointer-events:none;font-family:"Titillium Web","Fredoka",sans-serif;color:#fff}
.garage.on{display:block}
.garage .top{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 18px);text-align:center;font-weight:900;font-style:italic;letter-spacing:.3em;font-size:18px;opacity:.85}
.garage .name{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 132px);text-align:center;font-weight:900;font-style:italic;font-size:46px;letter-spacing:.06em;text-shadow:0 4px 18px rgba(0,0,0,.6)}
.garage .tag{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 106px);text-align:center;font-weight:700;font-size:15px;opacity:.85}
.garage .note{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);text-align:center;font-size:12px;opacity:.6}
.garage .row{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 44px);display:flex;gap:10px;pointer-events:auto}
.garage button{all:unset;cursor:pointer;padding:10px 18px;border-radius:6px;background:rgba(14,20,40,.82);border:1px solid rgba(255,255,255,.25);font-weight:900;letter-spacing:.12em;font-size:14px}
.garage button:hover{background:rgba(47,123,255,.7)}
.garage button.go{background:linear-gradient(180deg,#3cd66b,#169a45);border-color:#9effc0}
.garage button.on{background:rgba(255,255,255,.22)}
.garage .arrow{position:absolute;top:44%;pointer-events:auto;font-size:44px;padding:6px 18px;border-radius:50%}
.garage .l{left:calc(env(safe-area-inset-left,0px) + 4%)}
.garage .r{right:calc(env(safe-area-inset-right,0px) + 4%)}
.garage .dots{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 190px);display:flex;justify-content:center;gap:8px}
.garage .dots i{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.3)}
.garage .dots i.on{background:#fff}
@media (max-height:520px){.garage .name{font-size:30px;bottom:96px}.garage .tag{bottom:76px;font-size:12px}.garage .dots{bottom:134px}.garage .row{bottom:30px}.garage button{padding:7px 12px;font-size:12px}}
`;

/**
 * THE GARAGE: a showroom scene (turntable, studio lights, the car in its
 * own colours, which it keeps on both teams - with your own avatar at the wheel). Browse the five, pick one; the choice is remembered on this
 * device and sent to the server, which shows it to everyone.
 */
export class Garage {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 16 / 9, 0.05, 100);
  private readonly root = document.createElement('div');
  private readonly wheels: Wheels;
  private car: CarView | null = null;
  private index = savedCar();
  private t = 0;
  open = false;
  /** Dev: hold the turntable at an angle (radians) for screenshots. */
  angle: number | null = null;
  private look: { appearance: AvatarAppearance; proportions: AvatarProportions } | null = null;

  constructor(
    private readonly onPick: (body: number) => void,
    private readonly onClose: () => void,
    environment: Texture | null,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.className = 'garage';
    this.root.innerHTML = `<div class="top">GARAGE</div><button class="arrow l">‹</button><button class="arrow r">›</button>
      <div class="dots">${CAR_MODELS.map(() => '<i></i>').join('')}</div>
      <div class="name"></div><div class="tag"></div>
      <div class="row">
      <button class="go">DRIVE THIS</button><button class="x">CLOSE</button></div>
      <div class="note">Every car shares the same hitbox and keeps its own colours on either team - your team shows on your name plate and the glow under your car.</div>`;
    document.body.appendChild(this.root);
    const q = (s: string): HTMLElement => this.root.querySelector(s) as HTMLElement;
    q('.l').addEventListener('click', () => this.browse(-1));
    q('.r').addEventListener('click', () => this.browse(1));
    q('.go').addEventListener('click', () => {
      saveCar(this.index);
      this.onPick(this.index);
      this.close();
    });
    q('.x').addEventListener('click', () => this.close());

    // the studio
    const s = this.scene;
    s.background = new Color(0x0c1430);
    s.environment = environment;
    s.add(new AmbientLight(0xbfd4ff, 0.6));
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 4);
    const rim = new DirectionalLight(0x6fb6ff, 1.6);
    rim.position.set(-4, 2, -3);
    const glow = new PointLight(0x2f7bff, 6, 6);
    glow.position.set(0, 0.2, 0);
    s.add(key, rim, glow);
    const floor = new Mesh(new CircleGeometry(9, 48), new MeshStandardMaterial({ color: 0x121a36, metalness: 0.3, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.4;
    const plate = new Mesh(new CylinderGeometry(1.25, 1.3, 0.04, 48), new MeshStandardMaterial({ color: 0x2a3560, metalness: 0.6, roughness: 0.3 }));
    plate.position.y = -0.38;
    const ring = new Mesh(new RingGeometry(1.3, 1.36, 64), new MeshBasicMaterial({ color: 0x5fd0ff, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.355;
    s.add(floor, plate, ring);
    this.wheels = new Wheels(s as never, 4);
    this.camera.position.set(1.65, 0.42, 1.95);
    this.camera.lookAt(0, -0.08, 0);
  }

  setLook(look: { appearance: AvatarAppearance; proportions: AvatarProportions } | null): void {
    this.look = look;
    if (look && this.car) this.car.setLook(look.appearance, look.proportions);
  }

  private browse(d: number): void {
    this.index = (this.index + d + CAR_COUNT) % CAR_COUNT;
    this.show();
  }

  private show(): void {
    const m = CAR_MODELS[this.index]!;
    (this.root.querySelector('.name') as HTMLElement).textContent = m.name;
    (this.root.querySelector('.tag') as HTMLElement).textContent = m.tagline;
    this.root.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i === this.index));
    // a fresh car each time the body changes (cheap: geometry is cached)
    if (this.car) this.car.dispose();
    this.car = new CarView(0, this.index, true);
    this.car.showName = false;
    if (this.look) this.car.setLook(this.look.appearance, this.look.proportions);
    this.scene.add(this.car.root);
  }

  openGarage(current: number): void {
    this.index = current;
    this.open = true;
    this.root.classList.add('on');
    this.show();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('on');
    this.onClose();
  }

  render(renderer: WebGLRenderer, dt: number): void {
    this.t += dt;
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.fov = this.camera.aspect < 1.2 ? 48 : 32;
    this.camera.updateProjectionMatrix();
    if (this.car) {
      this.car.root.rotation.y = this.angle ?? this.t * 0.45;
      this.wheels.begin();
      this.car.update(dt, 0, Math.sin(this.t * 0.8) * 0.4, false, true, this.wheels, { steer: Math.sin(this.t * 0.8) * 0.4, lateral: 0, surge: 0, boosting: false, airborne: false, look: Math.sin(this.t * 0.5) * 0.6, cheer: 0, emote: '', emoteTime: 0 }, 3);
      this.wheels.end();
    }
    renderer.render(this.scene, this.camera);
  }
}
