import {
  ARENA,
  CAR,
  DEFAULT_APPEARANCE,
  DEFAULT_PROPORTIONS,
  EventKind,
  INPUT_BYTES,
  MAX_CARS,
  MessageType,
  Phase,
  TEAMS,
  TICK_DT,
  TICK_RATE,
  emptyInput,
  isBloxityEmoteId,
  type EmoteMessage,
  forwardOf,
  packInput,
  upOf,
  type FeedMessage,
  type GoalMessage,
  type MatchEndMessage,
  type SetAvatarMessage,
  CAR_COUNT,
  type AvatarAppearance,
  type AvatarProportions,
  type MatchFoundMessage,
} from '@rlb/shared';
import type { Room } from 'colyseus.js';
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Sfx, type HeardCar } from '../audio/Sfx.js';
import { Bloxity } from '../bloxity/Bloxity.js';
import { lookFromLegion, lookFromState } from '../bloxity/avatarLook.js';
import { botAppearance } from '../bloxity/botLooks.js';
import { identityFromLegion } from '../bloxity/identity.js';
import { CameraRig } from '../camera/CameraRig.js';
import { clientConfig } from '../config/clientConfig.js';
import { isMobileGpu, isTouchPrimary } from '../config/device.js';
import { Controls } from '../input/Controls.js';
import { TouchControls } from '../input/TouchControls.js';
import { Net, type NetPlayer, type NetState } from '../net/Net.js';
import { Pose, Prediction } from '../net/Prediction.js';
import { playerModelLoader } from '../player/PlayerModelLoader.js';
import { REPLAY_CAR_FIELDS, Replay } from '../replay/Replay.js';
import { Garage, savedCar } from '../ui/Garage.js';
import { Hud } from '../ui/Hud.js';
import { ArenaView } from '../world/ArenaView.js';
import { LOOKS, themeOf, type ArenaTheme } from '../world/Themes.js';
import { SocialPanel, type SocialAction } from '../ui/SocialPanel.js';
import { BallView } from '../world/BallView.js';
import { CarView, Wheels, shadowTexture } from '../world/CarView.js';
import { buildCar } from '../world/cars/CarModels.js';
import { warmScene } from './warmup.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Effects } from '../world/Effects.js';
import { S, quatToThree } from '../world/units.js';

const TEAM_COLORS = [new Color(TEAMS[0].color), new Color(TEAMS[1].color)];

/** Cars built, dressed and compiled before a match (a 4v4 is eight). */
const POOL_SIZE = 8;
/** The intro: seconds to fly from the wide shot into the car. */
const INTRO_SECONDS = 2.1;
const SHADOW_GEO = new PlaneGeometry(1.5, 1.05);
const SHADOW_MAT = new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
/** Yield to the browser for a frame - or a moment, in a background tab where frames never come. */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 50);
  });

interface CarMeta {
  view: CarView;
  shadow: Mesh;
  lookKey: string;
  nameKey: string;
  lastVel: Vector3;
  lateral: number;
  surge: number;
  trailT: number;
}

/**
 * The client: composition and the frame.
 *
 * Fixed 60 Hz ticks (read input -> predict -> send) are decoupled from the
 * render rate; every frame interpolates between the last two predicted ticks
 * and lets correction offsets glide out.
 */
