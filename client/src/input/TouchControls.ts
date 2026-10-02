import type { Controls } from './Controls.js';

const CSS = `
.tc-root{position:fixed;inset:0;pointer-events:none;z-index:20;user-select:none;-webkit-user-select:none}
.tc-stick-zone{position:absolute;left:0;bottom:0;width:46%;height:72%;pointer-events:auto;touch-action:none}
.tc-base{position:absolute;width:var(--s);height:var(--s);margin:calc(var(--s)/-2) 0 0 calc(var(--s)/-2);border-radius:50%;
  background:radial-gradient(circle,rgba(255,255,255,.10),rgba(255,255,255,.04) 60%,rgba(255,255,255,.14));border:2px solid rgba(255,255,255,.35);
  box-shadow:0 0 0 2px rgba(0,0,0,.25) inset;opacity:.55;transition:opacity .15s}
.tc-base.on{opacity:1}
.tc-knob{position:absolute;left:50%;top:50%;width:44%;height:44%;margin:-22% 0 0 -22%;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#fff,#cfe3ff 55%,#8fb3e8);box-shadow:0 4px 10px rgba(0,0,0,.45)}
.tc-btn{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;display:grid;place-items:center;
  font:800 calc(var(--b)*.2)/1 "Titillium Web","Fredoka",sans-serif;letter-spacing:.04em;color:#fff;text-shadow:0 2px 3px rgba(0,0,0,.6);
  width:var(--b);height:var(--b);border:3px solid rgba(255,255,255,.75);box-shadow:0 5px 0 rgba(0,0,0,.35),0 0 18px rgba(0,0,0,.25)}
.tc-btn.down{transform:translateY(3px) scale(.96);box-shadow:0 2px 0 rgba(0,0,0,.35);filter:brightness(1.25)}
.tc-jump{background:radial-gradient(circle at 35% 30%,#7ff0a8,#1fa85a)}
.tc-boost{background:radial-gradient(circle at 35% 30%,#ffd27a,#ff7a1a)}
.tc-drift{background:radial-gradient(circle at 35% 30%,#b7c4ff,#4d5fd6);--b:calc(var(--bb)*.72)}
.tc-small{--b:calc(var(--bb)*.5);font-size:calc(var(--bb)*.11);background:rgba(20,28,48,.72)}
`;

/** Pointer capture keeps a dragged thumb ours; it can throw (synthetic or already-ended pointers). */
const capture = (el: Element, id: number): void => {
  try {
    el.setPointerCapture(id);
  } catch {
    /* the press still counts without capture */
  }
};

/**
 * Landscape touch layout: a floating stick for the left thumb (steer + drive;
 * pitch/yaw in the air, flip direction on a second jump), and a right-thumb
 * cluster - JUMP biggest in the corner, BOOST beside it, DRIFT (powerslide /
 * air roll) above, and a small CARS / CHAT / SCORES / SOCIAL / LOBBY row at the bottom centre -
 * sized from the screen so it never covers the scoreboard or the boost gauge.
 */
export class TouchControls {
  private readonly root = document.createElement('div');
  private readonly base = document.createElement('div');
  private readonly knob = document.createElement('div');
  private stickId = -1;
  private cx = 0;
  private cy = 0;

