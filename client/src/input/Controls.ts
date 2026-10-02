import { emptyInput, quantiseInput, type CarInput } from '@rlb/shared';

/** One-shot actions the UI layer reacts to. */
export type UiAction = 'garage' | 'lobby' | 'ballcam' | 'scoreboard-on' | 'scoreboard-off' | 'help' | 'menu' | 'switch-team' | `chat:${number}`;

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);
const dead = (v: number, d = 0.12): number => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

/**
 * Every control source folded into one `CarInput` per tick:
 *
 *   keyboard   W/S drive + pitch, A/D steer + yaw, Space jump, Shift boost,
 *              C powerslide / air roll, Q/E air roll, F ball cam, Tab scores
 *   mouse      left = boost, right = jump
 *   gamepad    left stick, RT/LT, A jump, B boost, X powerslide, LB/RB roll, Y ball cam
 *   touch      stick (steer + drive / pitch in the air) and JUMP / BOOST / DRIFT
 */
export class Controls {
  private readonly keys = new Set<string>();
  private mouseBoost = false;
  private mouseJump = false;
  private readonly actions: UiAction[] = [];
  private padPrev = 0;
  /**
   * PITCH LATCHES. W/S (and the touch stick's vertical) both drive the car and
   * pitch it in the air. A key already held when the car leaves the ground is
   * the player DRIVING, not asking to tip the nose - so it pitches nothing
   * until it is let go and pressed again. Without this, holding W into a jump
   * (and boosting) tipped the car over into a somersault.
   */
  private wasAirborne = false;
  private wLatch = false;
  private sLatch = false;
  private stickLatch = false;
  private jumpHeld = false;
  /** Touch state, written by TouchControls. */
  readonly touch = { x: 0, y: 0, active: false, jump: false, boost: false, drift: false };
  enabled = true;
  /** True when the last input came from a gamepad (help text adapts). */
  usingPad = false;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.clear());
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private clear(): void {
    this.keys.clear();
    this.mouseBoost = false;
    this.mouseJump = false;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    const code = e.code;
    if (code === 'Tab') {
      e.preventDefault();
      if (!e.repeat) this.actions.push('scoreboard-on');
      return;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(code);
    if (code === 'KeyF' || code === 'KeyB') this.actions.push('ballcam');
    if (code === 'KeyH') this.actions.push('help');
    if (code === 'KeyG') this.actions.push('garage');
    if (code === 'KeyL') this.actions.push('lobby');
    if (code === 'Escape') this.actions.push('menu');
    if (code === 'KeyT') this.actions.push('switch-team');
    const digit = /^Digit([1-8])$/.exec(code);
    if (digit) this.actions.push(`chat:${Number(digit[1]) - 1}`);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Tab') {
      e.preventDefault();
      this.actions.push('scoreboard-off');
    }
    this.keys.delete(e.code);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseBoost = true;
    if (e.button === 2) this.mouseJump = true;
    this.target.focus?.();
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseBoost = false;
    if (e.button === 2) this.mouseJump = false;
  };

  pushAction(a: UiAction): void {
    this.actions.push(a);
  }

  takeActions(): UiAction[] {
    return this.actions.splice(0, this.actions.length);
  }

  /** Build this tick's input. `airborne` decides what the drive axis means for the touch stick. */
  read(out: CarInput, airborne: boolean): CarInput {
    Object.assign(out, emptyInput());
    if (!this.enabled) return out;
    const k = this.keys;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const drive = (up ? 1 : 0) - (down ? 1 : 0);
    const turn = (right ? 1 : 0) - (left ? 1 : 0);
    const airRoll = k.has('KeyC') || k.has('KeyX');
    let rollKeys = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);

    out.throttle = drive;
    out.steer = turn;
    // the moment of take-off: whatever is held now is driving input
    if (airborne && !this.wasAirborne) {
      this.wLatch = up;
      this.sLatch = down;
      this.stickLatch = Math.abs(this.touch.y) > 0.3;
    }
    if (!up) this.wLatch = false;
    if (!down) this.sLatch = false;
    if (Math.abs(this.touch.y) < 0.25) this.stickLatch = false;
    out.pitch = (up && !this.wLatch ? 1 : 0) - (down && !this.sLatch ? 1 : 0);
    // pitch means nothing on the ground - and leaking it into the take-off tick tipped the nose
    if (!airborne) out.pitch = 0;
    out.yaw = airRoll ? 0 : turn;
    out.roll = airRoll ? turn : 0;
    if (rollKeys !== 0) out.roll = rollKeys;
    out.jump = k.has('Space') || this.mouseJump;
    // a jump pressed in the air takes its flip direction from the keys as they are
    const rawPitch = drive;
    out.boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.mouseBoost;
    out.handbrake = airRoll || rollKeys !== 0;

    // gamepad
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const lx = dead(pad.axes[0] ?? 0);
      const ly = dead(pad.axes[1] ?? 0);
      const b = pad.buttons;
      const pressed = (i: number): boolean => !!b[i]?.pressed;
      const value = (i: number): number => b[i]?.value ?? 0;
      const rt = value(7);
      const lt = value(6);
      const any = Math.abs(lx) + Math.abs(ly) + rt + lt > 0.05 || b.some((x) => x.pressed);
      if (!any) continue;
      this.usingPad = true;
      const padRoll = pressed(2);
      out.throttle = clamp1(rt - lt + out.throttle);
      out.steer = clamp1(lx + out.steer);
      out.pitch = clamp1(-ly + out.pitch);
      if (padRoll) {
        out.roll = clamp1(lx);
        out.yaw = 0;
      } else out.yaw = clamp1(lx + out.yaw);
      rollKeys = (pressed(5) ? 1 : 0) - (pressed(4) ? 1 : 0);
      if (rollKeys) out.roll = rollKeys;
      out.jump ||= pressed(0);
      out.boost ||= pressed(1);
      out.handbrake ||= padRoll || rollKeys !== 0;
      // edge actions
      const mask = (pressed(3) ? 1 : 0) | (pressed(8) ? 2 : 0) | (pressed(9) ? 4 : 0);
      if (mask & 1 && !(this.padPrev & 1)) this.actions.push('ballcam');
      if (mask & 2 && !(this.padPrev & 2)) this.actions.push('scoreboard-on');
      if (!(mask & 2) && this.padPrev & 2) this.actions.push('scoreboard-off');
      if (mask & 4 && !(this.padPrev & 4)) this.actions.push('menu');
      this.padPrev = mask;
      break;
    }

    // touch
    const t = this.touch;
    if (t.active || t.jump || t.boost || t.drift) {
      const mag = Math.hypot(t.x, t.y);
      if (airborne) {
        out.pitch = this.stickLatch ? 0 : clamp1(t.y);
        out.yaw = t.drift ? 0 : clamp1(t.x);
        out.roll = t.drift ? clamp1(t.x) : 0;
        out.steer = clamp1(t.x);
        out.throttle = mag > 0.25 ? 1 : 0;
      } else {
        out.steer = clamp1(t.x * 1.15);
        out.throttle = mag > 0.22 ? (t.y < -0.45 ? -1 : 1) : 0;
        out.pitch = 0;
      }
      out.jump ||= t.jump;
      out.boost ||= t.boost;
      out.handbrake ||= t.drift;
    }
    if (!airborne) out.pitch = 0;
    const jumpEdge = out.jump && !this.jumpHeld;
    this.jumpHeld = out.jump;
    if (airborne && jumpEdge) {
      if (out.pitch === 0) out.pitch = rawPitch !== 0 ? rawPitch : this.touch.active ? clamp1(this.touch.y) : 0;
    }
    this.wasAirborne = airborne;
    return quantiseInput(out);
  }
}
