import { visibleName } from '@rlb/shared';
import { CanvasTexture, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';

const WIDTH = 4.8;
const HEIGHT = 0.68;
const PX = 80;

/**
 * The small name over a footballer's head, on a plate in their TEAM colour
 * (dark in the lodge), with a GK badge for keepers and a BOT tag for bots - so
 * the sides read at a glance while everyone keeps their own Bloxity look. A
 * canvas sprite, repainted only when it changes.
 */
export class NameTag {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private painted = '';

  constructor() {
    this.canvas.width = Math.round(WIDTH * PX);
    this.canvas.height = Math.round(HEIGHT * PX);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    const material = new SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, fog: false });
    this.sprite = new Sprite(material);
    this.sprite.scale.set(WIDTH, HEIGHT, 1);
    this.sprite.renderOrder = 5;
  }

  /**
   * @param team  the plate colour, or null for a neutral dark plate
   * @param badge 'GK', 'BOT' or '' - drawn as a small chip before the name
   */
  set(name: string, team: string | null, badge = ''): void {
    const text = visibleName(name).toUpperCase();
    const key = `${text}|${team}|${badge}`;
    if (key === this.painted) return;
    this.painted = key;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    // the reference plate: a flat rectangle in the team colour, thin light border, white caps
    const font = (weight: number, size: number): string => `${weight} ${Math.round(h * size)}px "Titillium Web", "Segoe UI", sans-serif`;
    ctx.font = font(900, 0.5);
    ctx.textBaseline = 'middle';
    const pad = h * 0.32;
    const badgeW = badge ? h * 1.05 : 0;
    const gap = badge ? h * 0.12 : 0;
    const textW = Math.min(ctx.measureText(text).width, w - badgeW - gap - pad * 2 - 8);
    const plateW = pad * 2 + badgeW + gap + textW;
    const x0 = (w - plateW) / 2;
    const y0 = h * 0.12;
    const ph = h * 0.76;
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + ph);
    const base = team ?? '#1a1e2c';
    grad.addColorStop(0, base);
    grad.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = base;
    ctx.fillRect(x0, y0, plateW, ph);
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x0, y0, plateW, ph);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.strokeRect(x0 + 1, y0 + 1, plateW - 2, ph - 2);
    let x = x0 + pad;
    if (badge) {
      ctx.fillStyle = 'rgba(10,14,30,0.75)';
      ctx.fillRect(x, h * 0.26, badgeW, h * 0.48);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(800, 0.32);
      ctx.textAlign = 'center';
      ctx.fillText(badge, x + badgeW / 2, h / 2 + 1);
      ctx.font = font(900, 0.5);
      x += badgeW + gap;
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(text, x + 1.5, h / 2 + 2.5, textW);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, h / 2 + 1, textW);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.sprite.material as SpriteMaterial).dispose();
    this.sprite.removeFromParent();
  }
}
