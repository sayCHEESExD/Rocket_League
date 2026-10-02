import { QUICK_CHATS, TEAMS, type FeedMessage, type GoalMessage, type MatchEndMessage } from '@rlb/shared';
import type { NetPlayer } from '../net/Net.js';

const CSS = `
.hud{position:fixed;inset:0;pointer-events:none;z-index:10;font-family:"Titillium Web","Fredoka",system-ui,sans-serif;color:#fff;
  text-shadow:0 2px 4px rgba(0,0,0,.55);-webkit-user-select:none;user-select:none}
.hud *{box-sizing:border-box}
.sb{position:absolute;top:calc(env(safe-area-inset-top,0px) + 6px);left:50%;transform:translateX(-50%);display:flex;align-items:stretch;height:46px;
  filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))}
.sb .team{width:50px;display:grid;place-items:center;font-family:"Orbitron",sans-serif;font-weight:500;font-size:30px;line-height:1;color:#fff;
  text-shadow:0 0 8px rgba(255,255,255,.45);border:2px solid rgba(255,255,255,.35)}
.sb .t0{background:linear-gradient(180deg,#4f8dff 0%,#2a64e6 55%,#1b4cc2 100%)}
.sb .t1{background:linear-gradient(180deg,#ff9a3c 0%,#f07112 55%,#c95606 100%)}
.sb .clock{min-width:118px;padding:0 12px;display:grid;place-items:center;background:linear-gradient(180deg,rgba(40,42,58,.88),rgba(14,15,24,.88));
  font-family:"Orbitron",sans-serif;font-weight:400;font-size:27px;letter-spacing:.04em;color:#f2f4ff;border-top:2px solid rgba(255,255,255,.18);border-bottom:2px solid rgba(255,255,255,.18);
  text-shadow:0 0 8px rgba(200,220,255,.35)}
.sb .clock.ot{color:#ffe27a}
.sb .clock.low{color:#ff8f8f}
.boost{position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);bottom:calc(env(safe-area-inset-bottom,0px) + 10px);width:184px;height:184px}
.boost svg{position:absolute;inset:0;overflow:visible}
.keys{position:absolute;right:calc(env(safe-area-inset-right,0px) + 200px);bottom:calc(env(safe-area-inset-bottom,0px) + 30px);display:flex;flex-direction:column;gap:7px;font-family:"Titillium Web",sans-serif;pointer-events:none}
.keys .kc{display:flex;align-items:center;gap:8px;justify-content:flex-end;font-weight:700;font-size:12px;letter-spacing:.12em;color:rgba(255,255,255,.8)}
.keys .kc b{min-width:58px;padding:3px 9px;text-align:center;font-weight:900;font-size:12px;letter-spacing:.08em;color:#fff;border-radius:5px;
  background:linear-gradient(180deg,rgba(60,63,72,.88),rgba(18,19,24,.88));border:1px solid rgba(255,255,255,.3);box-shadow:0 2px 0 rgba(0,0,0,.55);transition:background .08s,transform .08s}
.keys .kc.on b{background:linear-gradient(180deg,#ffb04a,#f7941d);border-color:#ffd08a;transform:translateY(2px);box-shadow:0 0 10px rgba(247,148,29,.7)}
.touch .keys{display:none}
.boost .num{position:absolute;left:0;right:0;top:66px;text-align:center;font-family:"Orbitron",sans-serif;font-weight:700;font-size:44px;line-height:1;letter-spacing:.02em;
  color:rgba(255,255,255,.1);-webkit-text-stroke:2px #fff;text-shadow:0 0 6px rgba(255,255,255,.35)}
.boost.full .num{text-shadow:0 0 10px rgba(255,255,255,.6)}
.boost .lbl{position:absolute;left:0;right:0;top:113px;text-align:center;font-family:"Titillium Web",sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;color:rgba(255,255,255,.85)}
.touch .boost{right:calc(env(safe-area-inset-right,0px) + 4px);bottom:auto;top:calc(50% - 100px);width:128px;height:128px}
.touch .boost .num{top:46px;font-size:30px;-webkit-text-stroke:1.5px #fff}
.touch .boost .lbl{top:79px;font-size:9px}
.touch .feed{top:calc(env(safe-area-inset-top,0px) + 6px)}
.touch .feed .row:nth-child(n+3){display:none}
.touch .feed .nm{font-size:11px;padding:3px 8px;min-width:90px}
.touch .feed .ic{width:22px;font-size:12px}
.big{position:absolute;left:0;right:0;top:30%;text-align:center;font-weight:900;font-style:italic;letter-spacing:.02em;opacity:0;transform:scale(.6);
  transition:opacity .18s,transform .25s cubic-bezier(.2,1.6,.4,1)}
.big.on{opacity:1;transform:scale(1)}
.cd{font-family:"Orbitron",sans-serif;font-weight:500;font-style:normal;font-size:130px;line-height:1;color:transparent;-webkit-text-stroke:3px #fff;
  text-shadow:0 0 22px rgba(255,255,255,.5)}
.goalbox{position:absolute;left:0;right:0;top:27%;text-align:center;opacity:0;visibility:hidden}
.goalbox.on{opacity:1;visibility:visible;animation:goalIn .5s cubic-bezier(.2,1.4,.4,1) both}
@keyframes goalIn{from{opacity:0;transform:scale(1.35)}to{opacity:1;transform:none}}
.goalbox .g{font-family:"Orbitron",sans-serif;font-weight:500;font-size:58px;line-height:1;letter-spacing:.03em;color:transparent;-webkit-text-stroke:2px #ffb04a;
  text-shadow:0 0 14px rgba(255,150,40,.85),0 0 32px rgba(255,110,20,.45);white-space:nowrap}
.goalbox .sub{font-family:"Orbitron",sans-serif;font-weight:500;font-size:15px;letter-spacing:.14em;color:#ffd9a8;margin-top:12px;text-shadow:0 0 8px rgba(255,140,40,.6)}
.feed{position:absolute;right:calc(env(safe-area-inset-right,0px) + 12px);top:calc(env(safe-area-inset-top,0px) + 10px);display:flex;flex-direction:column;gap:5px;align-items:flex-end}
.feed .row{display:flex;align-items:stretch;gap:3px;animation:fin .25s ease-out;font-family:"Titillium Web",sans-serif}
.feed .nm{min-width:120px;padding:4px 12px;font-weight:900;font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:#fff;text-align:center;
  border:1px solid rgba(255,255,255,.45);text-shadow:0 1px 2px rgba(0,0,0,.6)}
.feed .nm.t0{background:linear-gradient(180deg,#3f82ff,#1d52c8)}
.feed .nm.t1{background:linear-gradient(180deg,#ff8e2e,#d75f08)}
.feed .nm.n{background:rgba(14,16,28,.78)}
.feed .ic{width:28px;display:grid;place-items:center;background:rgba(14,16,28,.82);border:1px solid rgba(255,255,255,.35);font-size:15px}
.feed .tx{padding:4px 10px;background:rgba(14,16,28,.72);font-weight:700;font-size:14px;color:#fff}
.banner{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 78px);transform:translateX(-50%);padding:6px 22px;font-weight:900;font-size:22px;letter-spacing:.3em;
  background:linear-gradient(90deg,rgba(255,40,80,0),rgba(255,40,80,.85),rgba(255,40,80,0));display:none}
.banner.on{display:block;animation:blink 1s steps(2) infinite}
@keyframes blink{50%{opacity:.55}}
.hint{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 64px);transform:translateX(-50%);font-weight:700;font-size:14px;opacity:.85;
  background:rgba(10,14,30,.5);padding:4px 12px;border-radius:4px;white-space:nowrap}
.touch .hint{display:none}
.status{position:absolute;left:50%;top:45%;transform:translateX(-50%);font-weight:900;font-size:26px;display:none;background:rgba(10,14,30,.7);padding:10px 22px;border-radius:6px}
.status.on{display:block}
.sup{position:absolute;inset:0;opacity:0;transition:opacity .25s;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(170,230,255,.18) 80%,rgba(255,255,255,.28));}
.sup.on{opacity:1}
.panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:min(720px,94vw);max-height:86vh;overflow:auto;padding:18px 20px;border-radius:10px;
  background:linear-gradient(180deg,rgba(18,24,46,var(--panel-a,.95)),rgba(8,12,26,var(--panel-a,.95)));box-shadow:0 20px 50px rgba(0,0,0,.5);display:none;pointer-events:auto}
.panel.on{display:block}
.panel h2{margin:0 0 10px;font-weight:900;font-size:28px;font-style:italic;letter-spacing:.04em;text-align:center}
.panel table{width:100%;border-collapse:collapse;font-size:15px}
.panel th{font-size:11px;letter-spacing:.14em;opacity:.7;text-align:right;padding:4px 8px}
.panel th:first-child,.panel td:first-child{text-align:left}
.panel td{padding:6px 8px;text-align:right;font-weight:700}
.panel tr.t0 td{background:rgba(47,123,255,.22)}
.panel tr.t1 td{background:rgba(255,138,31,.22)}
.panel tr.t0 td:first-child{box-shadow:inset 5px 0 0 #2f7bff;color:#a9cbff}
.panel tr.t1 td:first-child{box-shadow:inset 5px 0 0 #ff8a1f;color:#ffcf9c}
.panel tr.me td{outline:2px solid rgba(255,255,255,.6);outline-offset:-2px}
.panel .tname{font-weight:900;font-size:13px;letter-spacing:.2em;padding:10px 8px 4px}
.panel .mvp{color:#ffd65a;font-size:12px;font-weight:900;margin-left:6px}
.fin{position:absolute;inset:0;display:none;pointer-events:none;--tc:#ff8a1f;--tl:#ffc07a}
.fin.on{display:block}
.hud.fin-on .sb,.hud.fin-on .ballcam,.hud.fin-on .hint,.hud.fin-on .vs,.hud.fin-on .topbtns{display:none}
.fin-shade{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 42%,rgba(0,0,0,.05) 25%,rgba(0,0,0,.5));transition:opacity .6s}
.fin.pod .fin-shade{background:linear-gradient(180deg,rgba(4,6,14,.7),rgba(4,6,14,0) 15%)}
.fin-flash{position:absolute;inset:0;background:#fff;opacity:0}
.fin.pod .fin-flash{animation:finFlash .7s ease-out}
@keyframes finFlash{0%{opacity:.85}100%{opacity:0}}
.fin-title{position:absolute;left:50%;top:22%;transform:translateX(-50%);text-align:center;transform-origin:50% 0;
  transition:top .7s cubic-bezier(.2,.8,.2,1),transform .7s cubic-bezier(.2,.8,.2,1);animation:finIn .9s cubic-bezier(.2,.8,.2,1)}
@keyframes finIn{0%{opacity:0;transform:translateX(-50%) scale(1.25);filter:blur(6px)}100%{opacity:1;transform:translateX(-50%) scale(1);filter:none}}
.fin.pod .fin-title{top:calc(env(safe-area-inset-top,0px) + 4px);transform:translateX(-50%) scale(.34)}
.fin.pod .fin-trophy{display:none}
.fin-trophy{width:clamp(56px,9vw,104px);height:auto;display:block;margin:0 auto -4px;opacity:.88;filter:drop-shadow(0 0 14px var(--tc))}
.fin-trophy text{font-family:"Titillium Web",sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;fill:#fff}
.fin-w{font-family:"Titillium Web",sans-serif;font-weight:400;font-size:clamp(20px,3vw,38px);letter-spacing:.12em;color:var(--tl);text-shadow:0 0 12px var(--tc)}
.fin-t{font-family:"Orbitron",sans-serif;font-weight:400;font-size:clamp(56px,11vw,150px);line-height:1;letter-spacing:.06em;color:rgba(255,255,255,.04);
  -webkit-text-stroke:2px var(--tl);filter:drop-shadow(0 0 10px var(--tc)) drop-shadow(0 0 26px var(--tc))}
.fin-tag{position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:4px;opacity:0;animation:finUp .5s .35s ease-out forwards}
.fin-tag .nm{font-family:"Titillium Web",sans-serif;font-weight:900;font-size:clamp(12px,1.6vw,20px);letter-spacing:.04em;color:#fff;padding:3px 16px;border-radius:999px;
  background:linear-gradient(180deg,var(--c1),var(--c2));box-shadow:0 0 0 2px rgba(255,255,255,.25),0 4px 14px rgba(0,0,0,.5);white-space:nowrap;max-width:24vw;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase}
.fin-tag .mvp{font-family:"Orbitron",sans-serif;font-weight:700;font-size:clamp(11px,1.3vw,16px);color:#ffd65a;letter-spacing:.14em;padding:6px 10px 4px;border:2px solid #ffd65a;
  border-radius:50% 50% 46% 46%/60% 60% 40% 40%;text-shadow:0 0 8px rgba(255,200,60,.8);box-shadow:0 0 14px rgba(255,200,60,.45)}
.fin-card{position:absolute;transform:translateX(-50%);width:min(230px,23vw);font-family:"Titillium Web",sans-serif;text-align:center;opacity:0;animation:finUp .5s .55s ease-out forwards}
.fin-card .row{display:flex;align-items:center;gap:8px;padding:5px 8px;background:linear-gradient(90deg,rgba(8,12,26,.85),rgba(20,26,48,.7));border-left:4px solid var(--c1);border-radius:3px}
.fin-card .em{flex:none;width:clamp(22px,2.6vw,34px);height:clamp(22px,2.6vw,34px);display:grid;place-items:center;border-radius:4px;font-weight:900;font-size:clamp(12px,1.4vw,18px);color:#fff;
  background:linear-gradient(135deg,var(--c1),var(--c2))}
.fin-card .who{min-width:0;flex:1;text-align:left;font-weight:700;font-size:clamp(11px,1.25vw,15px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fin-card .who small{display:block;font-size:.72em;opacity:.65;letter-spacing:.08em}
.fin-card .ti{margin-top:6px;font-weight:900;font-size:clamp(10px,1.1vw,14px);letter-spacing:.14em;color:#fff;text-shadow:0 1px 3px #000}
.fin-card .su{font-weight:600;font-size:clamp(9px,.95vw,12px);color:rgba(255,255,255,.75);text-shadow:0 1px 3px #000}
@keyframes finUp{0%{opacity:0;margin-top:12px}100%{opacity:1;margin-top:0}}
.fin-foot{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);transform:translateX(-50%);display:flex;align-items:center;gap:16px;
  font-family:"Titillium Web",sans-serif;font-weight:700;font-size:15px;letter-spacing:.06em;white-space:nowrap;background:rgba(8,12,26,.6);padding:5px 16px;border-radius:999px}
.fin-foot .sc{font-family:"Orbitron",sans-serif;font-size:18px}
.fin-foot .nx{font-family:"Orbitron",sans-serif}
.touch .fin-foot{bottom:auto;top:calc(env(safe-area-inset-top,0px) + 8px);right:calc(env(safe-area-inset-right,0px) + 8px);left:auto;transform:none;font-size:12px}
.help .grid{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;font-size:15px}
.help .k{font-weight:900;color:#9fd3ff;text-align:right}
.chatbar{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 50px);transform:translateX(-50%);display:flex;gap:6px;flex-wrap:wrap;justify-content:center;
  max-width:70vw;pointer-events:auto}
.chatbar button{all:unset;cursor:pointer;padding:6px 10px;border-radius:5px;background:rgba(10,14,30,.75);font-weight:700;font-size:13px;border:1px solid rgba(255,255,255,.25)}
.chatbar button:hover{background:rgba(47,123,255,.6)}
.topbtns{position:absolute;left:calc(env(safe-area-inset-left,0px) + 12px);bottom:calc(env(safe-area-inset-bottom,0px) + 26px);display:flex;gap:6px;pointer-events:auto}
.topbtns button{all:unset;cursor:pointer;padding:5px 9px;border-radius:5px;background:rgba(10,14,30,.66);font-weight:700;font-size:12px;letter-spacing:.08em;text-align:center;border:1px solid rgba(255,255,255,.2)}
.touch .topbtns{display:none}
.topbtns .acct{background:rgba(47,123,255,.8);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ballcam{position:absolute;left:calc(env(safe-area-inset-left,0px) + 22px);bottom:calc(env(safe-area-inset-bottom,0px) + 66px);font-family:"Titillium Web",sans-serif}
.ballcam .t{font-weight:700;font-size:21px;letter-spacing:.08em;color:#fff;display:flex;align-items:center;gap:8px}
.ballcam .t i{width:11px;height:11px;border-radius:50%;background:#ff3b3b;box-shadow:0 0 8px #ff3b3b}
.ballcam.off .t i{background:#7a7f8c;box-shadow:none}
.ballcam .p{font-weight:700;font-size:11px;letter-spacing:.12em;opacity:.75;margin-top:1px}
.touch .ballcam{display:none}
.touch .ballcam .t{font-size:12px;justify-content:center}
.touch .ballcam .p{display:none}
.stats{position:absolute;left:calc(env(safe-area-inset-left,0px) + 10px);bottom:calc(env(safe-area-inset-bottom,0px) + 8px);font-size:11px;opacity:.7;font-family:ui-monospace,monospace;display:none}
.stats.on{display:block}
.vs{position:absolute;left:50%;top:18%;transform:translateX(-50%);display:flex;gap:18px;align-items:center;font-weight:900;font-style:italic;font-size:30px;opacity:0;transition:opacity .3s}
.vs.on{opacity:1}
.vs .b{color:#7fb4ff}.vs .o{color:#ffc07a}
@media (max-height:520px){.sb .team{width:50px;font-size:30px}.sb .clock{min-width:96px;font-size:26px}.cd{font-size:110px}.goalbox .g{font-size:34px}.goalbox .sub{font-size:11px}.feed{width:220px}.feed .row{font-size:12px}}
`;

