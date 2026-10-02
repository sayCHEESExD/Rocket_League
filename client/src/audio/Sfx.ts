/** The recorded engine loop: trimmed past its lead-in and tail silence so the loop is seamless. */
const CAR_LOOP: [number, number] = [0.3, -0.2];
/** The nitro recording: the ignition burst plays once, this stretch loops while the boost is held. */
const NITRO_LOOP: [number, number] = [0.9, 2.25];
/** The music fades out from ~112 s and is silent after ~130 s: start over before the silence. */
const MUSIC_END = 130.4;
/** How loud the music sits where the player is (times the portal's music_volume). */
const MUSIC_LEVEL = { lobby: 0.75, match: 0.75, results: 0.75, off: 0 } as const;
export type MusicMode = keyof typeof MUSIC_LEVEL;
/** Other cars' engines heard at once (the nearest). */
const VOICES = 3;

/** One other car, as heard from the camera. */
export interface HeardCar {
  /** Distance to the camera (uu). */
  distance: number;
  /** -1 (left) .. 1 (right) of the camera. */
  pan: number;
  speed: number;
  boosting: boolean;
}

/**
 * THE GAME'S SOUND. The car is RECORDED: an engine loop whose pitch follows
 * the speed (`/audio/car.mp3`, also the nearest other cars, panned and
 * attenuated) and a nitro roar - ignition, then a held loop (`nitro.mp3`).
 * Music streams (`racing-music.mp3`, never decoded whole: 4 MB of mp3 would be
 * ~50 MB of samples) under the portal's music_volume, loud in the lobby and
 * ducked under the engine in a match. Hits, jumps, bumps, horn and beeps are
 * still synthesised, and the crowd cheer is a recording (`crowd_cheer.mp3`).
 * Until a recording has loaded its synthesised stand-in plays.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private boost: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private crowd: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private cheer: AudioBuffer | null = null;
  private volume = 0.8;
  private musicVolume = 0.6;
  private carBuf: AudioBuffer | null = null;
  private nitroBuf: AudioBuffer | null = null;
  private engineRec: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private nitro: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private boosting = false;
  private readonly voices: { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; boosting: boolean }[] = [];
  private music: { el: HTMLAudioElement; gain: GainNode } | null = null;
  private musicMode: MusicMode = 'lobby';

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    this.startLoops();
    const load = (url: string): Promise<AudioBuffer | null> =>
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
    void load('/audio/crowd_cheer.mp3').then((buf) => (this.cheer = buf));
    void load('/audio/car.mp3').then((buf) => buf && this.startEngine(buf));
    void load('/audio/nitro.mp3').then((buf) => (this.nitroBuf = buf));
    this.startMusic();
  }

  /** The recorded engine: one loop for our car, and VOICES quieter ones for the nearest other cars. */
  private startEngine(buf: AudioBuffer): void {
    const ctx = this.ctx!;
    this.carBuf = buf;
    const loop = (offset: number): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = CAR_LOOP[0];
      src.loopEnd = buf.duration + CAR_LOOP[1];
      src.start(0, CAR_LOOP[0] + offset);
      return src;
    };
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const src = loop(0);
    src.connect(gain).connect(this.master!);
    this.engineRec = { src, gain };
    for (let i = 0; i < VOICES; i += 1) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner();
      // each voice starts elsewhere in the recording, so two cars never sound in unison
      const v = loop((buf.duration - 1) * ((i + 1) / (VOICES + 1)));
      v.connect(g).connect(pan).connect(this.master!);
      this.voices.push({ src: v, gain: g, pan, boosting: false });
    }
  }

  /** Streamed, looped before its silent tail, routed through the master volume. */
  private startMusic(): void {
    const ctx = this.ctx!;
    try {
      const el = new Audio('/audio/racing-music.mp3');
      el.preload = 'auto';
      el.loop = true;
      el.addEventListener('timeupdate', () => {
        if (el.currentTime > MUSIC_END) el.currentTime = 0;
      });
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(this.master!);
      this.music = { el, gain };
      void el.play().catch(() => undefined);
      this.applyMusic(0.8);
    } catch {
      this.music = null; // no music is better than a broken frame
    }
  }

  /** Where the music should sit (lobby / match / results), eased over `seconds`. */
  setMusicMode(mode: MusicMode, seconds = 1.2): void {
    this.musicMode = mode;
    this.applyMusic(seconds);
  }

  private applyMusic(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    this.music.gain.gain.setTargetAtTime(MUSIC_LEVEL[this.musicMode] * this.musicVolume, ctx.currentTime, seconds / 3);
  }

  /** Nothing of a car keeps running when there is no car (the lobby, between matches). */
  silenceCars(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.engineRec?.gain.gain.setTargetAtTime(0, t, 0.1);
    for (const v of this.voices) v.gain.gain.setTargetAtTime(0, t, 0.1);
    this.setNitro(false, 0);
    if (this.engine) this.engine.gain.gain.setTargetAtTime(0, t, 0.1);
    this.boost?.gain.gain.setTargetAtTime(0, t, 0.1);
    this.wind?.gain.gain.setTargetAtTime(0, t, 0.1);
  }

  /** Nitro on: the ignition, then the held roar; off: a quick fade. */
  private setNitro(on: boolean, k: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.nitroBuf) return;
    const t = ctx.currentTime;
    if (on && !this.boosting) {
      const gain = ctx.createGain();
      gain.gain.value = 0.42;
      const src = ctx.createBufferSource();
      src.buffer = this.nitroBuf;
      src.loop = true;
      src.loopStart = NITRO_LOOP[0];
      src.loopEnd = Math.min(NITRO_LOOP[1], this.nitroBuf.duration);
      src.connect(gain).connect(this.master!);
      src.start();
      this.nitro?.gain.gain.setTargetAtTime(0, t, 0.03);
      this.nitro?.src.stop(t + 0.2);
      this.nitro = { src, gain };
    } else if (!on && this.boosting && this.nitro) {
      this.nitro.gain.gain.setTargetAtTime(0, t, 0.05);
      this.nitro.src.stop(t + 0.35);
      this.nitro = null;
    }
    if (on && this.nitro) this.nitro.src.playbackRate.setTargetAtTime(0.95 + k * 0.15, t, 0.1);
    this.boosting = on;
  }

  /**
   * The nearest other cars' engines (and their boost bursts), panned to where
   * they are on screen and fading with distance. Call every frame with up to
   * VOICES cars, nearest first.
   */
  others(cars: HeardCar[]): void {
    const ctx = this.ctx;
    if (!ctx || !this.carBuf) return;
    const t = ctx.currentTime;
    this.voices.forEach((v, i) => {
      const c = cars[i];
      const a = c ? this.att(c.distance) : 0;
      const k = c ? Math.min(1, c.speed / 2300) : 0;
      v.gain.gain.setTargetAtTime(a * (0.05 + k * 0.05), t, 0.12);
      v.src.playbackRate.setTargetAtTime(0.7 + k * 0.85, t, 0.1);
      v.pan.pan.setTargetAtTime(c ? Math.max(-1, Math.min(1, c.pan)) * 0.8 : 0, t, 0.1);
      // their nitro: the ignition burst, once per boost, quietly by distance
      const boosting = !!c?.boosting;
      if (boosting && !v.boosting && a > 0.08 && this.nitroBuf) {
        const g = ctx.createGain();
        g.gain.value = 0.22 * a;
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, c!.pan)) * 0.8;
        const src = ctx.createBufferSource();
        src.buffer = this.nitroBuf;
        src.connect(g).connect(p).connect(this.master!);
        src.start(t, 0, NITRO_LOOP[0]);
      }
      v.boosting = boosting;
    });
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    this.applyMusic(0.3);
  }

  private startLoops(): void {
    const ctx = this.ctx!;
    const out = this.master!;
    // engine: two detuned saws through a lowpass
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(out);
    osc.start();
    osc2.start();
    this.engine = { osc, osc2, filter, gain };
    const loop = (type: BiquadFilterType, freq: number, q: number): { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(out);
      src.start();
      return { src, filter: f, gain: g };
    };
    this.boost = loop('bandpass', 900, 0.7);
    this.wind = loop('highpass', 2500, 0.5);
    this.crowd = loop('bandpass', 700, 0.4);
  }

  /** Continuous sounds for the local car, every frame. */
  drive(speed: number, throttle: number, boosting: boolean, onGround: boolean, supersonic: boolean, hype: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine) return;
    const t = ctx.currentTime;
    const k = Math.min(1, speed / 2300);
    const rev = 0.25 + k * 0.75 + Math.abs(throttle) * 0.08;
    const rec = this.engineRec;
    if (rec) {
      // the recording: pitch rises with speed (and a touch with the throttle / boost), quieter in the air
      rec.src.playbackRate.setTargetAtTime(0.72 + k * 0.85 + Math.abs(throttle) * 0.06 + (boosting ? 0.06 : 0), t, 0.06);
      rec.gain.gain.setTargetAtTime((onGround ? 1 : 0.7) * (0.12 + Math.abs(throttle) * 0.07 + k * 0.08), t, 0.08);
      this.engine.gain.gain.setTargetAtTime(0, t, 0.05);
    } else {
      this.engine.osc.frequency.setTargetAtTime(48 + rev * 120, t, 0.05);
      this.engine.osc2.frequency.setTargetAtTime(24 + rev * 61, t, 0.05);
      this.engine.filter.frequency.setTargetAtTime(380 + rev * 1400 + (boosting ? 600 : 0), t, 0.05);
      this.engine.gain.gain.setTargetAtTime((onGround ? 0.05 : 0.03) + Math.abs(throttle) * 0.03 + k * 0.03, t, 0.08);
    }
    // nitro: the recording when it is in, else the synthesised hiss (kept faint under it for air)
    this.setNitro(boosting, k);
    this.boost!.gain.gain.setTargetAtTime(boosting ? (this.nitroBuf ? 0.04 : 0.16) : 0, t, boosting ? 0.02 : 0.08);
    this.boost!.filter.frequency.setTargetAtTime(boosting ? 700 + k * 900 : 500, t, 0.05);
    this.wind!.gain.gain.setTargetAtTime(supersonic ? 0.05 : k * 0.015, t, 0.1);
    this.crowd!.gain.gain.setTargetAtTime(0.012 + hype * 0.09, t, 0.3);
  }

  private env(gain: GainNode, t: number, peak: number, attack: number, decay: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.005, dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(type: BiquadFilterType, freq: number, dur: number, peak: number, q = 1, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.004, dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  /** Distance attenuation (uu). */
  private att(distance: number): number {
    return Math.max(0, 1 - distance / 6000) ** 1.5;
  }

  jump(distance: number): void {
    const a = this.att(distance);
    if (a < 0.02) return;
    this.burst('lowpass', 900, 0.16, 0.22 * a, 0.8);
    this.tone('sine', 140, 70, 0.14, 0.18 * a);
  }

  dodge(distance: number): void {
    const a = this.att(distance);
    if (a < 0.02) return;
    this.burst('bandpass', 1400, 0.22, 0.18 * a, 0.6);
  }

  ballHit(strength: number, distance: number): void {
    const a = this.att(distance);
    if (a < 0.02) return;
    const k = Math.min(1, strength / 3000);
    this.tone('sine', 150 + k * 60, 45, 0.18 + k * 0.12, (0.25 + k * 0.45) * a);
    this.burst('bandpass', 1800 + k * 2400, 0.06 + k * 0.08, (0.12 + k * 0.35) * a, 1.2);
    if (k > 0.6) this.tone('triangle', 900, 300, 0.25, 0.12 * a * k);
  }

  bounce(strength: number, distance: number): void {
    const a = this.att(distance);
    if (a < 0.02) return;
    const k = Math.min(1, strength / 2500);
    this.tone('sine', 110, 50, 0.15, 0.12 * k * a);
  }

  bump(distance: number): void {
    const a = this.att(distance);
    if (a < 0.02) return;
    this.burst('bandpass', 600, 0.25, 0.35 * a, 2);
    this.tone('square', 180, 60, 0.18, 0.08 * a);
  }

  demo(distance: number): void {
    const a = Math.max(0.3, this.att(distance));
    this.burst('lowpass', 500, 0.9, 0.6 * a, 0.5);
    this.tone('sawtooth', 120, 30, 0.7, 0.25 * a);
  }

  pad(big: boolean): void {
    this.tone('triangle', big ? 660 : 880, big ? 1320 : 1180, big ? 0.22 : 0.1, big ? 0.14 : 0.07);
  }

  land(distance: number): void {
    const a = this.att(distance);
    if (a < 0.05) return;
    this.burst('lowpass', 300, 0.1, 0.12 * a, 0.7);
  }

  wall(strength: number, distance: number): void {
    const a = this.att(distance);
    if (a < 0.05) return;
    this.burst('lowpass', 700, 0.2, Math.min(0.4, strength / 3000) * a, 1.5);
  }

  countdown(n: number): void {
    if (n > 0) this.tone('sine', 660, 660, 0.25, 0.22);
    else {
      this.tone('sine', 990, 990, 0.5, 0.25);
      this.tone('triangle', 1320, 1320, 0.45, 0.1);
    }
  }

  goal(ours: boolean): void {
    // the horn: a stacked chord with a slight wobble
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const f of [220, 277.2, 329.6, 440]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = ctx.createGain();
      lg.gain.value = f * 0.01;
      lfo.connect(lg).connect(o.frequency);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
      g.gain.setValueAtTime(0.09, t + 1.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
      o.connect(filt).connect(g).connect(this.master!);
      o.start(t);
      lfo.start(t);
      o.stop(t + 2.1);
      lfo.stop(t + 2.1);
    }
    this.burst('lowpass', 400, 1.4, 0.7, 0.4);
    if (this.cheer) {
      const s = ctx.createBufferSource();
      s.buffer = this.cheer;
      const g = ctx.createGain();
      g.gain.value = ours ? 0.9 : 0.5;
      s.connect(g).connect(this.master!);
      s.start();
    }
  }

  click(): void {
    this.tone('triangle', 1200, 900, 0.05, 0.06);
  }

  fanfare(win: boolean): void {
    const notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
    notes.forEach((f, i) => this.tone('triangle', f, f, 0.28, 0.12 * this.musicVolume + 0.05, i * 0.16));
  }
}
