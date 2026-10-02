import { PORTRAIT_ORIGIN } from '@rlb/shared';

/** The signed-in Bloxity user as the panel shows them (null: a guest). */
export interface AccountView {
  name: string;
  pfp: string;
  /** Bux balance, or null while unknown / unavailable. */
  bux: number | null;
}

export interface FriendView {
  id: string;
  name: string;
  pfp: string;
  /** 'online' | 'in-game' | 'away' | 'offline' (both in-game spellings are folded). */
  status: string;
  /** What they are playing, when in a game. */
  game: string;
}

export type SocialAction = { kind: 'login' } | { kind: 'invite'; id: string } | { kind: 'link' } | { kind: 'refresh' };

const CSS = `
.social{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,92vw);max-height:80vh;overflow:auto;padding:16px 18px;border-radius:10px;
  background:linear-gradient(180deg,rgba(18,24,46,.96),rgba(8,12,26,.96));box-shadow:0 20px 50px rgba(0,0,0,.5);display:none;pointer-events:auto;font-family:"Titillium Web",sans-serif;z-index:40;color:#fff}
.social.on{display:block}
.social h2{margin:0 0 10px;font-weight:900;font-size:24px;font-style:italic;letter-spacing:.04em}
.social .me{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.06);margin-bottom:12px}
.social .pfp{width:36px;height:36px;border-radius:50%;background:#2a3350 center/cover no-repeat;flex:none}
.social .nm{font-weight:900;font-size:16px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.social .bux{font-weight:900;color:#ffd65a}
.social .sub{font-size:12px;opacity:.7}
.social .fr{display:flex;align-items:center;gap:10px;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,.07)}
.social .dot{width:8px;height:8px;border-radius:50%;background:#59606f;flex:none}
.social .dot.on{background:#3ddc84}.social .dot.game{background:#2f7bff}.social .dot.away{background:#ffb02f}
.social button{all:unset;cursor:pointer;padding:6px 12px;border-radius:5px;background:rgba(47,123,255,.85);font-weight:800;font-size:12px;letter-spacing:.08em}
.social button.ghost{background:rgba(255,255,255,.1)}
.social .row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.social .empty{opacity:.7;font-size:13px;padding:8px 2px}
`;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const portrait = (url: string): string => {
  const u = url.trim();
  if (!u) return '';
  if (/^https:\/\//.test(u)) return u;
  return PORTRAIT_ORIGIN + u.replace(/^\/+/, '');
};

/**
 * THE SOCIAL PANEL: who you are on Bloxity (name, portrait, Bux), your
 * friends with their presence and an INVITE into this room, and a shareable
 * invite link - or, for a guest, a LOG IN button. Opened from the account
 * chip (desktop) or the SOCIAL button (touch); the SDK calls live in Game /
 * Bloxity, this is only the view.
 */
export class SocialPanel {
  readonly root = document.createElement('div');
  onAction: ((a: SocialAction) => void) | null = null;
  private account: AccountView | null = null;
  private friends: FriendView[] = [];
  private note = '';

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.className = 'social';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      const act = b.dataset['act'];
      if (act === 'close') this.show(false);
      else if (act === 'login') this.onAction?.({ kind: 'login' });
      else if (act === 'link') this.onAction?.({ kind: 'link' });
      else if (act === 'invite' && b.dataset['id']) {
        this.onAction?.({ kind: 'invite', id: b.dataset['id'] });
        b.textContent = 'SENT';
      }
    });
  }

  get open(): boolean {
    return this.root.classList.contains('on');
  }

  show(on: boolean): void {
    this.root.classList.toggle('on', on);
    if (on) {
      this.note = '';
      this.render();
      this.onAction?.({ kind: 'refresh' });
    }
  }

  setAccount(account: AccountView | null): void {
    this.account = account;
    if (!account) this.friends = [];
    this.render();
  }

  setFriends(friends: FriendView[]): void {
    this.friends = friends;
    this.render();
  }

  /** A one-line status under the buttons ("Invite link copied"). */
  setNote(text: string): void {
    this.note = text;
    this.render();
  }

  private render(): void {
    if (!this.open) return;
    const a = this.account;
    let html = '<h2>SOCIAL</h2>';
    if (!a) {
      html += `<div class="me"><div class="pfp"></div><div class="nm">Playing as a guest<div class="sub">Log in to keep your Bloxity look, see friends and invite them.</div></div></div>
        <div class="row"><button class="ghost" data-act="close">CLOSE</button><button data-act="login">LOG IN</button></div>`;
      this.root.innerHTML = html;
      return;
    }
    const pfp = portrait(a.pfp);
    html += `<div class="me"><div class="pfp" style="${pfp ? `background-image:url('${esc(pfp)}')` : ''}"></div><div class="nm">${esc(a.name)}</div>${a.bux === null ? '' : `<div class="bux">${a.bux.toLocaleString()} BUX</div>`}</div>`;
    const order = (f: FriendView): number => (f.status === 'in-game' ? 0 : f.status === 'online' ? 1 : f.status === 'away' ? 2 : 3);
    const list = [...this.friends].sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name));
    if (list.length === 0) html += '<div class="empty">No friends to show yet.</div>';
    for (const f of list.slice(0, 40)) {
      const dot = f.status === 'in-game' ? 'game' : f.status === 'online' ? 'on' : f.status === 'away' ? 'away' : '';
      const sub = f.status === 'in-game' ? `Playing ${f.game || 'a game'}` : f.status === 'offline' ? 'Offline' : f.status === 'away' ? 'Away' : 'Online';
      const fp = portrait(f.pfp);
      html += `<div class="fr"><div class="dot ${dot}"></div><div class="pfp" style="width:28px;height:28px;${fp ? `background-image:url('${esc(fp)}')` : ''}"></div>
        <div class="nm" style="font-size:14px">${esc(f.name)}<div class="sub">${esc(sub)}</div></div>
        ${f.status === 'offline' ? '' : `<button data-act="invite" data-id="${esc(f.id)}">INVITE</button>`}</div>`;
    }
    html += `<div class="row"><button class="ghost" data-act="close">CLOSE</button><button data-act="link">COPY INVITE LINK</button></div>`;
    if (this.note) html += `<div class="sub" style="text-align:right;margin-top:6px">${esc(this.note)}</div>`;
    this.root.innerHTML = html;
  }
}
