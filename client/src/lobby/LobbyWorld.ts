import { LOBBY, MODES, TEAMS } from '@rlb/shared';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CarView, Wheels } from '../world/CarView.js';
import { CAR_MODELS } from '../world/cars/CarModels.js';
import { Stadium } from '../world/Stadium.js';

/** A round obstacle on the plaza (metres). */
export interface Collider {
  x: number;
  z: number;
  r: number;
}

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};
const tex = (c: HTMLCanvasElement): CanvasTexture => {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
const flat = (g: BufferGeometry): BufferGeometry => (g.index ? g.toNonIndexed() : g);

/** Floor size (metres): the stadium bowl's inner rectangle. */
const FW = 100;
const FD = 140;

/** One playlist station: its pad, gate signs, display car - and the canvases the HUD state redraws. */
interface Station {
  mode: (typeof MODES)[number];
  x: number;
  z: number;
  status: { tex: CanvasTexture; ctx: CanvasRenderingContext2D; key: string };
  ring: MeshBasicMaterial;
  beam: MeshBasicMaterial;
  car: CarView;
  turntable: Group;
}

/** A screen: canvas + texture + the last thing drawn on it. */
export interface Screen {
  tex: CanvasTexture;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

/**
 * THE LOBBY'S PLACE: the pitch of the Grand Prix Park stadium, turned into a
 * pre-match plaza - the full stands, canopy, arches and skyline all around
 * (the day arena's own \`Stadium\`), and on the floor a painted plaza with a
 * turf centre circle. Three PLAYLIST STATIONS stand on the north side - a
 * glowing pad to step on, an LED gate with the playlist and its live queue, a
 * display car on a turntable and a beam of light; a GARAGE SHOWCASE of the
 * five cars curves round the south; a four-sided SCOREBOARD hangs from a truss
 * over the middle; lamp posts, team banners, benches and a rail ring it.
 */
export class LobbyWorld {
  readonly root = new Group();
  readonly stadium = new Stadium();
  readonly colliders: Collider[] = [];
  readonly stations: Station[] = [];
  readonly board: Screen;
  readonly wheels: Wheels;
  private readonly showcase: { car: CarView; table: Group }[] = [];
  private t = 0;

  constructor() {
    this.root.name = 'lobby';
    this.wheels = new Wheels(this.root, 64);
    this.root.add(this.stadium.root);
    this.buildFloor();
    this.buildRail();
    for (let i = 0; i < MODES.length; i += 1) this.buildStation(i);
    this.buildShowcase();
    this.board = this.buildScoreboard();
    this.buildDressing();
  }

  private add(g: BufferGeometry, m: Material, shadows = false): Mesh {
    const mesh = new Mesh(g, m);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  private buildFloor(): void {
    const PX = 10; // px per metre
    const [c, g] = canvas(FW * PX, FD * PX);
    const cx = (FW * PX) / 2;
    const cz = (FD * PX) / 2;
    g.fillStyle = '#cfd3da';
    g.fillRect(0, 0, c.width, c.height);
    // hex paving, faintly tinted blue (north half) and orange (south half)
    const R = 1.6 * PX;
    for (let row = 0; row * R * 1.5 < c.height + R; row += 1) {
      for (let col = 0; col * R * 1.732 < c.width + R; col += 1) {
        const x = col * R * 1.732 + (row % 2) * R * 0.866;
        const y = row * R * 1.5;
        const tint = y < cz ? 'rgba(47,123,255,' : 'rgba(255,138,31,';
        const k = Math.min(1, Math.abs(y - cz) / (cz * 0.9));
        g.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          g.lineTo(x + Math.cos(a) * R * 0.94, y + Math.sin(a) * R * 0.94);
        }
        g.closePath();
        g.fillStyle = `${tint}${(0.04 + k * 0.14).toFixed(3)})`;
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.5)';
        g.lineWidth = 2;
        g.stroke();
      }
    }
    // the walkway: a dark asphalt track ring with kerbs and white dashes
    const ring = (r0: number, r1: number, fill: string): void => {
      g.beginPath();
      g.arc(cx, cz, r1 * PX, 0, Math.PI * 2);
      g.arc(cx, cz, r0 * PX, 0, Math.PI * 2, true);
      g.fillStyle = fill;
      g.fill();
    };
    ring(29.5, 36, '#2a2e36');
    g.lineWidth = 0.9 * PX;
    g.setLineDash([1.6 * PX, 1.6 * PX]);
    g.strokeStyle = '#d42a2a';
    g.beginPath();
    g.arc(cx, cz, 29.9 * PX, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = '#f2f2f2';
    g.lineDashOffset = 1.6 * PX;
    g.stroke();
    g.setLineDash([2.5 * PX, 2 * PX]);
    g.lineDashOffset = 0;
    g.lineWidth = 0.3 * PX;
    g.beginPath();
    g.arc(cx, cz, 33 * PX, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    // the turf centre circle with pitch markings
    g.save();
    g.beginPath();
    g.arc(cx, cz, 13 * PX, 0, Math.PI * 2);
    g.clip();
    for (let k = -14; k < 14; k += 1) {
      g.fillStyle = k % 2 ? '#2f7f2c' : '#3a9234';
      g.fillRect(0, cz + k * 2 * PX, c.width, 2 * PX + 1);
    }
    g.restore();
    g.strokeStyle = '#f4f6f8';
    g.lineWidth = 0.25 * PX;
    g.beginPath();
    g.arc(cx, cz, 13 * PX, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, cz, 7 * PX, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 13 * PX, cz);
    g.lineTo(cx + 13 * PX, cz);
    g.stroke();
    // painted chevrons leading from the circle to each playlist pad
    for (const mode of MODES) {
      const [px, pz] = LOBBY.pads[MODES.indexOf(mode)]!;
      const len = Math.hypot(px, pz);
      const ux = px / len;
      const uz = pz / len;
      g.fillStyle = mode.color;
      for (let d = 14.5; d < len - 4.2; d += 1.6) {
        const x = cx + ux * d * PX;
        const y = cz + uz * d * PX;
        const a = Math.atan2(uz, ux);
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.globalAlpha = 0.85;
        g.beginPath();
        g.moveTo(-0.3 * PX, -0.9 * PX);
        g.lineTo(0.35 * PX, 0);
        g.lineTo(-0.3 * PX, 0.9 * PX);
        g.lineTo(-0.75 * PX, 0.9 * PX);
        g.lineTo(-0.1 * PX, 0);
        g.lineTo(-0.75 * PX, -0.9 * PX);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
    g.globalAlpha = 1;
    // big floor lettering by the showcase
    g.save();
    g.translate(cx, cz + 17 * PX);
    g.rotate(Math.PI); // reads the right way up from the centre of the plaza
    g.font = `900 italic ${2.6 * PX}px "Titillium Web", sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(20,24,34,0.75)';
    g.fillText('ROCKET LEAGUE', 0, 0);
    g.restore();
    const floor = new PlaneGeometry(FW, FD);
    floor.rotateX(-Math.PI / 2);
    this.add(floor, new MeshStandardMaterial({ map: tex(c), roughness: 0.82, metalness: 0.02 }));
  }

  /** A low glass rail round the walkable disc (where the server bounds walkers). */
  private buildRail(): void {
    const r = LOBBY.radius + 1.6;
    const glass = new CylinderGeometry(r, r, 1.1, 96, 1, true);
    glass.translate(0, 0.55, 0);
    this.add(glass, new MeshStandardMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.3, side: DoubleSide, depthWrite: false }));
    const parts: BufferGeometry[] = [];
    const rail = new TorusGeometry(r, 0.06, 6, 128);
    rail.rotateX(Math.PI / 2);
    rail.translate(0, 1.12, 0);
    parts.push(flat(rail));
    for (let i = 0; i < 48; i += 1) {
      const a = (i / 48) * Math.PI * 2;
      const post = new BoxGeometry(0.12, 1.15, 0.12);
      post.translate(Math.cos(a) * r, 0.57, Math.sin(a) * r);
      parts.push(flat(post));
    }
    this.add(mergeGeometries(parts)!, new MeshStandardMaterial({ color: 0xf2f4f8, metalness: 0.6, roughness: 0.3 }), true);
  }

  private buildStation(i: number): void {
    const mode = MODES[i]!;
    const [x, z] = LOBBY.pads[i]!;
    const len = Math.hypot(x, z);
    const ux = x / len;
    const uz = z / len;
    const facing = Math.atan2(-ux, -uz); // a plane's +z towards the centre
    const col = new Color(mode.color);
    // the pad: a glowing ring and a lettered disc
    const ring = new RingGeometry(LOBBY.padRadius - 0.55, LOBBY.padRadius, 72);
    ring.rotateX(-Math.PI / 2);
    ring.translate(x, 0.03, z);
    const ringMat = new MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2), toneMapped: false });
    this.add(ring, ringMat);
    const [dc, dg] = canvas(512, 512);
    dg.fillStyle = '#10141f';
    dg.beginPath();
    dg.arc(256, 256, 256, 0, Math.PI * 2);
    dg.fill();
    dg.textAlign = 'center';
    dg.fillStyle = mode.color;
    dg.font = '900 italic 190px "Titillium Web", sans-serif';
    dg.fillText(mode.label, 256, 290);
    dg.fillStyle = '#ffffff';
    dg.font = '800 54px "Titillium Web", sans-serif';
    dg.fillText(mode.name, 256, 370);
    const disc = new CircleGeometry(LOBBY.padRadius - 0.55, 64);
    disc.rotateX(-Math.PI / 2);
    disc.rotateY(facing);
    disc.translate(x, 0.025, z);
    this.add(disc, new MeshStandardMaterial({ map: tex(dc), emissiveMap: tex(dc), emissive: new Color(0.55, 0.55, 0.55), roughness: 0.5 }));
    // a column of light over the pad
    const [bc, bg] = canvas(4, 128);
    const grad = bg.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    bg.fillStyle = grad;
    bg.fillRect(0, 0, 4, 128);
    const beam = new CylinderGeometry(LOBBY.padRadius, LOBBY.padRadius, 7, 48, 1, true);
    beam.translate(x, 3.5, z);
    const beamMat = new MeshBasicMaterial({ map: new CanvasTexture(bc), color: col.clone().multiplyScalar(1.4), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
    this.add(beam, beamMat).renderOrder = 4;
    // the gate behind it: pillars, a header with the playlist, a status screen
    const gx = x + ux * 4.8;
    const gz = z + uz * 4.8;
    const gate = new Group();
    gate.position.set(gx, 0, gz);
    gate.rotation.y = facing;
    const metal = new MeshStandardMaterial({ color: 0x1c2230, metalness: 0.7, roughness: 0.35 });
    for (const s of [-1, 1]) {
      const pillar = new Mesh(new BoxGeometry(0.8, 8.4, 0.8), metal);
      pillar.position.set(s * 4.4, 4.2, 0);
      pillar.castShadow = true;
      const strip = new Mesh(new BoxGeometry(0.12, 8.2, 0.12), ringMat);
      strip.position.set(s * 4.4, 4.2, 0.42);
      gate.add(pillar, strip);
      this.colliders.push({ x: gx + Math.cos(facing) * s * 4.4, z: gz - Math.sin(facing) * s * 4.4, r: 0.7 });
    }
    const header = new Mesh(new BoxGeometry(9.8, 2.4, 0.7), metal);
    header.position.y = 8.6;
    header.castShadow = true;
    const [hc, hg] = canvas(1024, 256);
    hg.fillStyle = '#05070d';
    hg.fillRect(0, 0, 1024, 256);
    hg.textAlign = 'center';
    hg.textBaseline = 'middle';
    hg.shadowColor = mode.color;
    hg.shadowBlur = 24;
    hg.fillStyle = mode.color;
    hg.font = '900 italic 150px "Titillium Web", sans-serif';
    hg.fillText(mode.label, 330, 132);
    hg.fillStyle = '#ffffff';
    hg.font = '900 italic 110px "Titillium Web", sans-serif';
    hg.fillText(mode.name, 700, 136);
    const sign = new Mesh(new PlaneGeometry(9.4, 2.15), new MeshBasicMaterial({ map: tex(hc), toneMapped: false, color: new Color(1.5, 1.5, 1.5) }));
    sign.position.set(0, 8.6, 0.37);
    const [sc, sg] = canvas(1024, 256);
    const statusTex = tex(sc);
    const status = new Mesh(new PlaneGeometry(7.2, 1.8), new MeshBasicMaterial({ map: statusTex, toneMapped: false, color: new Color(1.3, 1.3, 1.3) }));
    status.position.set(0, 6.4, 0.05);
    const statusBack = new Mesh(new BoxGeometry(7.6, 2.1, 0.3), metal);
    statusBack.position.set(0, 6.4, -0.2);
    gate.add(header, sign, statusBack, status);
    this.root.add(gate);
    // the display car on a turntable beside the pad
    const tx = x + Math.cos(facing) * 7.6;
    const tz = z - Math.sin(facing) * 7.6;
    const table = new Group();
    table.position.set(tx, 0, tz);
    const plinth = new Mesh(new CylinderGeometry(2.9, 3.1, 0.45, 48), new MeshStandardMaterial({ color: 0x252b38, metalness: 0.6, roughness: 0.3 }));
    plinth.position.y = 0.22;
    plinth.receiveShadow = true;
    const trim = new Mesh(new TorusGeometry(3.0, 0.06, 6, 64), ringMat);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.45;
    table.add(plinth, trim);
    const car = new CarView(0, i === 0 ? 0 : i === 1 ? 1 : 4, true);
    car.showName = false;
    car.rider.root.visible = false;
    car.root.scale.setScalar(3);
    car.root.position.y = 0.45 + 0.18 * 3;
    car.root.traverse((o) => (o.castShadow = true));
    table.add(car.root);
    this.root.add(table);
    this.colliders.push({ x: tx, z: tz, r: 3.1 });
    this.stations.push({ mode, x, z, status: { tex: statusTex, ctx: sg, key: '' }, ring: ringMat, beam: beamMat, car, turntable: table });
  }

  /** The five cars on plinths in an arc on the south side, under a GARAGE sign. */
  private buildShowcase(): void {
    const plinthMat = new MeshStandardMaterial({ color: 0xeef0f4, metalness: 0.2, roughness: 0.4 });
    const glow = new MeshBasicMaterial({ color: new Color(1.6, 2.2, 3.2), toneMapped: false });
    CAR_MODELS.forEach((model, k) => {
      const a = Math.PI / 2 + (k - 2) * 0.36;
      const r = 23;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const table = new Group();
      table.position.set(x, 0, z);
      const plinth = new Mesh(new CylinderGeometry(2.4, 2.6, 0.6, 40), plinthMat);
      plinth.position.y = 0.3;
      plinth.receiveShadow = true;
      plinth.castShadow = true;
      const trim = new Mesh(new TorusGeometry(2.5, 0.05, 6, 48), glow);
      trim.rotation.x = Math.PI / 2;
      trim.position.y = 0.61;
      const car = new CarView(0, model.id, true);
      car.showName = false;
      car.rider.root.visible = false;
      car.root.scale.setScalar(2.6);
      car.root.position.y = 0.6 + 0.18 * 2.6;
      car.root.traverse((o) => (o.castShadow = true));
      table.add(plinth, trim, car.root);
      // name plate facing the centre
      const [nc, ng] = canvas(512, 96);
      ng.fillStyle = '#0d1220';
      ng.fillRect(0, 0, 512, 96);
      ng.fillStyle = '#ffffff';
      ng.font = '900 italic 60px "Titillium Web", sans-serif';
      ng.textAlign = 'center';
      ng.textBaseline = 'middle';
      ng.fillText(model.name, 256, 50);
      const plate = new Mesh(new PlaneGeometry(3.2, 0.6), new MeshBasicMaterial({ map: tex(nc) }));
      plate.position.set(-Math.cos(a) * 2.62, 0.3, -Math.sin(a) * 2.62);
      plate.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
      table.add(plate);
      this.root.add(table);
      this.colliders.push({ x, z, r: 2.6 });
      this.showcase.push({ car, table });
    });
    // the GARAGE arch over the showcase
    const [gc, gg] = canvas(1024, 192);
    gg.fillStyle = '#0d1220';
    gg.fillRect(0, 0, 1024, 192);
    gg.fillStyle = '#ffffff';
    gg.textAlign = 'center';
    gg.textBaseline = 'middle';
    gg.font = '900 italic 120px "Titillium Web", sans-serif';
    gg.fillText('GARAGE', 512, 92);
    gg.fillStyle = '#7fd0ff';
    gg.font = '700 40px "Titillium Web", sans-serif';
    gg.fillText('PRESS G TO CHOOSE YOUR CAR', 512, 165);
    const sign = new Mesh(new PlaneGeometry(10, 1.9), new MeshBasicMaterial({ map: tex(gc), toneMapped: false, color: new Color(1.2, 1.2, 1.2) }));
    sign.position.set(0, 6.2, 28.8);
    sign.rotation.y = Math.PI;
    const frame = new Mesh(new BoxGeometry(10.6, 2.4, 0.4), new MeshStandardMaterial({ color: 0x1c2230, metalness: 0.6, roughness: 0.4 }));
    frame.position.set(0, 6.2, 29.05);
    this.root.add(frame, sign);
    for (const s of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.5, 6.2, 0.5), frame.material);
      post.position.set(s * 5, 3.1, 29.05);
      post.castShadow = true;
      this.root.add(post);
      this.colliders.push({ x: s * 5, z: 29.05, r: 0.5 });
    }
  }

  /** The scoreboard: a four-faced screen box hung from a truss over the middle of the plaza. */
  private buildScoreboard(): Screen {
    const metal = new MeshStandardMaterial({ color: 0xe8ebf0, metalness: 0.55, roughness: 0.35 });
    const dark = new MeshStandardMaterial({ color: 0x141a26, metalness: 0.5, roughness: 0.4 });
    const parts: BufferGeometry[] = [];
    const span = 28;
    for (const s of [-1, 1]) {
      const pylon = new BoxGeometry(1.4, 19, 1.4);
      pylon.translate(s * span, 9.5, 0);
      parts.push(flat(pylon));
      this.colliders.push({ x: s * span, z: 0, r: 1.2 });
    }
    // a box truss: two chords and diagonals
    for (const y of [17.6, 19]) for (const zz of [-0.7, 0.7]) {
      const chord = new BoxGeometry(span * 2, 0.18, 0.18);
      chord.translate(0, y, zz);
      parts.push(flat(chord));
    }
    for (let x = -span; x < span; x += 2) {
      for (const zz of [-0.7, 0.7]) {
        const d = new BoxGeometry(0.1, 2, 0.1);
        d.rotateZ((x / 2) % 2 ? 0.6 : -0.6);
        d.translate(x + 1, 18.3, zz);
        parts.push(flat(d));
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cable = new CylinderGeometry(0.04, 0.04, 3.4, 4);
      cable.translate(sx * 4.2, 15.9, sz * 3.2);
      parts.push(flat(cable));
    }
    const truss = new Mesh(mergeGeometries(parts)!, metal);
    truss.castShadow = true;
    this.root.add(truss);
    const box = new Mesh(new BoxGeometry(9.6, 5.6, 7.2), dark);
    box.position.y = 11.4;
    box.castShadow = true;
    this.root.add(box);
    const [c, g] = canvas(1024, 600);
    const t = tex(c);
    const face = new MeshBasicMaterial({ map: t, toneMapped: false, color: new Color(1.25, 1.25, 1.25) });
    const faces: [number, number, number, number][] = [
      [0, 3.61, 0, 9.2],
      [Math.PI, -3.61, 0, 9.2],
      [Math.PI / 2, 0, 4.81, 6.8],
      [-Math.PI / 2, 0, -4.81, 6.8],
    ];
    for (const [ry, fz, fx, w] of faces) {
      const p = new Mesh(new PlaneGeometry(w, 5.2), face);
      p.position.set(fx, 11.4, fz);
      p.rotation.y = ry;
      this.root.add(p);
    }
    // LED rings round the top and bottom edges (strips, not slabs: the underside stays dark)
    const led = new MeshBasicMaterial({ color: new Color(0.6, 1.6, 3.2), toneMapped: false });
    const strips: BufferGeometry[] = [];
    for (const y of [8.62, 14.18]) {
      for (const z of [-3.66, 3.66]) {
        const s = new BoxGeometry(9.8, 0.14, 0.12);
        s.translate(0, y, z);
        strips.push(flat(s));
      }
      for (const x of [-4.86, 4.86]) {
        const s = new BoxGeometry(0.12, 0.14, 7.4);
        s.translate(x, y, 0);
        strips.push(flat(s));
      }
    }
    this.root.add(new Mesh(mergeGeometries(strips)!, led));
    return { tex: t, ctx: g, w: 1024, h: 600 };
  }

  /** Lamp posts with team banners round the walkway, benches round the centre circle. */
  private buildDressing(): void {
    const posts: BufferGeometry[] = [];
    const heads: BufferGeometry[] = [];
    const banners: [BufferGeometry[], BufferGeometry[]] = [[], []];
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
      const r = LOBBY.radius + 3.2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const p = new CylinderGeometry(0.12, 0.18, 9, 8);
      p.translate(x, 4.5, z);
      posts.push(flat(p));
      const arm = new BoxGeometry(0.1, 0.1, 1.6);
      arm.rotateY(Math.atan2(x, z));
      arm.translate(x * 0.985, 9, z * 0.985);
      posts.push(flat(arm));
      const head = new BoxGeometry(0.9, 0.18, 0.5);
      head.rotateY(Math.atan2(x, z));
      head.translate(x * 0.97, 8.92, z * 0.97);
      heads.push(flat(head));
      const banner = new PlaneGeometry(1.1, 3.4);
      banner.rotateY(Math.atan2(x, z) + Math.PI / 2);
      banner.translate(x, 6.4, z);
      banners[z < 0 ? 0 : 1].push(flat(banner));
    }
    this.add(mergeGeometries(posts)!, new MeshStandardMaterial({ color: 0x2a3140, metalness: 0.6, roughness: 0.4 }), true);
    this.add(mergeGeometries(heads)!, new MeshBasicMaterial({ color: new Color(3.2, 3.0, 2.6), toneMapped: false }));
    banners.forEach((list, team) => {
      const [bc, bg] = canvas(128, 384);
      bg.fillStyle = TEAMS[team]!.color;
      bg.fillRect(0, 0, 128, 384);
      bg.fillStyle = 'rgba(255,255,255,0.9)';
      bg.beginPath();
      bg.arc(64, 120, 40, 0, Math.PI * 2);
      bg.fill();
      bg.fillStyle = TEAMS[team]!.color;
      bg.beginPath();
      bg.arc(64, 120, 20, 0, Math.PI * 2);
      bg.fill();
      bg.fillStyle = '#ffffff';
      bg.font = '900 40px "Titillium Web", sans-serif';
      bg.textAlign = 'center';
      bg.fillText(TEAMS[team]!.name, 64, 260);
      this.add(mergeGeometries(list)!, new MeshStandardMaterial({ map: tex(bc), side: DoubleSide, roughness: 0.8 }));
    });
    // benches round the centre circle (sit... or stand on them)
    const benches: BufferGeometry[] = [];
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const r = 15.5;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const seat = new BoxGeometry(2.6, 0.12, 0.6);
      seat.rotateY(-a + Math.PI / 2);
      seat.translate(x, 0.48, z);
      benches.push(flat(seat));
      for (const s of [-1, 1]) {
        const leg = new BoxGeometry(0.1, 0.48, 0.5);
        leg.rotateY(-a + Math.PI / 2);
        // along the bench (its length runs (sin a, -cos a))
        leg.translate(x + Math.sin(a) * s * 1.1, 0.24, z - Math.cos(a) * s * 1.1);
        benches.push(flat(leg));
      }
      this.colliders.push({ x, z, r: 1.0 });
    }
    this.add(mergeGeometries(benches)!, new MeshStandardMaterial({ color: 0x3a6fd0, metalness: 0.3, roughness: 0.5 }), true);
  }

  /** Spin the turntables, breathe the pads (the queued one brightest), keep the wheels drawn. */
  update(dt: number, myQueue: string): void {
    this.t += dt;
    this.wheels.begin();
    const still = { steer: 0, lateral: 0, surge: 0, boosting: false, airborne: false, look: 0, cheer: 0, emote: '', emoteTime: 0 };
    for (const s of this.stations) {
      s.turntable.rotation.y += dt * 0.35;
      const mine = s.mode.id === myQueue;
      const pulse = 1 + Math.sin(this.t * (mine ? 6 : 2)) * (mine ? 0.35 : 0.12);
      s.ring.color.set(s.mode.color).multiplyScalar((mine ? 3.2 : 2.0) * pulse);
      s.beam.opacity = mine ? 1 : 0.7;
      s.car.update(dt, 0, 0, false, true, this.wheels, still, 30);
    }
    for (const sc of this.showcase) {
      sc.table.rotation.y += dt * 0.2;
      sc.car.update(dt, 0, 0, false, true, this.wheels, still, 30);
    }
    this.wheels.end();
    this.stadium.update(dt);
  }
}
