import {
  ARENAS,
  DEFAULT_PROPORTIONS,
  EMOTE,
  LOBBY,
  MODES,
  MessageType,
  isBloxityEmoteId,
  type AvatarAppearance,
  type AvatarProportions,
  type MatchFoundMessage,
} from '@rlb/shared';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { lookFromState } from '../bloxity/avatarLook.js';
import { warmScene } from '../core/warmup.js';
import { logger } from '../util/logger.js';
import { LOOKS } from '../world/Themes.js';
import { LobbyAvatar } from './LobbyAvatar.js';
import { LobbyHud } from './LobbyHud.js';
import { LobbyNet, type LobbyPlayerView, type LobbyStateView } from './LobbyNet.js';
import { LobbyWorld } from './LobbyWorld.js';

const SCOPE = 'lobby';
const WALK = 4.4;
const RUN = 7.6;
const GRAVITY = 22;
const JUMP_V = 7.5;

/** What the lobby needs from the rest of the app. */
export interface LobbyHost {
  renderer: WebGLRenderer;
  /** Join options for the lobby room (identity, token, avatar, car). */
  joinOptions(): Record<string, unknown>;
  myLook(): { appearance: AvatarAppearance; proportions: AvatarProportions };
  openGarage(): void;
  garageOpen(): boolean;
  renderGarage(dt: number): void;
  toggleSocial(): void;
  /** The portal: which room we are in, and who we meet (friend toasts). */
  roomChanged(roomId: string): void;
  playerSeen(username: string): void;
  matchFound(m: MatchFoundMessage): void;
  touch: boolean;
}

/**
 * THE LOBBY: walk the plaza in your Bloxity avatar, see everyone else in
 * theirs, chat and emote, check the scoreboard, and pick a playlist - step on
 * its pad or press its card. When the server finds the match, \`host.matchFound\`
 * takes over (the App loads it behind the MATCH FOUND card and leaves).
 *
 * Owns its scene, camera, lights and input; shares the renderer.
 */