const fmtClock = (s: number, overtime: boolean): string => {
  const t = Math.max(0, overtime ? Math.floor(s) : Math.ceil(s));
  const m = Math.floor(t / 60);
  const r = t % 60;
  return `${overtime ? '+' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
};

/** One car on the end-of-match podium: the player's numbers and where the car is on screen (px). */
export interface PodiumCard {
  id: string;
  name: string;
  team: number;
  mvp: boolean;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
  x: number;
  top: number;
  bottom: number;
}

/** Up to two Rocket League-style titles for a player's match ("STRIKER / 2 Goals"). */
const podiumTitles = (r: PodiumCard): [string, string][] => {
  const n = (v: number, s: string): string => `${v} ${s}${v === 1 ? '' : 's'}`;
  const t: [string, string][] = [];
  if (r.goals >= 3) t.push(['HAT TRICK', n(r.goals, 'Goal')]);
  else if (r.goals) t.push(['STRIKER', n(r.goals, 'Goal')]);
  if (r.assists) t.push(['PLAYMAKER', n(r.assists, 'Assist')]);
  if (r.saves) t.push([r.saves >= 3 ? 'SAVIOR' : 'GUARDIAN', n(r.saves, 'Save')]);
  if (r.demos) t.push(['EXECUTIONER', n(r.demos, 'Demolition')]);
  if (r.shots >= 2) t.push(['SHARPSHOOTER', `${n(r.shots, 'Shot')} on Goal`]);
  if (!t.length) t.push(['TEAM PLAYER', '']);
  return t.slice(0, 2);
};

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The whole DOM HUD. Pure presentation: it is told what to show. */
export class Hud {
  readonly root = document.createElement('div');
  private readonly blue: HTMLElement;
  private readonly orange: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly boostWrap: HTMLElement;
  private readonly ticks: SVGPathElement[] = [];
  private readonly speedBars: SVGPathElement[] = [];
  private litTicks = -1;
  private litSpeed = -1;
  private myTeam = 0;
  private readonly boostNum: HTMLElement;
  private readonly cd: HTMLElement;
  private readonly goalBox: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly status: HTMLElement;
  private readonly sup: HTMLElement;
  private readonly board: HTMLElement;
  private readonly results: HTMLElement;
  private readonly help: HTMLElement;
  private readonly ballcam: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly vs: HTMLElement;
  private readonly chatbar: HTMLElement;
  private lastCd = -99;
  private goalTimer = 0;
  private resultsNext = 0;
  onChat: ((i: number) => void) | null = null;
  onButton: ((what: 'ballcam' | 'scores' | 'help' | 'team' | 'garage' | 'social' | 'lobby') => void) | null = null;
  /** The results screen's countdown line: "Next match in" (open rooms) or "Back to lobby in" (playlists). */
  resultsLabel = 'Next match in';

  constructor(touch: boolean) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.className = `hud${touch ? ' touch' : ''}`;
    this.root.innerHTML = `
      <div class="sup"></div>
      <div class="sb"><div class="team l t0">0</div><div class="clock">5:00</div><div class="team r t1">0</div></div>
      <div class="banner">REPLAY</div>
      <div class="vs"><span class="b">BLUE</span><span>VS</span><span class="o">ORANGE</span></div>
      <div class="feed"></div>
      <div class="big cd"></div>
      <div class="goalbox"><div class="g"></div><div class="sub"></div></div>
      <div class="boost"><svg viewBox="0 0 200 200">
          <defs><radialGradient id="bfill" cx="42%" cy="38%" r="68%"><stop offset="0" stop-color="#4a4d55" stop-opacity=".92"/><stop offset=".55" stop-color="#25272d" stop-opacity=".9"/><stop offset="1" stop-color="#0c0d10" stop-opacity=".88"/></radialGradient></defs>
          <circle cx="100" cy="100" r="64" fill="url(#bfill)"/>
          <circle cx="100" cy="100" r="64" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.2"/>
          <g class="ticks"></g><g class="speed"></g>
        </svg><div class="num">33</div><div class="lbl">BOOST</div></div>
      <div class="keys"><div class="kc" data-k="jump">JUMP<b>SPACE</b></div><div class="kc" data-k="boost">BOOST<b>SHIFT</b></div></div>
      <div class="ballcam"><div class="t"><i></i><span>BALL CAM</span></div><div class="p">PRESS (F) TO TOGGLE</div></div>
      <div class="topbtns"><button data-b="social" class="acct">LOG IN</button><button data-b="garage">GARAGE (G)</button><button data-b="scores">SCORES (TAB)</button><button data-b="help">CONTROLS (H)</button><button data-b="team">SWITCH TEAM (T)</button><button data-b="lobby">LOBBY (L)</button></div>
      <div class="hint">W/S drive · A/D steer · SPACE jump · SHIFT boost · C powerslide · F ball cam · H help</div>
      <div class="status"></div>
      <div class="panel board"></div>
      <div class="fin"></div>
      <div class="panel help"><h2>CONTROLS</h2><div class="grid">
        <div class="k">W / S</div><div>Drive / reverse · in the air: pitch (nose down / up)</div>
        <div class="k">A / D</div><div>Steer · in the air: yaw</div>
        <div class="k">SPACE / Right click</div><div>Jump · again in the air: double jump · with a direction: flip / dodge</div>
        <div class="k">SHIFT / Left click</div><div>Boost</div>
        <div class="k">C (hold)</div><div>Powerslide · in the air: A/D roll</div>
        <div class="k">Q / E</div><div>Air roll left / right</div>
        <div class="k">F</div><div>Ball cam on / off</div>
        <div class="k">TAB</div><div>Scoreboard</div>
        <div class="k">1 - 8</div><div>Quick chat</div>
        <div class="k">T</div><div>Switch team (when fair)</div>
        <div class="k">G</div><div>Garage: choose your car</div>
        <div class="k">L</div><div>Leave the match, back to the lobby</div>
        <div class="k">Gamepad</div><div>RT/LT drive · stick steer/air · A jump · B boost · X powerslide/air roll · LB/RB roll · Y ball cam</div>
        <div class="k">Touch</div><div>Stick: steer + drive (air: pitch/yaw/flip direction) · JUMP · BOOST · DRIFT (powerslide / air roll) · CAM</div>
      </div></div>
      <div class="stats"></div>
      <div class="chatbar" style="display:none"></div>`;
    document.body.appendChild(this.root);
    const q = <T extends Element>(sel: string): T => this.root.querySelector(sel) as T;
    this.blue = q('.sb .l');
    this.orange = q('.sb .r');
    this.clock = q('.sb .clock');
    this.boostWrap = q('.boost');
    // THE DIAL (reference): boost bars rise from the bottom round the left to the top, growing
    // longer as they go; the speed bars carry on from the top towards two o'clock.
    const bar = (g: SVGGElement, a0: number, a1: number, r0: number, len: number): SVGPathElement => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const pt = (ang: number, r: number): string => `${(100 + Math.cos(ang) * r).toFixed(2)},${(100 + Math.sin(ang) * r).toFixed(2)}`;
      p.setAttribute('d', `M${pt(a0, r0)}L${pt(a0, r0 + len)}L${pt(a1, r0 + len)}L${pt(a1, r0)}Z`);
      p.setAttribute('stroke-width', '0.8');
      g.appendChild(p);
      return p;
    };
    const tg = q<SVGGElement>('.boost .ticks');
    const BOOST_BARS = 34;
    const from = (102 * Math.PI) / 180;
    const to = (268 * Math.PI) / 180;
    const step = (to - from) / BOOST_BARS;
    for (let i = 0; i < BOOST_BARS; i += 1) {
      const k = i / (BOOST_BARS - 1);
      this.ticks.push(bar(tg, from + i * step + step * 0.16, from + (i + 1) * step - step * 0.16, 68, 5 + k * 15));
    }
    const sg = q<SVGGElement>('.boost .speed');
    const SPEED_BARS = 10;
    const s0 = (274 * Math.PI) / 180;
    const s1 = (338 * Math.PI) / 180;
    const sstep = (s1 - s0) / SPEED_BARS;
    for (let i = 0; i < SPEED_BARS; i += 1) {
      this.speedBars.push(bar(sg, s0 + i * sstep + sstep * 0.18, s0 + (i + 1) * sstep - sstep * 0.18, 68, 20 - (i / SPEED_BARS) * 6));
    }
    this.boostNum = q('.boost .num');
    this.cd = q('.cd');
    this.goalBox = q('.goalbox');
    this.feed = q('.feed');
    this.banner = q('.banner');
    this.hint = q('.hint');
    this.status = q('.status');
    this.sup = q('.sup');
    this.board = q('.board');
    this.results = q('.fin');
    this.help = q('.help');
    this.ballcam = q('.ballcam');
    this.stats = q('.stats');
    this.vs = q('.vs');
    this.chatbar = q('.chatbar');
    this.root.querySelectorAll<HTMLButtonElement>('.topbtns button').forEach((b) => {
      b.addEventListener('click', () => this.onButton?.(b.dataset['b'] as 'ballcam' | 'scores' | 'help' | 'team' | 'garage' | 'social' | 'lobby'));
    });
    QUICK_CHATS.forEach((text, i) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', () => this.onChat?.(i));
      this.chatbar.appendChild(b);
    });
    window.setTimeout(() => (this.hint.style.opacity = '0'), 14000);
    this.help.addEventListener('click', () => this.toggleHelp(false));
  }

  /** The scoreboard puts YOUR team on the left, like the reference. */
  score(blue: number, orange: number, clock: number, overtime: boolean, myTeam = 0): void {
    if (myTeam !== this.myTeam) {
      this.myTeam = myTeam;
      this.blue.className = `team l t${myTeam}`;
      this.orange.className = `team r t${1 - myTeam}`;
    }
    const left = String(myTeam === 0 ? blue : orange);
    const right = String(myTeam === 0 ? orange : blue);
    if (this.blue.textContent !== left) this.blue.textContent = left;
    if (this.orange.textContent !== right) this.orange.textContent = right;
    const c = fmtClock(clock, overtime);
    if (this.clock.textContent !== c) this.clock.textContent = c;
    this.clock.classList.toggle('ot', overtime);
    this.clock.classList.toggle('low', !overtime && clock <= 30);
  }

  /** PC key hints beside the dial (hidden on touch): SPACE jump, SHIFT boost, lit while held. */
  keys(visible: boolean, jump: boolean, boost: boolean): void {
    const k = (this.keyHints ??= this.root.querySelector('.keys') as HTMLElement);
    k.style.display = visible ? '' : 'none';
    k.children[0]!.classList.toggle('on', jump);
    k.children[1]!.classList.toggle('on', boost);
  }
  private keyHints: HTMLElement | undefined;

  /** The dial: boost (0..100) on the orange bars and in the number, speed (uu/s) on the white bars. */
  boost(amount: number, visible: boolean, speed = 0): void {
    this.boostWrap.style.display = visible ? '' : 'none';
    const v = Math.round(amount);
    const lit = Math.round((Math.max(0, Math.min(100, amount)) / 100) * this.ticks.length);
    if (lit !== this.litTicks) {
      this.litTicks = lit;
      this.ticks.forEach((t, i) => {
        const on = i < lit;
        t.setAttribute('fill', on ? '#f7941d' : 'rgba(20,20,24,.45)');
        t.setAttribute('stroke', on ? 'rgba(255,190,90,.9)' : 'rgba(255,255,255,.28)');
      });
    }
    const sl = Math.round(Math.min(1, speed / 2300) * this.speedBars.length);
    if (sl !== this.litSpeed) {
      this.litSpeed = sl;
      this.speedBars.forEach((t, i) => {
        const on = i < sl;
        t.setAttribute('fill', on ? '#f4f6fa' : 'rgba(20,20,24,.4)');
        t.setAttribute('stroke', on ? 'rgba(160,165,175,.9)' : 'rgba(255,255,255,.28)');
      });
    }
    const s = String(v);
    if (this.boostNum.textContent !== s) this.boostNum.textContent = s;
    this.boostWrap.classList.toggle('full', v >= 100);
  }

  setBallCam(on: boolean): void {
    (this.ballcam.querySelector('span') as HTMLElement).textContent = on ? 'BALL CAM' : 'CAR CAM';
    this.ballcam.classList.toggle('off', !on);
  }

  /** Countdown: 3, 2, 1, then GO (n = 0) briefly. Returns true when the number changed. */
  countdown(n: number | null): boolean {
    if (n === null) {
      if (this.lastCd !== -99 && this.lastCd !== 0) this.cd.classList.remove('on');
      if (this.lastCd === 0) {
        // GO lingers a moment
        window.setTimeout(() => this.cd.classList.remove('on'), 650);
      }
      const changed = this.lastCd !== -99;
      this.lastCd = -99;
      return changed && false;
    }
    if (n === this.lastCd) return false;
    this.lastCd = n;
    this.cd.textContent = n > 0 ? String(n) : 'GO!';
    this.cd.style.webkitTextStroke = n > 0 ? '3px #ffffff' : '3px #7dff9a';
    this.cd.classList.remove('on');
    void this.cd.offsetWidth;
    this.cd.classList.add('on');
    return true;
  }

  showVs(on: boolean, blueNames: string, orangeNames: string): void {
    this.vs.classList.toggle('on', on);
    if (on) this.vs.innerHTML = `<span class="b">${esc(blueNames || 'BLUE')}</span><span>VS</span><span class="o">${esc(orangeNames || 'ORANGE')}</span>`;
  }

  goal(m: GoalMessage): void {
    const team = TEAMS[m.team]!;
    const who = (m.scorer || team.name).toUpperCase();
    const g = this.goalBox.querySelector('.g') as HTMLElement;
    g.textContent = m.ownGoal ? `${who} OWN GOAL!` : `${who} SCORED!`;
    const parts = [m.assist ? `ASSIST: ${m.assist.toUpperCase()}` : '', `${Math.round(m.speed * 0.036)} KM/H`].filter(Boolean);
    (this.goalBox.querySelector('.sub') as HTMLElement).textContent = parts.join('   ·   ');
    this.goalBox.classList.remove('on');
    void this.goalBox.offsetWidth;
    this.goalBox.classList.add('on');
    window.clearTimeout(this.goalTimer);
    this.goalTimer = window.setTimeout(() => this.goalBox.classList.remove('on'), 3000);
  }

  private static readonly ICON: Record<string, string> = { goal: '⚽', save: '🛡', shot: '◎', demo: '💥', epic: '★', assist: '➶' };

  /** A feed row like the reference: the player in a team-coloured box, the event as an icon. */
  feedLine(m: FeedMessage, teamOf: (name: string) => number): void {
    const row = document.createElement('div');
    row.className = 'row';
    const box = (name: string, team: number): string => `<span class="nm t${team}">${esc(name)}</span>`;
    if (m.kind === 'demo') row.innerHTML = `${box(m.a, teamOf(m.a))}<span class="ic">${Hud.ICON['demo']}</span>${box(m.b, teamOf(m.b))}`;
    else if (m.kind === 'chat') row.innerHTML = `${box(m.a, Number(m.b))}<span class="tx">${esc(m.text)}</span>`;
    else if (m.kind === 'epic') row.innerHTML = `<span class="nm n">${esc(m.text)}</span><span class="ic">${Hud.ICON['epic']}</span>`;
    else row.innerHTML = `${box(m.a, teamOf(m.a))}<span class="ic" title="${esc(m.text)}">${Hud.ICON[m.kind] ?? '•'}</span>`;
    this.push(row, 6000);
  }

  /** Goals go in the feed too (assister, then scorer). */
  feedGoal(m: GoalMessage): void {
    if (m.assist) {
      const a = document.createElement('div');
      a.className = 'row';
      a.innerHTML = `<span class="nm t${m.team}">${esc(m.assist)}</span><span class="ic">${Hud.ICON['assist']}</span>`;
      this.push(a, 7000);
    }
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="nm t${m.team}">${esc(m.scorer || TEAMS[m.team]!.name)}</span><span class="ic">${Hud.ICON['goal']}</span>`;
    this.push(row, 7000);
  }

  private push(row: HTMLElement, ms: number): void {
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    window.setTimeout(() => row.remove(), ms);
  }

  replay(on: boolean): void {
    this.banner.classList.toggle('on', on);
  }

  supersonic(on: boolean): void {
    this.sup.classList.toggle('on', on);
  }

  setStatus(text: string | null): void {
    this.status.classList.toggle('on', !!text);
    if (text) this.status.textContent = text;
  }

  setStats(text: string | null): void {
    this.stats.classList.toggle('on', !!text);
    if (text) this.stats.textContent = text;
  }

  toggleHelp(on?: boolean): void {
    this.help.classList.toggle('on', on);
  }

  toggleChat(on: boolean): void {
    this.chatbar.style.display = on ? 'flex' : 'none';
  }

  private table(players: NetPlayer[], me: string, mvp: string): string {
    let html = '';
    for (const team of [0, 1]) {
      const rows = players.filter((p) => p.team === team && p.car >= 0).sort((a, b) => b.score - a.score);
      html += `<tr><td colspan="7" class="tname" style="color:${TEAMS[team]!.light}">${TEAMS[team]!.name}</td></tr>`;
      for (const p of rows) {
        html += `<tr class="t${team}${p.id === me ? ' me' : ''}"><td>${esc(p.name || 'Player')}${p.id === mvp ? '<span class="mvp">MVP</span>' : ''}</td>
          <td>${p.score}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.saves}</td><td>${p.shots}</td><td>${p.ping || ''}</td></tr>`;
      }
    }
    return `<table><tr><th>PLAYER</th><th>SCORE</th><th>GOALS</th><th>ASSISTS</th><th>SAVES</th><th>SHOTS</th><th>PING</th></tr>${html}</table>`;
  }

  /** The account chip: the signed-in name, or LOG IN for a guest. */
  setAccountChip(name: string | null): void {
    const chip = this.root.querySelector<HTMLElement>('.acct');
    if (chip) chip.textContent = name ? name.toUpperCase() : 'LOG IN';
  }

  showBoard(on: boolean, players: NetPlayer[], me: string): void {
    this.board.classList.toggle('on', on);
    if (on) this.board.innerHTML = `<h2>SCOREBOARD</h2>${this.table(players, me, '')}`;
  }

  /**
   * THE FINISH (Rocket League's end screens, user reference): first "WINNER" over the
   * team name in thin glowing outline letters under a trophy, then (`finishPodium`) the
   * title shrinks to the top and the winners' cars get a name banner above and a card
   * with their titles below. TAB still opens the full scoreboard.
   */
  showResults(m: MatchEndMessage | null, _me: string, myTeam: number, seconds: number): void {
    this.root.classList.toggle('fin-on', !!m);
    this.podiumKey = '';
    if (!m) {
      this.results.className = 'fin';
      this.results.innerHTML = '';
      return;
    }
    const team = m.winner >= 0 ? TEAMS[m.winner]! : null;
    this.results.className = 'fin on';
    this.results.style.setProperty('--tc', team?.color ?? '#9fb6ff');
    this.results.style.setProperty('--tl', team?.light ?? '#e6ecff');
    const label = !team ? 'DRAW' : m.winner === myTeam ? 'VICTORY' : 'DEFEAT';
    this.results.innerHTML = `<div class="fin-shade"></div><div class="fin-flash"></div>
      <div class="fin-title">
        <svg class="fin-trophy" viewBox="0 0 100 124"><path fill="var(--tc)" d="M22 8h56v10h14c0 22-10 34-24 38-4 9-9 14-12 16v14h12l4 16H28l4-16h12V72c-3-2-8-7-12-16C18 52 8 40 8 18h14zm0 18H17c1 12 6 19 9 21-2-6-4-13-4-21zm56 0c0 8-2 15-4 21 3-2 8-9 9-21z"/>
          <path fill="rgba(10,10,14,.75)" d="m50 18 6 13 14 1-11 9 4 14-13-8-13 8 4-14-11-9 14-1z"/><text x="50" y="121" text-anchor="middle">${label}</text></svg>
        <div class="fin-w">${team ? 'WINNER' : 'MATCH OVER'}</div><div class="fin-t">${team ? team.name : 'DRAW'}</div>
      </div>
      <div class="fin-pod"></div>
      <div class="fin-foot"><span class="sc"><span style="color:${TEAMS[0].light}">${m.blue}</span> - <span style="color:${TEAMS[1].light}">${m.orange}</span></span>
        <span>${this.resultsLabel} <b class="nx">${Math.ceil(seconds)}</b></span></div>`;
    this.resultsNext = seconds;
  }

  private podiumKey = '';

  /** The podium stage: banners and cards at the screen positions of the winners' cars (called every frame). */
  finishPodium(cards: PodiumCard[]): void {
    const pod = this.results.querySelector<HTMLElement>('.fin-pod');
    if (!pod) return;
    const key = cards.map((c) => c.id).join('|');
    if (key !== this.podiumKey) {
      this.podiumKey = key;
      this.results.classList.add('pod');
      pod.innerHTML = cards
        .map((c) => {
          const t = TEAMS[c.team]!;
          const vars = `--c1:${t.color};--c2:${t.dark}`;
          const titles = podiumTitles(c)
            .map(([a, b]) => `<div class="ti">${a}</div><div class="su">${b}</div>`)
            .join('');
          return `<div class="fin-tag" style="${vars}">${c.mvp ? '<div class="mvp">MVP</div>' : ''}<div class="nm">${esc(c.name || 'Player')}</div></div>
            <div class="fin-card" style="${vars}"><div class="row"><div class="em">${esc((c.name || 'P').charAt(0).toUpperCase())}</div>
            <div class="who">${esc(c.name || 'Player')}<small>${c.score} POINTS</small></div></div>${titles}</div>`;
        })
        .join('');
    }
    const tags = pod.querySelectorAll<HTMLElement>('.fin-tag');
    const boxes = pod.querySelectorAll<HTMLElement>('.fin-card');
    cards.forEach((c, i) => {
      const tag = tags[i];
      const box = boxes[i];
      if (tag) {
        tag.style.left = `${c.x}px`;
        tag.style.top = `${c.top}px`;
      }
      if (box) {
        box.style.left = `${c.x}px`;
        box.style.top = `${c.bottom}px`;
      }
    });
  }

  resultsCountdown(seconds: number): void {
    const el = this.results.querySelector('.nx');
    if (el && Math.ceil(seconds) !== Math.ceil(this.resultsNext)) {
      el.textContent = String(Math.max(0, Math.ceil(seconds)));
      this.resultsNext = seconds;
    }
  }

  chatBubble(name: string, index: number, team: number): void {
    this.feedLine({ kind: 'chat', a: name, b: String(team), text: QUICK_CHATS[index] ?? '' }, () => team);
  }
}