export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  private arena = new ArenaView(themeOf(0));
  /** Which arena is built (index into ARENAS) - follows the server's `match.arena`. */
  private arenaIndex = 0;
  private readonly hemi = new HemisphereLight();
  private readonly ambient = new AmbientLight();
  private readonly sun = new DirectionalLight();
  private readonly envs = new Map<ArenaTheme, Texture>();
  private readonly ball = new BallView();
  private readonly effects = new Effects();
  private readonly wheels = new Wheels(this.scene, MAX_CARS * 4);
  private readonly cars: (CarMeta | null)[] = new Array<CarMeta | null>(MAX_CARS).fill(null);
  readonly net: Net;
  readonly pred = new Prediction();
  private readonly controls: Controls;
  private readonly hud: Hud;
  readonly sfx = new Sfx();
  readonly bloxity: Bloxity;
  private readonly replay = new Replay();
  private readonly input = emptyInput();
  private readonly packet: number[] = new Array(2 + INPUT_BYTES).fill(0);
  private acc = 0;
  private alpha = 0;
  private lastPhase = -1;
  private lastGoal: GoalMessage | null = null;
  private goalPulse: [number, number] = [0, 0];
  private hype = 0;
  private results: MatchEndMessage | null = null;
  private boardOn = false;
  private fpsT = 0;
  private fpsN = 0;
  private fps = 0;
  private showFps = clientConfig.debug;
  private cheerT = 0;
  private cheerTeam = -1;
  private readonly bySlot: (NetPlayer | null)[] = new Array<NetPlayer | null>(MAX_CARS).fill(null);
  private readonly pose = new Pose();
  private readonly carPoseCam = new Pose();
  private readonly camUp = new Vector3();
  private readonly v = { a: new Vector3(), b: new Vector3(), c: new Vector3(), d: new Vector3() };
  private readonly replayCars = new Float32Array(MAX_CARS * REPLAY_CAR_FIELDS);
  private started = false;
  private pixelCap = 2;
  private knownUsers = new Set<string>();
  private lastSeenGo = false;

  constructor(container: HTMLElement) {
    const mobile = isMobileGpu();
    this.pixelCap = mobile ? 1.5 : 2;
    this.renderer = new WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    // real-time sun shadows over the whole arena: cars, riders, the ball, goal frames and the
    // structures round the goals cast; pitch, walls, goal boxes and pads receive. One map, sized
    // to the arena (~10 cm texels on desktop), filtered PCF; phones get a smaller map. 1536 not
    // 2048: measured +1.3 ms a frame for 2048 on an integrated GPU, ~0 for 1536.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    const sh = this.sun.shadow;
    sh.mapSize.set(mobile ? 1024 : 1536, mobile ? 1024 : 1536);
    sh.camera.left = -74;
    sh.camera.right = 74;
    sh.camera.top = 74;
    sh.camera.bottom = -74;
    sh.camera.near = 1;
    sh.camera.far = 320;
    sh.camera.updateProjectionMatrix(); // without this the map keeps covering the default 10 m box
    sh.bias = -0.0004;
    sh.normalBias = 0.03;
    sh.radius = mobile ? 1 : 1.6;
    this.sun.castShadow = true;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.tabIndex = 0;

    const scene = this.scene;
    scene.fog = new Fog(0, 1, 2);
    scene.add(this.hemi, this.ambient, this.sun);
    scene.add(this.arena.root, this.ball.root, this.ball.shadow, this.effects.root);
    this.applyLook();
    scene.add(this.rig.camera);
    // bloom on the lights, boost and goal glow (desktop; phones render straight)
    if (!mobile) {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(scene, this.rig.camera));
      this.bloom = new UnrealBloomPass(new Vector2(window.innerWidth, window.innerHeight), 0.65, 0.4, 3.0);
      composer.addPass(this.bloom);
      this.bloom.strength = LOOKS[this.arena.theme].bloom;
      composer.addPass(new OutputPass());
      this.composer = composer;
    }

    const touch = isTouchPrimary();
    this.hud = new Hud(touch);
    this.controls = new Controls(this.renderer.domElement);
    if (touch) {
      this.touch = new TouchControls(
        this.controls,
        () => this.toggleBallCam(),
        (on) => this.showBoard(on),
        () => {
          this.chatOpen = this.chatEnabled && !this.chatOpen;
          this.hud.toggleChat(this.chatOpen);
        },
        () => this.openGarage(),
        () => this.social.show(!this.social.open),
        () => this.onExit?.(),
      );
    }
    this.hud.setBallCam(this.rig.ballCam);
    this.hud.onChat = (i) => this.quickChat(i);
    this.hud.onButton = (what) => {
      if (what === 'scores') this.showBoard(!this.boardOn);
      if (what === 'help') this.hud.toggleHelp();
      if (what === 'team') this.net.send(MessageType.SwitchTeam, 1);
      if (what === 'ballcam') this.toggleBallCam();
      if (what === 'garage') this.openGarage();
      if (what === 'social') this.social.show(!this.social.open);
      if (what === 'lobby') this.onExit?.();
    };
    // on the page itself, not in the match HUD: the lobby opens it too
    this.social = new SocialPanel(document.body);
    this.social.onAction = (a) => void this.onSocial(a);
    this.garage = new Garage(
      (body) => {
        if (this.inMatch) this.net.send(MessageType.SetCar, body);
        this.onCarPicked?.(body);
      },
      () => {
        if (this.inMatch) this.hud.root.style.display = '';
        this.onGarageClosed?.();
        this.renderer.domElement.focus();
      },
      scene.environment,
    );

    this.net = new Net({
      onSnapshot: (bytes) => {
        this.pred.onSnapshot(bytes);
        this.replay.record(this.pred.auth);
      },
      onGoal: (m) => this.onGoal(m),
      onFeed: (m) => this.onFeed(m),
      onMatchEnd: (m) => {
        this.results = m;
        this.bloxity.gameplayEnd();
        const mine = this.myPlayer();
        this.sfx.fanfare(!!mine && m.winner === mine.team);
      },
      onStatus: (status, detail) => {
        this.hud.setStatus(status === 'offline' ? `Reconnecting… ${detail ?? ''}` : status === 'connecting' && this.started ? 'Connecting…' : null);
        // not joinable while we have no room
        if (status === 'offline') this.bloxity.updateRoom('');
      },
      onReset: () => this.resetWorld(),
      onToLobby: () => this.onExit?.(),
    });

    this.bloxity = new Bloxity({
      setMasterVolume: (v) => this.sfx.setVolume(v),
      setMusicVolume: (v) => this.sfx.setMusicVolume(v),
      setGraphicsQuality: (q) => this.setQuality(q),
      setShowFps: (on) => (this.showFps = on || clientConfig.debug),
      setCameraSensitivity: (scale) => (this.rig.sensitivity = Math.min(5, Math.max(0.1, scale))),
      setChatEnabled: (on) => {
        this.chatEnabled = on;
        if (!on && this.chatOpen) {
          this.chatOpen = false;
          this.hud.toggleChat(false);
        }
      },
      setPanelOpacity: (alpha) => document.documentElement.style.setProperty('--panel-a', alpha.toFixed(2)),
      // the portal's "respawn": the server takes the car off like a demolition (back in 3 s, rate-limited)
      respawn: () => void this.net.send(MessageType.Respawn, {}),
      pointerLockChanged: () => undefined,
      avatarChanged: (equipped, proportions) => {
        const look = lookFromLegion(equipped, proportions);
        this.localLook = look;
        this.net.sendAvatar(look);
        this.lobbySync?.();
      },
      playEmote: (id) => this.playEmote(id),
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    const unlock = (): void => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private localLook: SetAvatarMessage | null = null;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private garage!: Garage;

  openGarage(): void {
    const me = this.inMatch ? this.myPlayer() : null;
    this.garage.setLook(me ? lookFromState(me.avatar as never) : this.myLook);
    this.garage.openGarage(me?.body ?? savedCar());
    this.hud.root.style.display = 'none';
    this.onGarageOpened?.();
    this.sfx.click();
  }

  get garageOpen(): boolean {
    return this.garage.open;
  }

  /** The garage drawn on its own (the lobby calls this instead of drawing the plaza). */
  renderGarage(dt: number): void {
    this.garage.render(this.renderer, dt);
  }

  toggleSocial(): void {
    this.social.show(!this.social.open);
  }

  /** The portal's idea of where we are (lobby or match room id). */
  noteRoom(roomId: string): void {
    this.knownUsers.clear();
    this.bloxity.updateRoom(roomId);
  }

  /** Someone verified is in the same lobby: the portal's friend toast. */
  notePlayer(username: string): void {
    if (this.knownUsers.has(username)) return;
    if (this.knownUsers.size === 0) this.bloxity.playerInRoom(username);
    else this.bloxity.playerJoined(username);
    this.knownUsers.add(username);
  }

  /** Lobby hooks: the garage's pick / open / close, and "who I am changed" (login, cosmetics). */
  onCarPicked: ((body: number) => void) | null = null;
  onGarageOpened: (() => void) | null = null;
  onGarageClosed: (() => void) | null = null;
  lobbySync: (() => void) | null = null;

  /** What a room needs to know about us when we join it (lobby or match). */
  joinOptions(): Record<string, unknown> {
    return {
      token: this.bloxity.getToken(),
      car: savedCar(),
      identity: identityFromLegion(this.bloxity.getUser(), this.bloxity.getGuest()),
      avatar: this.localLook ?? (this.bloxity.available ? lookFromLegion(this.bloxity.getEquipped(), this.bloxity.getProportions()) : undefined),
    };
  }

  startBloxity(): void {
    this.bloxity.start();
    // THE auth subscription (the wrapper's single onUserChanged): identity and token to the server,
    // and the account chip / social panel - which read the user fresh, never a cached copy
    this.bloxity.onUserChanged((user) => {
      const identity = identityFromLegion(user, this.bloxity.getGuest());
      this.net.sendIdentity(identity);
      this.net.sendAuth(this.bloxity.getToken());
      this.hud.setAccountChip(user ? user.displayName || user.username : null);
      this.social.setAccount(user ? { name: user.displayName || user.username, pfp: user.pfp ?? '', bux: null } : null);
      if (user) void this.loadSocial();
      this.lobbySync?.();
    });
  }

  loadingStep(text: string): void {
    this.bloxity.loadingStep(text);
  }

  async initialise(): Promise<void> {
    await playerModelLoader.load();
  }

  /** Called when a playlist match sends us back (or we choose to leave): the App returns to the lobby. */
  onExit: (() => void) | null = null;
  /** Lobby-side hooks while the Game is not in a match (emotes, the garage's pick). */
  lobbyEmote: ((id: string) => void) | null = null;
  private touch: TouchControls | null = null;
  private readonly carPool: CarMeta[] = [];
  private readonly heard: HeardCar[] = [];
  private dressedThisFrame = false;
  private introPending = false;
  /** False while a playlist match settles behind the card (the camera holds the wide shot). */
  private revealed = true;
  /** Until then (performance.now ms) only our own rider is dressed: the intro is flying. */
  private introUntil = 0;
  /** Our own car view, dressed in our look before the match (see prepare). */
  private mine: CarMeta | null = null;
  private mineKey = '';
  private warmed = false;
  private inMatch = false;

  get playing(): boolean {
    return this.inMatch;
  }

  /** The player's own look (from the portal), for the lobby walker. */
  get myLook(): { appearance: AvatarAppearance; proportions: AvatarProportions } {
    if (this.localLook) return this.localLook;
    if (this.bloxity.available) return lookFromLegion(this.bloxity.getEquipped(), this.bloxity.getProportions());
    return { appearance: DEFAULT_APPEARANCE, proportions: DEFAULT_PROPORTIONS };
  }

  /** Show or hide everything that belongs to a match (HUD, touch buttons, car controls). */
  /** The portal: playing again (back in the lobby after a match). */
  portalGameplayStart(): void {
    this.bloxity.gameplayStart();
  }

  setActive(on: boolean): void {
    this.inMatch = on;
    if (!on) this.sfx.silenceCars();
    this.sfx.setMusicMode(on ? 'match' : 'lobby');
    this.controls.takeActions(); // keys pressed in the lobby are not car commands
    this.hud.root.style.display = on ? '' : 'none';
    this.touch?.setVisible(on);
    this.controls.enabled = on;
    if (on) {
      this.applyLook();
      this.renderer.domElement.focus();
    }
  }

  /**
   * GET A MATCH READY BEFORE ANYONE SEES IT (behind the lobby's "match found"
   * screen): build the arena it is played in, build every car body and wheel
   * set, fill a pool of dressed car views, then compile every shader the match
   * will draw - scene, shadow pass, bloom - and upload the textures, by
   * rendering it once. After this, joining spawns nothing and compiles nothing,
   * so the intro has no stall. Yields between steps so the overlay stays alive.
   */
  async prepare(arena: number, report: (text: string) => void = () => undefined): Promise<void> {
    report('Building the arena…');
    await nextFrame();
    this.setArena(arena);
    this.applyLook();
    if (!this.warmed) {
      report('Tuning the cars…');
      for (let i = 0; i < CAR_COUNT; i += 1) {
        buildCar(i);
        this.wheels.pool(i);
        await nextFrame();
      }
      for (let i = 0; i < POOL_SIZE; i += 1) {
        const m = this.makeMeta(i % 2, i % CAR_COUNT);
        m.view.setLook(DEFAULT_APPEARANCE, DEFAULT_PROPORTIONS);
        m.lookKey = '';
        this.carPool.push(m);
      }
      // the avatar body (player.glb) arrives asynchronously: give it a moment, never forever
      const until = performance.now() + 4000;
      while (performance.now() < until && this.carPool.some((m) => m.view.rider.bodyVersion === 0)) await nextFrame();
      this.warmed = true;
    }
    // our own car, already wearing our look: the one car the intro flies right up to
    this.mine ??= this.makeMeta(0, savedCar());
    const look = this.myLook;
    const lookKey = JSON.stringify(look);
    if (this.mineKey !== lookKey) {
      this.mineKey = lookKey;
      const before = this.mine.view.rider.bodyVersion;
      this.mine.view.setLook(look.appearance, look.proportions);
      const until = performance.now() + 2500;
      while (performance.now() < until && this.mine.view.rider.bodyVersion === before) await nextFrame();
      // its worn items (hat, hair, clothes) load on their own: a little longer, still bounded
      for (let i = 0; i < 20; i += 1) await nextFrame();
    }
    report('Warming up the lights…');
    await this.compileMatch();
  }

  /** Put the pool on stage (boosting, so the flames count too), compile asynchronously, render once, take it off. */
  private async compileMatch(): Promise<void> {
    const staged = this.carPool.slice(0, POOL_SIZE);
    const motion = { steer: 0, lateral: 0, surge: 0, boosting: true, airborne: false, look: 0, cheer: 0, emote: '', emoteTime: 0 };
    this.wheels.begin();
    staged.forEach((m, k) => {
      m.view.root.position.set((k - staged.length / 2) * 2.2, 0.2, -6);
      m.shadow.position.set((k - staged.length / 2) * 2.2, 0.015, -6);
      this.scene.add(m.view.root, m.shadow);
      m.view.root.updateMatrixWorld(true);
      m.view.update(1 / 60, 500, 0.3, true, true, this.wheels, motion, 6);
    });
    this.wheels.end();
    this.rig.camera.position.set(0, 3, 4);
    this.rig.camera.lookAt(0, 0.5, -6);
    await warmScene(this.renderer, this.scene, this.rig.camera);
    if (this.composer) this.composer.render(1 / 60);
    else this.renderer.render(this.scene, this.rig.camera);
    for (const m of staged) {
      m.view.root.removeFromParent();
      m.shadow.removeFromParent();
    }
    this.wheels.begin();
    this.wheels.end();
  }

  /**
   * Take the seat the lobby reserved: prepare the match's arena, join, then
   * SETTLE out of sight - frames run (`onJoined`: the App starts driving us)
   * while the MATCH FOUND card still covers the screen, until every car is on
   * the pitch and dressed. The caller then `reveal()`s: card away, intro on.
   */
  async joinMatch(found: MatchFoundMessage, report?: (text: string) => void, onJoined?: () => void): Promise<void> {
    await this.prepare(found.arena, report);
    report?.('Joining…');
    this.resetMatchView();
    this.revealed = false;
    await this.net.joinReserved(found.reservation);
    this.hud.resultsLabel = 'Back to lobby in';
    this.afterJoin();
    onJoined?.();
    report?.('Meeting the other drivers…');
    await this.settle();
  }

  /** Until every car present is on the pitch and dressed (plus a beat for their outfits), at most 3.5 s. */
  private async settle(): Promise<void> {
    const until = performance.now() + 3500;
    let steady = 0;
    while (performance.now() < until && steady < 30) {
      const local = this.pred.localSlot;
      const ready = local >= 0 && !!this.cars[local] && this.cars.every((m) => !m || m.lookKey !== '');
      steady = ready ? steady + 1 : 0;
      await nextFrame();
    }
  }

  /** Off with the card: the intro flies from the wide shot into our car. */
  reveal(): void {
    this.revealed = true;
  }

  /** Straight into an open room (dev `?play=open`, or an invite link into a match). */
  async joinOpen(room?: Room<NetState>): Promise<void> {
    await this.prepare(0);
    this.setJoinOptions();
    this.resetMatchView();
    if (room) this.net.adopt(room);
    else await this.net.connect();
    this.hud.resultsLabel = 'Next match in';
    this.afterJoin();
    this.revealed = true;
  }

  private afterJoin(): void {
    this.introPending = true;
    this.noteRoom(this.net.roomId);
    this.setActive(true);
  }

  /** Leave the match (it ended, or we asked): drop the cars into the pool and hide the match. */
  leaveMatch(): void {
    this.net.leave();
    this.resetMatchView();
    this.setActive(false);
  }

  private resetMatchView(): void {
    this.pred.reset();
    for (let i = 0; i < MAX_CARS; i += 1) this.dropCar(i);
    this.results = null;
    this.hud.showResults(null, '', 0, 0);
    this.replay.stop();
    this.lastPhase = -1;
    this.lastGoal = null;
    this.rig.setMode('overview');
  }

  private setJoinOptions(): void {
    this.net.setJoinOptions(() => this.joinOptions());
  }

  start(): void {
    this.started = true;
    this.bloxity.loadingEnd();
    this.bloxity.gameplayStart();
    this.renderer.domElement.focus();
  }

  /** Window size changed (the lobby listens too). */
  onResize: ((w: number, h: number) => void) | null = null;

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.onResize?.(w, h);
    this.renderer.setSize(w, h);
    this.composer?.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelCap));
    this.composer?.setSize(w, h);
    // bloom is soft by nature: half resolution looks the same at a quarter of the cost
    const dpr = Math.min(window.devicePixelRatio, this.pixelCap);
    this.bloom?.setSize(Math.round((w * dpr) / 2), Math.round((h * dpr) / 2));
    this.rig.resize(w, h);
    this.effects.setViewport(h * Math.min(window.devicePixelRatio, this.pixelCap), this.rig.camera.fov);
  }

  private setQuality(level: string): void {
    const cap = level === 'Low' ? 0.85 : level === 'Medium' ? 1.25 : level === 'High' ? 1.75 : 2;
    this.pixelCap = isMobileGpu() ? Math.min(cap, 1.5) : cap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelCap));
    this.resize();
  }

  private resetWorld(): void {
    this.pred.reset();
    this.knownUsers.clear(); // a new room: everyone in it is new again (friend-join toasts)
    for (let i = 0; i < MAX_CARS; i += 1) this.dropCar(i);
    this.bloxity.updateRoom(this.net.roomId);
  }

  private myPlayer(): NetPlayer | null {
    const s = this.net.state;
    if (!s) return null;
    return s.players.get(this.net.sessionId) ?? null;
  }

  private toggleBallCam(): void {
    this.rig.ballCam = !this.rig.ballCam;
    this.hud.setBallCam(this.rig.ballCam);
    this.sfx.click();
  }

  private showBoard(on: boolean): void {
    this.boardOn = on;
    const s = this.net.state;
    const players: NetPlayer[] = [];
    s?.players.forEach((p) => players.push(p));
    this.hud.showBoard(on, players, this.net.sessionId);
  }

  private chatOpen = false;

  private quickChat(i: number): void {
    if (!this.chatEnabled) return;
    this.net.send(MessageType.QuickChat, i);
    if (this.chatOpen) {
      this.chatOpen = false;
      this.hud.toggleChat(false);
    }
  }

  // ------------------------------------------------------------------ messages

  private onGoal(m: GoalMessage): void {
    this.lastGoal = m;
    this.hud.goal(m);
    this.hud.feedGoal(m);
    const mine = this.myPlayer();
    this.sfx.goal(!!mine && mine.team === m.team);
    this.hype = 1;
    this.cheerT = 3;
    this.cheerTeam = m.team;
    const b = this.pred.pred.ball.pos;
    const gy = Math.sign(m.side) * (ARENA.halfY + 200);
    this.effects.goal(Math.max(-800, Math.min(800, b.x)) * S, Math.max(1, Math.min(5.5, b.z * S)), -gy * S, TEAM_COLORS[m.team]!);
    this.goalPulse[m.side > 0 ? 1 : 0] = 1;
    this.rig.kick(0.8);
  }

  private onFeed(m: FeedMessage): void {
    if (m.kind === 'chat' && !this.chatEnabled) return; // the portal's enable_chat is off
    const s = this.net.state;
    const teamOf = (name: string): number => {
      let t = 0;
      s?.players.forEach((p) => {
        if (p.name === name) t = p.team;
      });
      return t;
    };
    this.hud.feedLine(m, teamOf);
    if (m.kind === 'save' || m.kind === 'shot') this.hype = Math.max(this.hype, m.kind === 'save' ? 0.6 : 0.4);
  }

  // ------------------------------------------------------------------ tick

  private tick(): void {
    const s = this.net.state;
    const me = this.myPlayer();
    if (s) {
      this.pred.phase = s.match.phase;
      this.pred.phaseEnd = s.match.phaseEnd;
      if ((s.match.arena ?? 0) !== this.arenaIndex) this.setArena(s.match.arena ?? 0);
    }
    this.pred.localSlot = me ? me.car : -1;
    const w = this.pred.pred;
    const car = this.pred.localSlot >= 0 ? w.cars[this.pred.localSlot] : undefined;
    this.controls.enabled = !this.results && !this.garage.open;
    this.controls.read(this.input, !!car && !car.onGround);
    const seq = this.pred.step(this.input);
    this.packet[0] = seq;
    this.packet[1] = 1;
    packInput(this.input, this.packet, 2);
    this.net.sendInputs(this.packet);
    this.handleEvents();
  }

  private handleEvents(): void {
    const w = this.pred.pred;
    const local = this.pred.localSlot;
    const cam = this.rig.camera.position;
    const camSim = this.v.d.set(cam.x / S, -cam.z / S, cam.y / S);
    const distTo = (x: number, y: number, z: number): number => Math.hypot(x - camSim.x, y - camSim.y, z - camSim.z);
    for (let k = 0; k < w.eventCount; k += 1) {
      const e = w.events[k]!;
      const d = distTo(e.x, e.y, e.z);
      const tx = e.x * S;
      const ty = e.z * S;
      const tz = -e.y * S;
      switch (e.kind) {
        case EventKind.BallHit: {
          this.ball.hit(e.value);
          this.sfx.ballHit(e.value, d);
          if (e.value > 900) this.effects.impact(tx, ty, tz, e.value, e.value > 2200 ? 0xffffff : 0x9ff3ff);
          if (e.car === local) this.rig.kick(Math.min(0.5, e.value / 5000));
          break;
        }
        case EventKind.Bump:
          this.sfx.bump(d);
          this.effects.impact(tx, ty, tz, e.value);
          if (e.car === local || e.other === local) this.rig.kick(0.5);
          break;
        case EventKind.Demo:
          this.sfx.demo(d);
          this.effects.demo(tx, ty, tz);
          if (e.other === local) this.rig.kick(1);
          break;
        case EventKind.Pad:
          if (e.car === local) this.sfx.pad(e.value > 0);
          for (let i = 0; i < (e.value > 0 ? 24 : 8); i += 1) {
            this.effects.spark(tx + (Math.random() - 0.5) * 1.5, 0.2, tz + (Math.random() - 0.5) * 1.5, 0, 2 + Math.random() * 3, 0, 0xffc040, 0.12, 0.5 + Math.random() * 0.3);
          }
          break;
        case EventKind.Jump:
        case EventKind.DoubleJump:
          this.sfx.jump(d);
          if (e.kind === EventKind.Jump) for (let i = 0; i < 8; i += 1) this.effects.smoke(tx, ty - 0.3, tz, (Math.random() - 0.5) * 2, 0.4, (Math.random() - 0.5) * 2, 0xbfc7b0, 0.5, 0.6);
          break;
        case EventKind.Dodge:
          this.sfx.dodge(d);
          break;
        case EventKind.BallBounce:
          this.sfx.bounce(e.value, d);
          break;
        case EventKind.CarWall:
          this.sfx.wall(e.value, d);
          if (e.value > 1000) this.effects.impact(tx, ty, tz, e.value * 0.5);
          break;
        case EventKind.Land:
          this.sfx.land(d);
          break;
      }
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK_DT && n < 6) {
      this.tick();
      this.acc -= TICK_DT;
      n += 1;
    }
    if (n >= 6) this.acc = 0;
    this.alpha = this.acc / TICK_DT;
    for (const a of this.controls.takeActions()) this.action(a);
    this.render(dt);
  }

  private action(a: string): void {
    if (a === 'ballcam') this.toggleBallCam();
    else if (a === 'scoreboard-on') this.showBoard(true);
    else if (a === 'scoreboard-off') this.showBoard(false);
    else if (a === 'help') this.hud.toggleHelp();
    else if (a === 'garage') {
      if (this.garage.open) this.garage.close();
      else this.openGarage();
    }
    else if (a === 'menu') this.bloxity.showPortalMenu(false);
    else if (a === 'switch-team') this.net.send(MessageType.SwitchTeam, 1);
    else if (a.startsWith('chat:')) this.quickChat(Number(a.slice(5)));
  }

  /** A car view and its floor shadow, ready to drive (from the pool when there is one). */
  private makeMeta(team: number, body: number): CarMeta {
    const view = new CarView(team, body);
    const shadow = new Mesh(SHADOW_GEO, SHADOW_MAT);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 2;
    return { view, shadow, lookKey: '', nameKey: '', lastVel: new Vector3(), lateral: 0, surge: 0, trailT: 0 };
  }

  private ensureCar(i: number, team: number, body: number): CarMeta {
    // our slot became known after our car first appeared: swap in the view already in our look
    if (i === this.pred.localSlot && this.mine && this.cars[i] && this.cars[i] !== this.mine && !this.cars.includes(this.mine)) this.dropCar(i);
    let m = this.cars[i];
    if (!m) {
      // from the warm pool (built, dressed and compiled before the match): nothing new mid-intro -
      // and our own car is the one already wearing our look
      const mine = i === this.pred.localSlot && this.mine && !this.cars.includes(this.mine) ? this.mine : null;
      m = mine ?? this.carPool.pop() ?? this.makeMeta(team, body);
      m.nameKey = '';
      m.lastVel.set(0, 0, 0);
      m.lateral = m.surge = m.trailT = 0;
      m.view.root.visible = true;
      this.scene.add(m.view.root, m.shadow);
      this.cars[i] = m;
    }
    m.view.setTeam(team);
    m.view.setModel(body);
    return m;
  }

  private dropCar(i: number): void {
    const m = this.cars[i];
    if (!m) return;
    this.cars[i] = null;
    m.view.root.removeFromParent();
    m.shadow.removeFromParent();
    // keep it for the next car (or the next match): a pooled view is already built and compiled
    if (m === this.mine) return; // kept dressed for the next match
    if (this.carPool.length < POOL_SIZE * 2) this.carPool.push(m);
    else m.view.dispose();
  }

  private syncPlayers(): void {
    this.bySlot.fill(null);
    const s = this.net.state;
    if (!s) return;
    s.players.forEach((p) => {
      if (p.car >= 0 && p.car < MAX_CARS) this.bySlot[p.car] = p;
      // friend toasts: tell the portal who is here (verified handles only)
      if (p.username && !this.knownUsers.has(p.username) && p.id !== this.net.sessionId) {
        if (this.knownUsers.size === 0) this.bloxity.playerInRoom(p.username);
        else this.bloxity.playerJoined(p.username);
        this.knownUsers.add(p.username);
      }
    });
  }

  private render(dt: number): void {
    this.syncPlayers();
    const s = this.net.state;
    const phase = s?.match.phase ?? Phase.Countdown;
    const w = this.pred.pred;
    const local = this.pred.localSlot;
    this.pred.decay(dt);

    // phase transitions
    if (phase !== this.lastPhase) this.onPhase(phase);

    const replaying = this.replay.active;
    if (replaying) this.replay.advance(dt);
    if (replaying && !this.replay.sample(this.replayCars, this.v.a)) this.replay.stop();
    const useReplay = this.replay.active;

    // cars
    this.wheels.begin();
    const camPos = this.rig.camera.position;
    for (let i = 0; i < MAX_CARS; i += 1) {
      let active: boolean;
      let demolished: boolean;
      let team: number;
      let boosting: boolean;
      let supersonic: boolean;
      let speed: number;
      let onGround = true;
      let handbrake = 0;
      const c = w.cars[i]!;
      const p = this.pose;
      if (useReplay) {
        const o = i * REPLAY_CAR_FIELDS;
        const f = this.replayCars;
        active = f[o]! > 0;
        demolished = f[o + 1]! > 0;
        team = f[o + 2]!;
        boosting = f[o + 3]! > 0;
        supersonic = f[o + 4]! > 0;
        p.px = f[o + 5]!;
        p.py = f[o + 6]!;
        p.pz = f[o + 7]!;
        p.qx = f[o + 8]!;
        p.qy = f[o + 9]!;
        p.qz = f[o + 10]!;
        p.qw = f[o + 11]!;
        speed = f[o + 12]!;
        onGround = p.pz < 60;
      } else {
        active = c.active;
        demolished = c.demolished;
        team = c.team;
        boosting = c.boosting;
        supersonic = c.supersonic;
        this.pred.carPose(i, this.alpha, p);
        forwardOf(this.v.c, c.quat as never);
        speed = c.vel.x * this.v.c.x + c.vel.y * this.v.c.y + c.vel.z * this.v.c.z;
        onGround = c.wheels >= 2;
        handbrake = c.handbrake;
      }
      if (!active) {
        if (this.cars[i]) this.dropCar(i);
        continue;
      }
      const m = this.ensureCar(i, team, this.bySlot[i]?.body ?? 0);
      const view = m.view;
      view.root.visible = !demolished;
      m.shadow.visible = !demolished;
      if (demolished) continue;
      view.root.position.set(p.px * S, p.pz * S, -p.py * S);
      quatToThree(view.root.quaternion, p.qx, p.qy, p.qz, p.qw);

      // who
      const player = this.bySlot[i];
      const name = player?.name || (player?.bot ? 'Bot' : 'Player');
      const nameKey = `${name}|${team}|${player?.bot ? 1 : 0}`;
      if (nameKey !== m.nameKey) {
        m.nameKey = nameKey;
        view.setName(name, !!player?.bot);
      }
      if (player) {
        const look = player.bot ? { appearance: botAppearance(i, player.id), proportions: DEFAULT_PROPORTIONS } : lookFromState(player.avatar as never);
        const key = JSON.stringify(look);
        // one avatar re-dress per frame (a lobby of players joining at once never lands in one frame),
        // and none but our own during the intro's flight - their outfits arrive once it has landed
        if (key !== m.lookKey && !this.dressedThisFrame && (i === local || performance.now() > this.introUntil)) {
          m.lookKey = key;
          this.dressedThisFrame = true;
          view.setLook(look.appearance, look.proportions);
        }
      } else if (!m.lookKey) {
        m.lookKey = 'default';
        view.setLook(DEFAULT_APPEARANCE, DEFAULT_PROPORTIONS);
      }
      view.showName = i !== local || useReplay;

      // rider motion from accelerations (local frame)
      const vel = this.v.b.set(c.vel.x, c.vel.y, c.vel.z);
      if (dt > 0) {
        forwardOf(this.v.c, c.quat as never);
        const ax = (vel.x - m.lastVel.x) / dt;
        const ay = (vel.y - m.lastVel.y) / dt;
        const surge = (ax * this.v.c.x + ay * this.v.c.y) / 1000;
        const lat = (-ax * this.v.c.y + ay * this.v.c.x) / 1000;
        m.surge += (surge - m.surge) * Math.min(1, dt * 6);
        m.lateral += (lat - m.lateral) * Math.min(1, dt * 6);
      }
      m.lastVel.copy(vel);
      const ballPos = useReplay ? this.v.a : w.ball.pos;
      const toBall = Math.atan2(ballPos.y - p.py, ballPos.x - p.px);
      forwardOf(this.v.c, { x: p.qx, y: p.qy, z: p.qz, w: p.qw } as never);
      let look = toBall - Math.atan2(this.v.c.y, this.v.c.x);
      while (look > Math.PI) look -= Math.PI * 2;
      while (look < -Math.PI) look += Math.PI * 2;
      const cheering = this.cheerT > 0 && team === this.cheerTeam;
      const inp = i === local ? this.input : this.pred.meta.inputs[i]!;
      const camD = camPos.distanceTo(view.root.position);
      view.update(
        dt,
        speed,
        useReplay ? 0 : inp.steer,
        boosting,
        onGround,
        this.wheels,
        { steer: useReplay ? 0 : inp.steer, lateral: m.lateral, surge: m.surge, boosting, airborne: !onGround, look, cheer: cheering ? Math.min(1, this.cheerT) : 0, ...this.emoteOf(i, player ?? undefined, useReplay) },
        camD,
      );

      // shadow on the floor under the car
      const h = p.pz;
      m.shadow.visible = h < 900;
      m.shadow.position.set(p.px * S, 0.015, -p.py * S);
      const sz = 1 + h * 0.0006;
      m.shadow.scale.set(sz, sz, 1);
      m.shadow.rotation.z = Math.atan2(2 * (p.qw * p.qz + p.qx * p.qy), 1 - 2 * (p.qy * p.qy + p.qz * p.qz));
      (m.shadow.material as MeshBasicMaterial).opacity = Math.max(0, 1 - h / 900);

      // trails: boost, supersonic, powerslide smoke
      m.trailT += dt;
      if (camD < 140 && m.trailT > 1 / 45) {
        m.trailT = 0;
        const nozzle = this.v.c.set(-0.72, -CAR.rideHeight * S + 0.3, 0).applyQuaternion(view.root.quaternion).add(view.root.position);
        const back = this.v.d.set(-1, 0, 0).applyQuaternion(view.root.quaternion);
        if (boosting) {
          for (let k = 0; k < 2; k += 1) {
            this.effects.spark(nozzle.x, nozzle.y, nozzle.z, back.x * 6 + (Math.random() - 0.5) * 1.2, back.y * 6 + Math.random() * 0.6, back.z * 6 + (Math.random() - 0.5) * 1.2, k ? 0xff6a1a : 0xffd27a, 0.065, 0.28, 0, 2);
          }
          this.effects.smoke(nozzle.x, nozzle.y, nozzle.z, back.x * 2, 0.3, back.z * 2, 0x9aa0ad, 0.09, 0.45);
        }
        if (supersonic) {
          this.effects.spark(nozzle.x, nozzle.y + 0.05, nozzle.z, 0, 0, 0, team === 0 ? 0xbfe2ff : 0xffe2bf, 0.1, 0.45);
        }
        if (handbrake > 0.4 && onGround && Math.abs(m.lateral) > 0.4) {
          for (const side of [-0.42, 0.42]) {
            const t = this.v.d.set(-0.36, -CAR.rideHeight * S + 0.02, side).applyQuaternion(view.root.quaternion).add(view.root.position);
            this.effects.smoke(t.x, t.y, t.z, 0, 0.6, 0, 0xd8dccf, 0.22, 0.8);
          }
        }
      }
    }
    this.wheels.end();

    // ball
    const hideBall = !useReplay && (phase === Phase.Goal || phase === Phase.Replay || phase === Phase.Ended);
    if (useReplay) {
      this.ball.place(this.v.a.x, this.v.a.y, this.v.a.z, dt);
      if (this.replay.exploded && this.lastGoal && !this.replayBoomDone) {
        this.replayBoomDone = true;
        this.effects.goal(this.v.a.x * S, this.v.a.z * S, -this.v.a.y * S, TEAM_COLORS[this.lastGoal.team]!);
        this.sfx.goal(false);
      }
      this.ball.setVisible(!this.replay.exploded);
    } else {
      this.pred.ballPose(this.alpha, this.pose);
      this.ball.place(this.pose.px, this.pose.py, this.pose.pz, dt);
      this.ball.setVisible(!hideBall);
    }
    const lt = w.ball.lastTouchTeam;
    this.ball.update(dt, lt >= 0 ? TEAM_COLORS[lt]! : null);

    // arena
    this.goalPulse[0] = Math.max(0, this.goalPulse[0] - dt * 0.6);
    this.goalPulse[1] = Math.max(0, this.goalPulse[1] - dt * 0.6);
    this.hype = Math.max(0, this.hype - dt * 0.25);
    this.cheerT = Math.max(0, this.cheerT - dt);
    // near-goal tension
    const by = Math.abs(w.ball.pos.y);
    const tension = by > ARENA.halfY - 1500 ? 0.25 : 0;
    this.arena.update(dt, w.pads, this.goalPulse, Math.max(this.hype, tension));
    this.effects.update(dt);

    this.updateCamera(dt, phase, useReplay);
    this.updateHud(phase);

    // the nearest other cars' engines, panned to where they are on screen
    this.heard.length = 0;
    if (!useReplay) {
      const cam = this.rig.camera;
      cam.getWorldDirection(this.v.d);
      const rx = -this.v.d.z;
      const rz = this.v.d.x;
      const rl = Math.hypot(rx, rz) || 1;
      for (let i = 0; i < MAX_CARS; i += 1) {
        const c = w.cars[i]!;
        if (i === local || !c.active || c.demolished) continue;
        const dx = c.pos.x * S - cam.position.x;
        const dz = -c.pos.y * S - cam.position.z;
        const dist = Math.hypot(dx, c.pos.z * S - cam.position.y, dz) / S;
        this.heard.push({ distance: dist, pan: (dx * rx + dz * rz) / rl / Math.max(1, Math.hypot(dx, dz)), speed: Math.hypot(c.vel.x, c.vel.y, c.vel.z), boosting: c.boosting });
      }
      this.heard.sort((a, b) => a.distance - b.distance);
    }
    this.sfx.others(this.heard.slice(0, 3));

    // engine audio for the local car
    const lc = local >= 0 ? w.cars[local] : undefined;
    if (lc && lc.active && !lc.demolished && !useReplay) {
      const sp = Math.hypot(lc.vel.x, lc.vel.y, lc.vel.z);
      this.sfx.drive(sp, this.input.throttle, lc.boosting, lc.onGround, lc.supersonic, this.hype);
      this.hud.supersonic(lc.supersonic);
    } else {
      this.sfx.drive(0, 0, false, true, false, this.hype);
      this.hud.supersonic(false);
    }

    if (this.garage.open) this.garage.render(this.renderer, dt);
    else if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.rig.camera);
    this.dressedThisFrame = false;
    this.fpsN += 1;
    this.fpsT += dt;
    if (this.fpsT > 0.5) {
      this.fps = this.fpsN / this.fpsT;
      this.fpsN = 0;
      this.fpsT = 0;
      const info = this.renderer.info.render;
      this.hud.setStats(this.showFps ? `${this.fps.toFixed(0)} fps · ${Math.round(this.net.rtt)} ms · lead ${this.pred.lead}t · corr ${this.pred.lastLocalCorrection.toFixed(0)}uu · ${info.calls} draws` : null);
    }
  }

  private replayBoomDone = false;

  private onPhase(phase: number): void {
    const prev = this.lastPhase;
    this.lastPhase = phase;
    if (phase === Phase.Replay && this.lastGoal) {
      this.replay.start(this.lastGoal.tick, this.lastGoal.side);
      this.replayBoomDone = false;
      this.hud.replay(true);
      this.rig.setMode('replay');
    } else {
      if (prev === Phase.Replay) this.hud.replay(false);
      this.replay.stop();
    }
    if (phase === Phase.Goal) this.rig.setMode('goal');
    if (phase === Phase.Countdown) {
      this.results = null;
      this.hud.showResults(null, '', 0, 0);
      this.rig.setMode('car');
      const me = this.pred.localSlot;
      const c = me >= 0 ? this.pred.pred.cars[me] : undefined;
      if (c) {
        forwardOf(this.v.c, c.quat as never);
        this.rig.snapBehind(this.rig.ballCam ? Math.atan2(-c.pos.y, -c.pos.x) : Math.atan2(this.v.c.y, this.v.c.x));
      }
      this.lastSeenGo = false;
    }
    if (phase === Phase.Ended) this.rig.setMode('overview');
    // the music comes up over the results, and back under the engine for the next kickoff
    if (phase === Phase.Ended && this.inMatch) this.sfx.setMusicMode('results', 2);
    if (phase === Phase.Countdown && prev === Phase.Ended && this.inMatch) this.sfx.setMusicMode('match');
    if (phase === Phase.Play && prev === Phase.Countdown) this.rig.setMode('car');
    // results over, a new match: back in gameplay for the portal (gameplayEnd was sent at the final whistle)
    if (prev === Phase.Ended && phase !== Phase.Ended) this.bloxity.gameplayStart();
  }

  /** Lighting, fog, sky colour, reflections and bloom for the arena's theme. */
  private applyLook(): void {
    const theme = this.arena.theme;
    const look = LOOKS[theme];
    const scene = this.scene;
    scene.background = new Color(look.background);
    const fog = scene.fog as Fog;
    fog.color.set(look.fog[0]);
    fog.near = look.fog[1];
    fog.far = look.fog[2];
    this.hemi.color.set(look.hemi[0]);
    this.hemi.groundColor.set(look.hemi[1]);
    this.hemi.intensity = look.hemi[2];
    this.ambient.intensity = look.ambient;
    this.sun.color.set(look.sun[0]);
    this.sun.intensity = look.sun[1];
    this.sun.position.set(look.sun[2], look.sun[3], look.sun[4]);
    let env = this.envs.get(theme);
    if (!env) {
      env = look.env(this.renderer);
      this.envs.set(theme, env);
    }
    scene.environment = env;
    if (this.bloom) this.bloom.strength = look.bloom;
    this.renderer.toneMappingExposure = look.exposure;
  }

  /** Swap the arena's look (the server moved on to another arena). Physics is untouched - every arena has one shape. */
  private setArena(index: number): void {
    this.arenaIndex = index;
    const theme = themeOf(index);
    if (theme === this.arena.theme) return;
    this.scene.remove(this.arena.root);
    this.arena.dispose();
    this.arena = new ArenaView(theme);
    this.scene.add(this.arena.root);
    this.applyLook();
  }

  private readonly social: SocialPanel;
  private chatEnabled = true;

  /** Friends (with presence) and the Bux balance, for the signed-in user. */
  private async loadSocial(): Promise<void> {
    if (!this.bloxity.getUser()) return;
    const [friends, bux] = await Promise.all([this.bloxity.getFriends(), this.bloxity.getBuxBalance()]);
    const user = this.bloxity.getUser();
    if (!user) return;
    this.social.setAccount({ name: user.displayName || user.username, pfp: user.pfp ?? '', bux });
    this.social.setFriends(
      friends.map((f) => {
        const raw = f.presence?.status ?? 'offline';
        return {
          id: f._id,
          name: f.displayName || f.username,
          pfp: f.pfp ?? '',
          status: raw === 'in_game' ? 'in-game' : raw,
          game: f.presence?.gameName || f.presence?.gameSlug || '',
        };
      }),
    );
  }

  private async onSocial(a: SocialAction): Promise<void> {
    if (a.kind === 'login') {
      await this.bloxity.showAuthPopup(); // onUserChanged fires on success and fills the panel
    } else if (a.kind === 'refresh') {
      await this.loadSocial();
    } else if (a.kind === 'invite') {
      const ok = await this.bloxity.inviteFriend(a.id, this.net.roomId);
      this.social.setNote(ok ? 'Invite sent.' : 'Could not send the invite.');
    } else if (a.kind === 'link') {
      const link = this.bloxity.getInviteLink(this.net.roomId);
      try {
        await navigator.clipboard.writeText(link);
        this.social.setNote('Invite link copied.');
      } catch {
        this.social.setNote(link || 'No invite link available.');
      }
    }
  }

  /** The local player's emote, shown at once and kept until the server's echo takes over. */
  private localEmote: { id: string; at: number } | null = null;

  /**
   * The portal sent an emote (its own picker; this game draws no emote UI). Play it on our own
   * driver straight away and ask the server to replicate it. Unknown ids simply never play; this
   * is cosmetic and can never throw into a frame.
   */
  private playEmote(id: string): void {
    if (!this.inMatch) {
      this.lobbyEmote?.(id);
      return;
    }
    try {
      if (!isBloxityEmoteId(id) || this.pred.localSlot < 0) return;
      this.localEmote = { id: id.toLowerCase(), at: performance.now() };
      this.net.send(MessageType.Emote, { id } satisfies EmoteMessage);
    } catch {
      /* cosmetic */
    }
  }

  /** Which emote car `i`'s driver plays and how far in: replicated (id, start tick), or our optimistic start. */
  private emoteOf(i: number, player: { emote?: string; emoteTick?: number } | undefined, replay: boolean): { emote: string; emoteTime: number } {
    if (replay) return { emote: '', emoteTime: 0 };
    if (i === this.pred.localSlot && this.localEmote) {
      const mine = this.localEmote;
      const age = (performance.now() - mine.at) / 1000;
      // until the echo arrives (or for 1.5 s, if the server refused it)
      if (player?.emote !== mine.id && age < 1.5) return { emote: mine.id, emoteTime: age };
      this.localEmote = null;
    }
    if (!player?.emote) return { emote: '', emoteTime: 0 };
    return { emote: player.emote, emoteTime: Math.max(0, (this.pred.auth.tick - (player.emoteTick ?? 0)) / TICK_RATE) };
  }

  /** Dev: a fixed camera (sim uu) for screenshots. */
  debugCam: { pos: [number, number, number]; at: [number, number, number]; fov?: number } | null = null;

  private updateCamera(dt: number, phase: number, useReplay: boolean): void {
    const w = this.pred.pred;
    if (this.debugCam) {
      const d = this.debugCam;
      this.rig.shot(dt, this.v.b.set(...d.pos), this.v.c.set(...d.at), d.fov ?? 90);
      return;
    }
    const local = this.pred.localSlot;
    const c = local >= 0 ? w.cars[local] : undefined;
    if (useReplay) {
      const pos = this.v.b;
      const at = this.v.c;
      const fov = this.replay.camera(dt, this.v.a, pos, at);
      this.rig.shot(dt, pos, at, fov);
      return;
    }
    if (phase === Phase.Goal && this.lastGoal) {
      this.rig.goal(dt, this.lastGoal.side, this.v.b.set(w.ball.pos.x, w.ball.pos.y, w.ball.pos.z));
      return;
    }
    if (phase === Phase.Ended || !c || !c.active || !this.revealed) {
      // overview: a slow orbit high over the pitch, watching the ball (also the intro's wide shot,
      // held while the match settles behind the MATCH FOUND card)
      if (this.rig.mode !== 'overview') this.rig.setMode('overview');
      const t = performance.now() / 1000;
      const pos = this.v.b.set(Math.cos(t * 0.07) * 3800, Math.sin(t * 0.07) * 5200, 1500);
      const at = this.v.c.set(w.ball.pos.x * 0.5, w.ball.pos.y * 0.5, 100);
      this.rig.shot(dt, pos, at, 90);
      return;
    }
    if (this.rig.mode !== 'car') {
      // first sight of our car after joining: a slow, eased flight from the wide shot into the car
      if (this.introPending) this.introUntil = performance.now() + INTRO_SECONDS * 1000 + 250;
      this.rig.setMode('car', this.introPending ? INTRO_SECONDS : undefined);
      this.introPending = false;
    }
    if (c.demolished) {
      // watch the ball from where you died
      const pos = this.v.b.set(c.pos.x, c.pos.y, Math.max(300, c.pos.z + 300));
      this.rig.shot(dt, pos, this.v.c.set(w.ball.pos.x, w.ball.pos.y, w.ball.pos.z), 100);
      return;
    }
    this.pred.carPose(local, this.alpha, this.pose);
    const p = this.carPoseCam.copy(this.pose);
    const carPos = this.v.a.set(p.px, p.py, p.pz);
    forwardOf(this.v.d, { x: p.qx, y: p.qy, z: p.qz, w: p.qw } as never);
    this.pred.ballPose(this.alpha, this.pose);
    const ball = this.v.b.set(this.pose.px, this.pose.py, this.pose.pz);
    const vel = this.v.c.set(c.vel.x, c.vel.y, c.vel.z);
    const speed = vel.length();
    const ballVisible = phase === Phase.Play || phase === Phase.Countdown;
    const up = this.camUp;
    upOf(up, { x: p.qx, y: p.qy, z: p.qz, w: p.qw } as never);
    this.rig.follow(dt, carPos, this.v.d, up, vel, ballVisible ? ball : null, speed, c.boosting, c.wheels >= 3);
  }

  private updateHud(phase: number): void {
    const s = this.net.state;
    const w = this.pred.pred;
    if (!s) return;
    const m = s.match;
    const now = this.pred.hasSnapshot ? w.tick : 0;
    let clock = m.clock;
    if (m.clockRunning) clock = m.overtime ? m.clock + (now - m.clockTick) / TICK_RATE : m.clock - (now - m.clockTick) / TICK_RATE;
    this.hud.score(m.blue, m.orange, Math.max(0, clock), m.overtime, this.myPlayer()?.team ?? 0);
    {
      const t = Math.max(0, m.overtime ? Math.floor(clock) : Math.ceil(clock));
      this.arena.setScoreboard(m.blue, m.orange, `${m.overtime ? '+' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    }
    const local = this.pred.localSlot;
    const c = local >= 0 ? w.cars[local] : undefined;
    this.hud.boost(c?.boost ?? 0, !!c && c.active && phase !== Phase.Ended && !this.replay.active, c ? Math.hypot(c.vel.x, c.vel.y, c.vel.z) : 0);
    // countdown
    if (phase === Phase.Countdown && m.phaseEnd === 0) {
      // a playlist waiting for its players: no numbers yet
      this.hud.countdown(null);
    } else if (phase === Phase.Countdown) {
      const left = (m.phaseEnd - now) / TICK_RATE;
      const n = left > 0 ? Math.min(3, Math.ceil(left)) : 0;
      if (this.hud.countdown(n)) this.sfx.countdown(n);
      if (n === 0) this.lastSeenGo = true;
    } else if (phase === Phase.Play && !this.lastSeenGo && this.lastPhase === Phase.Play) {
      this.lastSeenGo = true;
      if (this.hud.countdown(0)) this.sfx.countdown(0);
      window.setTimeout(() => this.hud.countdown(null), 700);
    } else {
      this.hud.countdown(null);
    }
    // match-intro banner on the first kickoff
    const blueNames: string[] = [];
    const orangeNames: string[] = [];
    s.players.forEach((p) => {
      if (p.car < 0) return;
      (p.team === 0 ? blueNames : orangeNames).push(p.name);
    });
    this.hud.showVs(phase === Phase.Countdown && m.blue + m.orange === 0, blueNames.slice(0, 4).join(' · '), orangeNames.slice(0, 4).join(' · '));
    // results
    if (phase === Phase.Ended && this.results) {
      const me = this.myPlayer();
      const left = (m.phaseEnd - now) / TICK_RATE;
      if (!this.resultsShown) {
        this.resultsShown = true;
        this.hud.showResults(this.results, this.net.sessionId, me?.team ?? 0, left);
      }
      this.hud.resultsCountdown(left);
    } else if (this.resultsShown) {
      this.resultsShown = false;
      this.hud.showResults(null, '', 0, 0);
    }
    if (this.boardOn) this.showBoard(true);
  }

  private resultsShown = false;
}
