import { QUICK_CHATS, type AvatarAppearance, type AvatarProportions } from '@rlb/shared';
import { CanvasTexture, Group, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import { AvatarDresser } from '../bloxity/AvatarDresser.js';
import { NameTag } from '../player/NameTag.js';
import { PlayerCharacter, WALKER_SCALE, type WalkMotion } from '../player/PlayerCharacter.js';

/** A speech bubble over a head: one quick-chat line, shown for a few seconds. */
class Bubble {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private shown = -1;

  constructor() {
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.sprite = new Sprite(new SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, fog: false }));
    this.sprite.scale.set(3.2, 0.8, 1);
    this.sprite.renderOrder = 6;
    this.sprite.visible = false;
  }

  show(index: number): void {
    if (index === this.shown) return;
    this.shown = index;
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, 512, 128);
    const text = QUICK_CHATS[index] ?? '';
    g.font = '800 46px "Titillium Web", sans-serif';
    const w = Math.min(500, g.measureText(text).width + 56);
    const x = (512 - w) / 2;
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.roundRect(x, 10, w, 84, 28);
    g.fill();
    g.beginPath();
    g.moveTo(244, 92);
    g.lineTo(268, 92);
    g.lineTo(256, 118);
    g.fill();
    g.fillStyle = '#121826';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 54, 470);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.sprite.material as SpriteMaterial).dispose();
  }
}

/**
 * ONE PERSON ON THE PLAZA: their Bloxity avatar on foot (the same character
 * and dresser the drivers use, posed by \`PlayerCharacter.walk\`), a name
 * plate and a chat bubble. Remote people are eased towards their replicated
 * position; the local one is driven by \`Walker\` directly.
 */
export class LobbyAvatar {
  readonly root = new Group();
  readonly character = new PlayerCharacter();
  private readonly dresser: AvatarDresser;
  readonly tag = new NameTag();
  private readonly bubble = new Bubble();
  private lookKey = '';
  /** Where the network says they are (remote), eased towards. */
  readonly target = { x: 0, y: 0, z: 0, yaw: 0 };
  private speed = 0;
  private bubbleUntil = 0;
  private placed = false;

  constructor() {
    this.character.root.scale.setScalar(WALKER_SCALE);
    this.root.add(this.character.root);
    this.dresser = new AvatarDresser(this.character);
    this.tag.sprite.position.set(0, 2.25, 0);
    this.tag.sprite.scale.multiplyScalar(0.5);
    this.bubble.sprite.position.set(0, 2.85, 0);
    this.root.add(this.tag.sprite, this.bubble.sprite);
    this.root.traverse((o) => (o.castShadow = true));
  }

  setLook(appearance: AvatarAppearance, proportions: AvatarProportions): void {
    const key = JSON.stringify([appearance, proportions]);
    if (key === this.lookKey) return;
    this.lookKey = key;
    this.dresser.setLook(appearance, proportions);
  }

  setName(name: string, queueColor: string | null): void {
    this.tag.set(name, queueColor, '');
  }

  /** A quick-chat line over the head for four seconds. */
  say(index: number, now: number): void {
    this.bubble.show(index);
    this.bubbleUntil = now + 4;
  }

  /** Snap to a position (the local walker, or a remote one seen for the first time). */
  place(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.placed = true;
  }

  /** Remote: ease towards the network position, estimating the speed for the walk cycle. */
  follow(dt: number, anim: number, emote: string, emoteTime: number, now: number): void {
    const t = this.target;
    if (!this.placed) this.place(t.x, t.y, t.z, t.yaw);
    const k = Math.min(1, dt * 10);
    const p = this.root.position;
    const dx = (t.x - p.x) * k;
    const dz = (t.z - p.z) * k;
    p.x += dx;
    p.z += dz;
    p.y += (t.y - p.y) * k;
    let dy = t.yaw - this.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.y += dy * Math.min(1, dt * 12);
    const v = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    this.speed += ((anim === 1 ? Math.max(v, 1.2) : 0) - this.speed) * Math.min(1, dt * 8);
    this.animate(dt, { speed: this.speed, airborne: anim === 2, emote, emoteTime }, now);
  }

  /** Pose the body (both remote and local), and expire the chat bubble. */
  animate(dt: number, m: WalkMotion, now: number): void {
    this.character.walk(dt, m);
    this.bubble.sprite.visible = now < this.bubbleUntil;
  }

  dispose(): void {
    this.dresser.dispose();
    this.character.dispose();
    this.tag.dispose();
    this.bubble.dispose();
    this.root.removeFromParent();
  }
}