export class Lobby {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 16 / 9, 0.1, 2400);
  readonly net = new LobbyNet();
  readonly hud: LobbyHud;
  private world: LobbyWorld | null = null;
  private readonly me = new LobbyAvatar();
  private readonly others = new Map<string, LobbyAvatar>();
  private env: Texture | null = null;
  private readonly sun = new DirectionalLight();
  private active = false;
  private frozen = false;
  /** The local walker. */
  private readonly pos = new Vector3(0, 0, 6);
  private vy = 0;
  private grounded = true;
  /** Facing: forward is (cos yaw, -sin yaw) on the plaza (x, z); pi/2 faces the playlist pads (-z). */
  private yaw = Math.PI / 2;
  private speed = 0;
  /** The camera orbits at (sin camYaw, cos camYaw) * distance from the walker: 0 is behind a pi/2 walker. */
  private camYaw = 0;
  private camPitch = 0.32;
  private camDist = 7.5;
  private readonly keys = new Set<string>();
  private dragging = -1;
  private lastX = 0;
  private lastY = 0;
  private sendT = 0;
  private myQueue = '';
  private padInside = '';
  private boardT = 0;
  private boardKey = '';
  private emote = '';
  private emoteAt = 0;
  private time = 0;
  private lastChat = new Map<string, number>();
  private seen = new Set<string>();
  private lastRoom = '';

  constructor(private readonly host: LobbyHost) {
    this.hud = new LobbyHud(host.touch);
    this.hud.setVisible(false);
    this.hud.onQueue = (mode) => this.queue(mode);
    this.hud.onButton = (b) => {
      if (b === 'garage') this.host.openGarage();
      else if (b === 'social') this.host.toggleSocial();
      else this.hud.toggleChat();
    };
    this.hud.onChat = (i) => {
      this.net.send(MessageType.QuickChat, i);
      this.hud.toggleChat(false);
    };
    this.net.onMatchFound = (m) => this.host.matchFound(m);
    this.bindInput();
  }

  /** Build the plaza (first time) and its lighting. Heavy: called behind the boot screen. */
  build(): void {
    if (this.world) return;
    this.world = new LobbyWorld();
    this.scene.add(this.world.root, this.me.root);
    const look = LOOKS.day;
    this.scene.background = new Color(look.background);
    this.scene.fog = new Fog(look.fog[0], look.fog[1], look.fog[2]);
    this.scene.add(new HemisphereLight(look.hemi[0], look.hemi[1], look.hemi[2]), new AmbientLight(0xffffff, look.ambient));
    this.sun.color.set(look.sun[0]);
    this.sun.intensity = look.sun[1];
    this.sun.position.set(look.sun[2] * 0.6, look.sun[3] * 0.6, look.sun[4] * 0.6);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(this.host.touch ? 1024 : 2048, this.host.touch ? 1024 : 2048);
    Object.assign(sh.camera, { left: -44, right: 44, top: 44, bottom: -44, near: 1, far: 260 });
    sh.camera.updateProjectionMatrix();
    sh.bias = -0.0004;
    sh.normalBias = 0.04;
    this.scene.add(this.sun);
    this.env = look.env(this.host.renderer);
    this.scene.environment = this.env;
  }

  /** Compile and upload the plaza behind the boot screen, so its first visible frames are smooth. */
  async warm(): Promise<void> {
    this.build();
    this.updateCamera(1);
    await warmScene(this.host.renderer, this.scene, this.camera);
    this.host.renderer.render(this.scene, this.camera);
  }

  /** Into the lobby (boot, or back from a match): join, show, walk. */
  async enter(roomId = ''): Promise<void> {
    this.build();
    this.active = true;
    this.frozen = false;
    this.hud.leaving(false);
    this.hud.setVisible(true);
    this.myQueue = '';
    this.padInside = '';
    this.hud.matchFound(null);
    try {
      await this.net.join(this.host.joinOptions(), roomId || this.lastRoom);
    } catch (error) {
      logger.warn(SCOPE, `could not join a lobby: ${String(error)}`);
      this.hud.toast('Lobby unavailable - retrying');
      window.setTimeout(() => this.active && void this.enter(roomId), 3000);
      return;
    }
    this.lastRoom = this.net.roomId;
    this.host.roomChanged(this.net.roomId);
    // arrive where the server put us
    const mine = this.net.state?.players.get(this.net.sessionId);
    if (mine) this.pos.set(mine.x, 0, mine.z);
    this.yaw = Math.PI / 2; // face the playlist pads, camera behind
    this.camYaw = 0;
    this.me.place(this.pos.x, 0, this.pos.z, this.yaw);
    this.refreshMe();
  }

  /** Take over a lobby room already joined (an invite link). */
  adopt(room: Parameters<LobbyNet['adopt']>[0]): void {
    this.build();
    this.active = true;
    this.hud.setVisible(true);
    this.net.adopt(room, this.host.joinOptions());
    this.lastRoom = this.net.roomId;
    this.host.roomChanged(this.net.roomId);
    this.refreshMe();
  }

  /** Hold still (a match is loading behind the card). */
  freeze(on: boolean): void {
    this.frozen = on;
    if (on) this.keys.clear();
  }

  /**
   * Off to a match: leave the lobby room and hide (the scene is kept for the way back). The
   * MATCH FOUND card stays up a moment and fades, so the cut lands inside the intro's wide shot.
   */
  exit(): void {
    this.active = false;
    this.frozen = false;
    this.net.leave();
    this.hud.leaving(true);
    this.hud.matchFound(null);
    window.setTimeout(() => {
      if (this.active) return;
      this.hud.setVisible(false);
      this.hud.leaving(false);
    }, 800);
    this.keys.clear();
    for (const a of this.others.values()) a.dispose();
    this.others.clear();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** The player's own look and name changed (or we just arrived). */
  refreshMe(): void {
    const look = this.host.myLook();
    this.me.setLook(look.appearance, look.proportions);
    const opts = this.host.joinOptions() as { identity?: { displayName?: string }; car?: number };
    this.me.setName(opts.identity?.displayName || 'You', null);
    this.net.send(MessageType.SetIdentity, opts.identity ?? {});
    if (opts.car !== undefined) this.net.send(MessageType.SetCar, opts.car);
    const avatar = (this.host.joinOptions() as { avatar?: unknown }).avatar;
    if (avatar) this.net.send(MessageType.SetAvatar, avatar);
    this.net.send(MessageType.SetAuth, { token: (this.host.joinOptions() as { token?: string | null }).token ?? null });
  }

  /** The portal's emote picker (while in the lobby): play it at once, replicate it. */
  playEmote(id: string): void {
    if (!isBloxityEmoteId(id)) return;
    this.emote = id.toLowerCase();
    this.emoteAt = this.time;
    this.net.send(MessageType.Emote, { id });
  }

  queue(mode: string): void {
    const m = MODES.find((x) => x.id === mode);
    this.myQueue = m ? m.id : '';
    this.net.send(MessageType.Queue, this.myQueue);
    if (m) this.hud.toast(`QUEUED FOR ${m.label} ${m.name}`);
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    const canvas = this.host.renderer.domElement;
    window.addEventListener('keydown', (e) => {
      if (!this.active || this.host.garageOpen()) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code === 'KeyG') this.host.openGarage();
      if (e.code === 'KeyC') this.hud.toggleChat();
      if (e.code === 'Escape' && this.myQueue) this.queue('');
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        this.net.send(MessageType.QuickChat, Number(digit[1]) - 1);
        this.hud.toggleChat(false);
      }
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      // touch: only the right half turns the camera (the left half is the stick)
      if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.45) return;
      this.dragging = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.dragging) return;
      const k = e.pointerType === 'touch' ? 0.008 : 0.005;
      this.camYaw -= (e.clientX - this.lastX) * k;
      this.camPitch = Math.min(1.1, Math.max(-0.05, this.camPitch + (e.clientY - this.lastY) * k));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId === this.dragging) this.dragging = -1;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        this.camDist = Math.min(14, Math.max(3.5, this.camDist + Math.sign(e.deltaY) * 0.8));
      },
      { passive: true },
    );
  }

  // ------------------------------------------------------------------ the frame

  update(dt: number): void {
    if (!this.world) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const garage = this.host.garageOpen();
    if (!garage && !this.frozen) this.walk(dt);
    const state = this.net.state;
    this.syncOthers(dt, state);
    this.checkPads(state);
    this.hud.setQueues(state ? (state.queues as never) : null, this.myQueue);
    this.world.update(dt, this.myQueue);
    this.boardT -= dt;
    if (this.boardT <= 0 && state) {
      this.boardT = 0.5;
      this.drawBoards(state);
    }
    this.updateCamera(dt);
    const r = this.host.renderer;
    if (garage) {
      this.host.renderGarage(dt);
      return;
    }
    r.toneMappingExposure = LOOKS.day.exposure;
    r.render(this.scene, this.camera);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private walk(dt: number): void {
    const k = this.keys;
    let ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let iy = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const stick = this.hud.stick;
    if (Math.hypot(stick.x, stick.y) > 0.15) {
      ix = stick.x;
      iy = stick.y;
    }
    const mag = Math.min(1, Math.hypot(ix, iy));
    const run = k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(stick.x, stick.y) > 0.92;
    const want = mag > 0.05 ? (run ? RUN : WALK) * mag : 0;
    this.speed += (want - this.speed) * Math.min(1, dt * (want > this.speed ? 8 : 12));
    if (mag > 0.05) {
      // camera-relative: forward is away from the camera
      const fx = -Math.sin(this.camYaw);
      const fz = -Math.cos(this.camYaw);
      const rx = -fz;
      const rz = fx;
      const mx = fx * iy + rx * ix;
      const mz = fz * iy + rz * ix;
      const target = Math.atan2(-mz, mx);
      let d = target - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 12);
    }
    // move along the facing
    this.pos.x += Math.cos(this.yaw) * this.speed * dt;
    this.pos.z += -Math.sin(this.yaw) * this.speed * dt;
    // jump and gravity
    if ((k.has('Space') || stick.jump) && this.grounded) {
      this.vy = JUMP_V;
      this.grounded = false;
    }
    stick.jump = false;
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vy = 0;
      this.grounded = true;
    }
    // stay inside the plaza, out of the obstacles
    for (const c of this.world!.colliders) {
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.4;
      if (d < min && d > 1e-4) {
        this.pos.x = c.x + (dx / d) * min;
        this.pos.z = c.z + (dz / d) * min;
      }
    }
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > LOBBY.radius) {
      this.pos.x *= LOBBY.radius / r;
      this.pos.z *= LOBBY.radius / r;
    }
    const moving = this.speed > 0.3 || !this.grounded;
    if (moving) this.emote = ''; // an emote stops when you move
    this.me.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
    this.me.animate(dt, { speed: this.speed, airborne: !this.grounded, emote: this.emote, emoteTime: this.time - this.emoteAt }, this.time);
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 0.1;
      this.net.send(MessageType.Move, [round(this.pos.x), round(this.pos.y), round(this.pos.z), round(this.yaw), this.grounded ? (this.speed > 0.3 ? 1 : 0) : 2]);
    }
  }

  /** Stepping onto a playlist pad queues you for it. */
  private checkPads(state: LobbyStateView | null): void {
    let inside = '';
    LOBBY.pads.forEach(([x, z], i) => {
      if (Math.hypot(this.pos.x - x, this.pos.z - z) < LOBBY.padRadius && this.pos.y < 1) inside = MODES[i]!.id;
    });
    if (inside && inside !== this.padInside && inside !== this.myQueue) this.queue(inside);
    this.padInside = inside;
    // the server is the truth (a match found clears the queue)
    const mine = state?.players.get(this.net.sessionId);
    if (mine && !mine.matched && mine.queue !== this.myQueue && this.time > 1) this.myQueue = mine.queue;
  }

  private syncOthers(dt: number, state: LobbyStateView | null): void {
    if (!state) return;
    const seen = new Set<string>();
    state.players.forEach((p: LobbyPlayerView, id: string) => {
      if (id === this.net.sessionId) {
        if (p.chat >= 0 && this.lastChat.get(id) !== p.chatAt) {
          this.lastChat.set(id, p.chatAt);
          this.me.say(p.chat, this.time);
        }
        return;
      }
      seen.add(id);
      let a = this.others.get(id);
      if (!a) {
        a = new LobbyAvatar();
        this.others.set(id, a);
        this.scene.add(a.root);
      }
      a.target.x = p.x;
      a.target.y = p.y;
      a.target.z = p.z;
      a.target.yaw = p.yaw;
      const mode = MODES.find((m) => m.id === p.queue);
      a.setName(p.name || 'Player', mode ? mode.color : null);
      const look = lookFromState(p.avatar as never);
      a.setLook(look.appearance ?? ({} as never), look.proportions ?? DEFAULT_PROPORTIONS);
      if (p.chat >= 0 && this.lastChat.get(id) !== p.chatAt) {
        this.lastChat.set(id, p.chatAt);
        a.say(p.chat, this.time);
      }
      const emoteTime = state.time - p.emoteAt;
      a.follow(dt, p.anim, p.emote && emoteTime * 60 < EMOTE.maxTicks ? p.emote : '', emoteTime, this.time);
      if (p.username && !this.seen.has(p.username)) {
        this.seen.add(p.username);
        this.host.playerSeen(p.username);
      }
    });
    for (const [id, a] of this.others) {
      if (!seen.has(id)) {
        a.dispose();
        this.others.delete(id);
      }
    }
  }

  private updateCamera(dt: number): void {
    const target = new Vector3(this.pos.x, this.pos.y + 1.55, this.pos.z);
    const cp = Math.cos(this.camPitch);
    const want = new Vector3(
      target.x + Math.sin(this.camYaw) * cp * this.camDist,
      target.y + Math.sin(this.camPitch) * this.camDist + 0.4,
      target.z + Math.cos(this.camYaw) * cp * this.camDist,
    );
    // keep the camera inside the stadium bowl and above the floor
    want.y = Math.max(0.6, want.y);
    this.camera.position.lerp(want, Math.min(1, dt * 10));
    this.camera.lookAt(target);
  }

  /** The hanging scoreboard and the stadium's end screens. */
  private drawBoards(state: LobbyStateView): void {
    const rows: LobbyPlayerView[] = [];
    state.players.forEach((p) => rows.push(p));
    const matches: { mode: string; blue: number; orange: number; clock: number; overtime: boolean; blueNames: string; orangeNames: string; arena: number }[] = [];
    state.matches.forEach((m) => matches.push({ ...m }));
    const queues: { mode: string; count: number; needed: number; startsIn: number }[] = [];
    state.queues.forEach((q) => queues.push({ mode: q.mode, count: q.count, needed: q.needed, startsIn: Math.ceil(q.startsIn) }));
    const key = JSON.stringify([rows.map((p) => [p.name, p.queue, p.wins, p.goals, p.matches, p.username]), matches, queues]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    const b = this.world!.board;
    const g = b.ctx;
    const W = b.w;
    const H = b.h;
    g.fillStyle = '#070b16';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#10182c';
    g.fillRect(0, 0, W, 70);
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = '900 italic 40px "Titillium Web", sans-serif';
    g.textAlign = 'left';
    g.fillText('ROCKET LEAGUE', 24, 36);
    g.fillStyle = '#7fd0ff';
    g.font = '800 26px "Titillium Web", sans-serif';
    g.textAlign = 'right';
    g.fillText(`LOBBY · ${rows.length} / ${LOBBY.maxPlayers}`, W - 24, 38);
    // players (left)
    g.textAlign = 'left';
    g.fillStyle = '#9fb3d9';
    g.font = '800 20px "Titillium Web", sans-serif';
    g.fillText('PLAYER', 24, 98);
    g.textAlign = 'right';
    g.fillText('W', 420, 98);
    g.fillText('G', 480, 98);
    rows.sort((a, c) => c.wins - a.wins || c.goals - a.goals || a.name.localeCompare(c.name));
    rows.slice(0, 12).forEach((p, i) => {
      const y = 132 + i * 37;
      const mode = MODES.find((m) => m.id === p.queue);
      if (i % 2 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.04)';
        g.fillRect(16, y - 17, 484, 34);
      }
      if (mode) {
        g.fillStyle = mode.color;
        g.fillRect(16, y - 17, 6, 34);
      }
      g.textAlign = 'left';
      g.fillStyle = p.id === this.net.sessionId ? '#ffd65a' : '#ffffff';
      g.font = '800 24px "Titillium Web", sans-serif';
      g.fillText((p.name || 'Player').slice(0, 20), 30, y);
      if (mode) {
        g.fillStyle = mode.color;
        g.font = '900 16px "Titillium Web", sans-serif';
        g.fillText(mode.label, 30 + Math.min(260, g.measureText((p.name || 'Player').slice(0, 20)).width * 1.5) + 14, y + 1);
      }
      g.textAlign = 'right';
      g.fillStyle = '#d6e2ff';
      g.font = '800 24px "Titillium Web", sans-serif';
      g.fillText(p.username ? String(p.wins) : '-', 420, y);
      g.fillText(p.username ? String(p.goals) : '-', 480, y);
    });
    // playlists (top right)
    const X = 540;
    g.textAlign = 'left';
    g.fillStyle = '#9fb3d9';
    g.font = '800 20px "Titillium Web", sans-serif';
    g.fillText('PLAYLISTS', X, 98);
    MODES.forEach((m, i) => {
      const q = queues.find((x) => x.mode === m.id);
      const y = 134 + i * 44;
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(X - 6, y - 19, W - X - 14, 38);
      g.fillStyle = m.color;
      g.font = '900 italic 28px "Titillium Web", sans-serif';
      g.fillText(m.label, X + 4, y);
      g.fillStyle = '#ffffff';
      g.font = '800 20px "Titillium Web", sans-serif';
      g.fillText(m.name, X + 74, y + 1);
      g.textAlign = 'right';
      g.fillStyle = q && q.count ? '#ffffff' : '#7d8aa8';
      g.fillText(q && q.count ? `${q.count}/${q.needed}${q.startsIn >= 0 ? ` · ${q.startsIn}s` : ''}` : 'open', W - 26, y + 1);
      g.textAlign = 'left';
    });
    // live matches (bottom right)
    g.fillStyle = '#9fb3d9';
    g.font = '800 20px "Titillium Web", sans-serif';
    g.fillText('LIVE MATCHES', X, 290);
    if (matches.length === 0) {
      g.fillStyle = '#7d8aa8';
      g.font = '700 20px "Titillium Web", sans-serif';
      g.fillText('None yet - step on a pad to start one', X, 326);
    }
    matches.slice(0, 4).forEach((m, i) => {
      const y = 330 + i * 64;
      const mode = MODES.find((x) => x.id === m.mode);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(X - 6, y - 22, W - X - 14, 58);
      g.fillStyle = mode?.color ?? '#ffffff';
      g.font = '900 italic 20px "Titillium Web", sans-serif';
      g.fillText(mode?.label ?? 'OPEN', X + 2, y - 6);
      g.fillStyle = '#4f8dff';
      g.font = '900 30px "Titillium Web", sans-serif';
      g.textAlign = 'right';
      g.fillText(String(m.blue), X + 160, y + 2);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.font = '800 20px "Titillium Web", sans-serif';
      const mm = Math.floor(m.clock / 60);
      g.fillText(`${m.overtime ? '+' : ''}${mm}:${String(m.clock % 60).padStart(2, '0')}`, X + 210, y + 2);
      g.fillStyle = '#ff9a3c';
      g.textAlign = 'left';
      g.font = '900 30px "Titillium Web", sans-serif';
      g.fillText(String(m.orange), X + 260, y + 2);
      g.fillStyle = '#c7d3ee';
      g.font = '700 14px "Titillium Web", sans-serif';
      g.fillText(`${m.blueNames.slice(0, 30)}  vs  ${m.orangeNames.slice(0, 30)}`, X + 2, y + 22, W - X - 30);
      g.textAlign = 'left';
    });
    b.tex.needsUpdate = true;
    // the stadium's two end screens: the headline
    const top = matches[0];
    this.world!.stadium.drawScreens((s, w, h) => {
      s.fillStyle = '#0a0f1c';
      s.fillRect(0, 0, w, h);
      s.textAlign = 'center';
      s.textBaseline = 'middle';
      s.fillStyle = '#ffc07a';
      s.font = '700 22px "Titillium Web", sans-serif';
      s.fillText('ROCKET LEAGUE · LOBBY', w / 2, 26);
      s.fillStyle = '#ffffff';
      if (top) {
        const mode = MODES.find((x) => x.id === top.mode);
        s.font = '900 italic 70px "Titillium Web", sans-serif';
        s.fillText(`${top.blue}  -  ${top.orange}`, w / 2, 110);
        s.font = '800 22px "Titillium Web", sans-serif';
        s.fillText(`LIVE ${mode?.label ?? ''} · ${ARENAS[top.arena]?.name ?? ''}`, w / 2, 172);
      } else {
        s.font = '900 italic 52px "Titillium Web", sans-serif';
        s.fillText(`${rows.length} IN THE LOBBY`, w / 2, 104);
        s.font = '800 22px "Titillium Web", sans-serif';
        s.fillText('STEP ON A PLAYLIST PAD TO PLAY', w / 2, 168);
      }
    });
    // the station gates: their queue
    for (const st of this.world!.stations) {
      const q = queues.find((x) => x.mode === st.mode.id);
      const k = `${q?.count ?? 0}|${q?.needed ?? 0}|${q?.startsIn ?? -1}`;
      if (k === st.status.key) continue;
      st.status.key = k;
      const s = st.status.ctx;
      s.fillStyle = '#05070d';
      s.fillRect(0, 0, 1024, 256);
      s.textAlign = 'center';
      s.textBaseline = 'middle';
      s.fillStyle = '#ffffff';
      s.font = '900 86px "Titillium Web", sans-serif';
      s.fillText(q && q.count ? `${q.count} / ${q.needed} QUEUED` : 'STEP IN TO PLAY', 512, 100);
      s.fillStyle = st.mode.color;
      s.font = '800 46px "Titillium Web", sans-serif';
      s.fillText(q && q.count && q.startsIn >= 0 ? `KICKOFF IN ${q.startsIn}` : `${st.mode.teamSize} V ${st.mode.teamSize} · BOTS FILL EMPTY SEATS`, 512, 196);
      st.status.tex.needsUpdate = true;
    }
  }
}

const round = (v: number): number => Math.round(v * 100) / 100;
