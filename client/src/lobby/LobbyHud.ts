import { ARENAS, MODES, QUICK_CHATS, TEAMS, type MatchFoundMessage } from '@rlb/shared';
import type { QueueView } from './LobbyNet.js';

const CSS = `
.lh{position:fixed;inset:0;pointer-events:none;z-index:15;color:#fff;font-family:"Titillium Web",sans-serif;user-select:none;-webkit-user-select:none}
.lh button{all:unset;cursor:pointer;pointer-events:auto}
.lh .modes{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 16px);display:flex;gap:10px}
.lh .mode{width:168px;padding:10px 12px 9px;border-radius:10px;background:linear-gradient(180deg,rgba(16,22,40,.88),rgba(8,12,24,.9));border:2px solid rgba(255,255,255,.14);
  box-shadow:0 8px 24px rgba(0,0,0,.35);transition:transform .12s,border-color .12s}
.lh .mode:hover{transform:translateY(-3px)}
.lh .mode .l{font-weight:900;font-style:italic;font-size:28px;line-height:1}
.lh .mode .n{font-weight:800;font-size:12px;letter-spacing:.16em;opacity:.85}
.lh .mode .q{font-weight:700;font-size:12px;margin-top:5px;opacity:.85}
.lh .mode.on{border-color:var(--c);box-shadow:0 0 0 2px var(--c),0 8px 30px rgba(0,0,0,.4)}
.lh .mode.on .q{opacity:1;color:var(--c)}
.lh .lbanner{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 12px);transform:translateX(-50%);padding:8px 18px;border-radius:8px;
  background:rgba(8,12,24,.82);font-weight:800;font-size:16px;letter-spacing:.06em;display:none;align-items:center;gap:12px;pointer-events:auto}
.lh .lbanner.on{display:flex}
.lh .lbanner .dot{width:10px;height:10px;border-radius:50%;background:var(--c);animation:lhp 1s infinite}
.lh .lbanner button{padding:4px 10px;border-radius:5px;background:rgba(255,255,255,.14);font-size:12px;letter-spacing:.1em}
@keyframes lhp{50%{opacity:.25}}
.lh .left{position:absolute;left:calc(env(safe-area-inset-left,0px) + 12px);bottom:calc(env(safe-area-inset-bottom,0px) + 18px);display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.lh .btns{display:flex;gap:6px}
.lh .btns button{padding:6px 10px;border-radius:5px;background:rgba(10,14,30,.7);font-weight:700;font-size:12px;letter-spacing:.08em;border:1px solid rgba(255,255,255,.2)}
.lh .lhint{font-size:12px;opacity:.8;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.6)}
.lh .chat{display:none;gap:6px;flex-wrap:wrap;max-width:420px}
.lh .chat.on{display:flex}
.lh .chat button{padding:6px 10px;border-radius:5px;background:rgba(10,14,30,.8);font-weight:700;font-size:13px;border:1px solid rgba(255,255,255,.25)}
.lh .toast{position:absolute;left:50%;top:22%;transform:translateX(-50%);font-weight:900;font-style:italic;font-size:26px;letter-spacing:.04em;text-shadow:0 3px 12px rgba(0,0,0,.6);opacity:0;transition:opacity .3s}
.lh .toast.on{opacity:1}
.lh.leaving > :not(.mf){display:none}
.lh .mf{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 40%,rgba(18,30,64,.9),rgba(3,5,12,.97));
  opacity:0;visibility:hidden;transition:opacity .45s,visibility .45s;pointer-events:auto;z-index:30}
.lh .mf.on{opacity:1;visibility:visible}
.lh .mf .card{text-align:center;min-width:min(640px,92vw)}
.lh .mf .t{font-weight:900;font-style:italic;font-size:64px;line-height:1;letter-spacing:.02em;animation:lhin .5s ease-out}
.lh .mf .m{font-weight:800;font-size:18px;letter-spacing:.24em;margin:10px 0 22px;opacity:.9}
.lh .mf .teams{display:flex;gap:18px;justify-content:center;align-items:stretch}
.lh .mf .team{flex:1;max-width:260px;border-radius:10px;padding:10px 14px;text-align:left}
.lh .mf .team h3{margin:0 0 6px;font-size:13px;letter-spacing:.2em}
.lh .mf .team div{font-weight:800;font-size:17px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lh .mf .mfvs{align-self:center;font-weight:900;font-style:italic;font-size:30px;opacity:.8}
.lh .mf .s{margin-top:22px;font-weight:700;font-size:14px;letter-spacing:.12em;opacity:.8}
.lh .mf .bar{width:240px;height:4px;border-radius:2px;background:rgba(255,255,255,.15);margin:10px auto 0;overflow:hidden}
.lh .mf .bar i{display:block;height:100%;width:40%;background:#7fd0ff;animation:lhbar 1.1s linear infinite}
@keyframes lhbar{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@keyframes lhin{from{transform:scale(.7);opacity:0}to{transform:none;opacity:1}}
.lh .stick{position:absolute;left:0;bottom:0;width:45%;height:65%;pointer-events:auto;touch-action:none;display:none}
.lh .knobbase{position:absolute;width:120px;height:120px;margin:-60px 0 -60px -60px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.06)}
.lh .knob{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,#bcd6ff)}
.lh .jump{position:absolute;right:calc(env(safe-area-inset-right,0px) + 22px);bottom:calc(env(safe-area-inset-bottom,0px) + 110px);width:84px;height:84px;border-radius:50%;
  display:none;place-items:center;font-weight:900;font-size:16px;background:radial-gradient(circle at 35% 30%,#7ff0a8,#1fa85a);border:3px solid rgba(255,255,255,.75);touch-action:none}
@media (max-width:1100px){.lh:not(.touch) .left{bottom:calc(env(safe-area-inset-bottom,0px) + 112px)}}
@media (max-width:900px){.lh .lhint{display:none}}
.lh.touch .stick{display:block}.lh.touch .jump{display:grid}.lh.touch .lhint{display:none}
.lh.touch .mode{width:auto;min-width:92px;padding:7px 10px}.lh.touch .mode .l{font-size:20px}.lh.touch .mode .q{font-size:10px}.lh.touch .mode .n{font-size:9px}
.lh.touch .modes{bottom:calc(env(safe-area-inset-bottom,0px) + 8px)}
.lh.touch .left{bottom:auto;top:calc(env(safe-area-inset-top,0px) + 12px);left:auto;right:calc(env(safe-area-inset-right,0px) + 12px);align-items:flex-end}
`;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The touch stick's reading: x right, y forward, -1..1. */
export interface StickState {
  x: number;
  y: number;
  jump: boolean;
}