  constructor(private readonly controls: Controls, onBallCam: () => void, onScores: (on: boolean) => void, onChat: () => void, onGarage: () => void, onSocial: () => void, onLobby: () => void) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.className = 'tc-root';
    const zone = document.createElement('div');
    zone.className = 'tc-stick-zone';
    this.base.className = 'tc-base';
    this.knob.className = 'tc-knob';
    this.base.appendChild(this.knob);
    zone.appendChild(this.base);
    this.root.appendChild(zone);

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId >= 0) return;
      this.stickId = e.pointerId;
      capture(zone, e.pointerId);
      const r = zone.getBoundingClientRect();
      this.cx = e.clientX - r.left;
      this.cy = e.clientY - r.top;
      this.place();
      this.base.classList.add('on');
      this.move(e.clientX - r.left, e.clientY - r.top);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const r = zone.getBoundingClientRect();
      this.move(e.clientX - r.left, e.clientY - r.top);
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.controls.touch.active = false;
      this.controls.touch.x = 0;
      this.controls.touch.y = 0;
      this.knob.style.transform = '';
      this.base.classList.remove('on');
      this.home();
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    this.button('JUMP', 'tc-jump', 'right:calc(var(--pad) + 0px);bottom:calc(var(--pad) + 0px)', (on) => (this.controls.touch.jump = on));
    this.button('BOOST', 'tc-boost', 'right:calc(var(--pad) + var(--bb) * 1.08);bottom:calc(var(--pad) + var(--bb) * .12)', (on) => (this.controls.touch.boost = on));
    this.button('DRIFT', 'tc-drift', 'right:calc(var(--pad) + var(--bb) * .2);bottom:calc(var(--pad) + var(--bb) * 1.12)', (on) => (this.controls.touch.drift = on));
    this.button('CAM', 'tc-small', 'right:calc(var(--pad) + var(--bb) * 1.25);bottom:calc(var(--pad) + var(--bb) * 1.35)', (on) => on && onBallCam());
    // utility row bottom-centre, between the thumbs - nothing in the top-left corner
    this.button('CARS', 'tc-small', 'left:calc(50% - var(--bb) * 1.42);bottom:max(8px, env(safe-area-inset-bottom, 0px))', (on) => on && onGarage());
    this.button('CHAT', 'tc-small', 'left:calc(50% - var(--bb) * .83);bottom:max(8px, env(safe-area-inset-bottom, 0px))', (on) => on && onChat());
    this.button('SCORES', 'tc-small', 'left:calc(50% - var(--bb) * .24);bottom:max(8px, env(safe-area-inset-bottom, 0px))', (on) => onScores(on));
    this.button('SOCIAL', 'tc-small', 'left:calc(50% + var(--bb) * .35);bottom:max(8px, env(safe-area-inset-bottom, 0px))', (on) => on && onSocial());
    this.button('LOBBY', 'tc-small', 'left:calc(50% + var(--bb) * .94);bottom:max(8px, env(safe-area-inset-bottom, 0px))', (on) => on && onLobby());

    document.body.appendChild(this.root);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.home();
  }

  private button(label: string, cls: string, pos: string, set: (on: boolean) => void): void {
    const b = document.createElement('div');
    b.className = `tc-btn ${cls}`;
    b.textContent = label;
    b.setAttribute('style', pos);
    const ids = new Set<number>();
    b.addEventListener('pointerdown', (e) => {
      ids.add(e.pointerId);
      capture(b, e.pointerId);
      b.classList.add('down');
      set(true);
      e.preventDefault();
    });
    const up = (e: PointerEvent): void => {
      if (!ids.delete(e.pointerId)) return;
      if (ids.size === 0) {
        b.classList.remove('down');
        set(false);
      }
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    this.root.appendChild(b);
  }

  private resize(): void {
    const short = Math.min(window.innerWidth, window.innerHeight);
    const bb = Math.round(Math.max(64, Math.min(118, short * 0.2)));
    this.root.style.setProperty('--bb', `${bb}px`);
    this.root.style.setProperty('--b', `${bb}px`);
    this.root.style.setProperty('--s', `${Math.round(bb * 1.55)}px`);
    this.root.style.setProperty('--pad', `max(14px, env(safe-area-inset-right, 0px))`);
    this.radius = bb * 0.62;
    if (this.stickId < 0) this.home();
  }

  private radius = 60;

  /** Rest position of the stick, drawn where a thumb usually lands. */
  private home(): void {
    const zone = this.base.parentElement;
    if (!zone) return;
    const r = zone.getBoundingClientRect();
    this.cx = Math.min(r.width * 0.35, 160 + this.radius);
    this.cy = r.height - this.radius * 1.9;
    this.place();
  }

  private place(): void {
    this.base.style.left = `${this.cx}px`;
    this.base.style.top = `${this.cy}px`;
  }

  private move(x: number, y: number): void {
    let dx = x - this.cx;
    let dy = y - this.cy;
    const d = Math.hypot(dx, dy);
    const r = this.radius;
    if (d > r) {
      dx = (dx / d) * r;
      dy = (dy / d) * r;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.controls.touch.active = true;
    this.controls.touch.x = dx / r;
    this.controls.touch.y = -dy / r;
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }
}