/**
 * THE LOBBY'S SCREEN LAYER: the three playlist cards (click = join that queue,
 * the same as stepping on its pad), the "searching" banner with a CANCEL, the
 * GARAGE / SOCIAL / CHAT buttons and the controls hint, the touch stick and
 * JUMP, toasts, and the MATCH FOUND card shown while the match loads. Nothing
 * in the top-left corner (the portal's).
 */
export class LobbyHud {
  readonly root = document.createElement('div');
  readonly stick: StickState = { x: 0, y: 0, jump: false };
  onQueue: ((mode: string) => void) | null = null;
  onButton: ((what: 'garage' | 'social' | 'chat') => void) | null = null;
  onChat: ((index: number) => void) | null = null;
  private readonly cards = new Map<string, HTMLElement>();
  private readonly banner: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly chatEl: HTMLElement;
  private readonly mf: HTMLElement;
  private toastTimer = 0;
  private queueKey = '';

  constructor(touch: boolean) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.className = `lh${touch ? ' touch' : ''}`;
    this.root.innerHTML = `
      <div class="lbanner"><span class="dot"></span><span class="bt"></span><button data-x="cancel">CANCEL</button></div>
      <div class="toast"></div>
      <div class="modes"></div>
      <div class="left">
        <div class="chat"></div>
        <div class="btns"><button data-b="garage">GARAGE (G)</button><button data-b="social">SOCIAL</button><button data-b="chat">CHAT (C)</button></div>
        <div class="lhint">WASD move · SHIFT run · SPACE jump · drag to look · walk onto a pad to play</div>
      </div>
      <div class="stick"><div class="knobbase"><div class="knob"></div></div></div>
      <button class="jump">JUMP</button>
      <div class="mf"><div class="card"></div></div>`;
    this.banner = this.root.querySelector('.lbanner')!;
    this.toastEl = this.root.querySelector('.toast')!;
    this.chatEl = this.root.querySelector('.chat')!;
    this.mf = this.root.querySelector('.mf')!;
    const modes = this.root.querySelector('.modes')!;
    for (const m of MODES) {
      const b = document.createElement('button');
      b.className = 'mode';
      b.style.setProperty('--c', m.color);
      b.innerHTML = `<div class="l" style="color:${m.color}">${m.label}</div><div class="n">${m.name}</div><div class="q"></div>`;
      b.addEventListener('click', () => this.onQueue?.(b.classList.contains('on') ? '' : m.id));
      modes.appendChild(b);
      this.cards.set(m.id, b);
    }
    this.banner.querySelector('button')!.addEventListener('click', () => this.onQueue?.(''));
    this.root.querySelectorAll<HTMLElement>('[data-b]').forEach((b) =>
      b.addEventListener('click', () => this.onButton?.(b.dataset['b'] as 'garage' | 'social' | 'chat')),
    );
    QUICK_CHATS.forEach((text, i) => {
      const b = document.createElement('button');
      b.textContent = `${i + 1}. ${text}`;
      b.addEventListener('click', () => this.onChat?.(i));
      this.chatEl.appendChild(b);
    });
    this.bindStick();
    document.body.appendChild(this.root);
  }

  private bindStick(): void {
    const zone = this.root.querySelector<HTMLElement>('.stick')!;
    const base = this.root.querySelector<HTMLElement>('.knobbase')!;
    const knob = this.root.querySelector<HTMLElement>('.knob')!;
    let id = -1;
    let cx = 0;
    let cy = 0;
    // resting place: anchored to the BOTTOM of the stick zone (its height is 0 before layout,
    // and a top-based position would park the stick in the portal's top-left corner)
    const home = (): void => {
      base.style.left = '110px';
      base.style.top = '';
      base.style.bottom = '40px';
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id >= 0) return;
      id = e.pointerId;
      zone.setPointerCapture?.(e.pointerId);
      const r = zone.getBoundingClientRect();
      cx = e.clientX - r.left;
      cy = e.clientY - r.top;
      base.style.left = `${cx}px`;
      base.style.bottom = '';
      base.style.top = `${cy}px`;
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const r = zone.getBoundingClientRect();
      let dx = e.clientX - r.left - cx;
      let dy = e.clientY - r.top - cy;
      const d = Math.hypot(dx, dy);
      if (d > 50) {
        dx = (dx / d) * 50;
        dy = (dy / d) * 50;
      }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.stick.x = dx / 50;
      this.stick.y = -dy / 50;
    });
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      id = -1;
      knob.style.transform = '';
      this.stick.x = 0;
      this.stick.y = 0;
      home();
    };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    window.setTimeout(home, 0);
    const jump = this.root.querySelector<HTMLElement>('.jump')!;
    jump.addEventListener('pointerdown', (e) => {
      this.stick.jump = true;
      e.preventDefault();
    });
  }

  /** Everything but the MATCH FOUND card goes (the match is coming up under it). */
  leaving(on: boolean): void {
    this.root.classList.toggle('leaving', on);
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  toggleChat(on?: boolean): void {
    this.chatEl.classList.toggle('on', on ?? !this.chatEl.classList.contains('on'));
  }

  /** Queue cards and the banner, from the replicated queues and the player's own queue. */
  setQueues(queues: Map<string, QueueView> | null, mine: string): void {
    const parts: string[] = [mine];
    queues?.forEach((q) => parts.push(`${q.mode}:${q.count}/${q.needed}:${Math.ceil(q.startsIn)}`));
    const key = parts.join('|');
    if (key === this.queueKey) return;
    this.queueKey = key;
    for (const m of MODES) {
      const card = this.cards.get(m.id)!;
      const q = queues?.get(m.id);
      card.classList.toggle('on', m.id === mine);
      const line = !q || q.count === 0 ? 'Nobody queued' : `${q.count}/${q.needed} queued${q.startsIn >= 0 ? ` · ${Math.ceil(q.startsIn)}s` : ''}`;
      card.querySelector('.q')!.textContent = m.id === mine ? `QUEUED · ${line}` : line;
    }
    const mode = MODES.find((m) => m.id === mine);
    this.banner.classList.toggle('on', !!mode);
    if (mode) {
      const q = queues?.get(mode.id);
      this.banner.style.setProperty('--c', mode.color);
      const left = q && q.startsIn >= 0 ? ` · STARTS IN ${Math.ceil(q.startsIn)}` : '';
      this.banner.querySelector('.bt')!.textContent = `SEARCHING ${mode.label} ${mode.name} · ${q?.count ?? 1}/${q?.needed ?? mode.teamSize * 2}${left}`;
    }
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 2200);
  }

  /** The MATCH FOUND card (shown while the match loads); null hides it. */
  matchFound(m: MatchFoundMessage | null, myTeam = 0): void {
    this.mf.classList.toggle('on', !!m);
    if (!m) return;
    const mode = MODES.find((x) => x.id === m.mode);
    const arena = ARENAS[m.arena]?.name ?? '';
    const team = (t: number, names: string[]): string =>
      `<div class="team" style="background:${TEAMS[t]!.dark}cc;box-shadow:inset 0 3px 0 ${TEAMS[t]!.color}">
        <h3 style="color:${TEAMS[t]!.light}">${TEAMS[t]!.name}${t === myTeam ? ' · YOU' : ''}</h3>
        ${names.map((n) => `<div>${esc(n)}</div>`).join('')}</div>`;
    this.mf.querySelector('.card')!.innerHTML = `
      <div class="t">${m.inProgress ? 'JOINING MATCH' : 'MATCH FOUND'}</div>
      <div class="m" style="color:${mode?.color ?? '#fff'}">${mode ? `${mode.label} ${mode.name}` : ''} · ${esc(arena)}</div>
      <div class="teams">${team(0, m.blue)}<div class="mfvs">VS</div>${team(1, m.orange)}</div>
      <div class="s">GETTING READY…</div><div class="bar"><i></i></div>`;
  }

  /** The loading line on the MATCH FOUND card. */
  loading(text: string): void {
    const s = this.mf.querySelector('.s');
    if (s) s.textContent = text.toUpperCase();
  }
}
