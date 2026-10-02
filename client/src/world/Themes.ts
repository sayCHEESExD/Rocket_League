import { ARENAS } from '@rlb/shared';
import type { Texture, WebGLRenderer } from 'three';
import { dayEnvironment, neonEnvironment } from './Environment.js';

export type ArenaTheme = (typeof ARENAS)[number]['id'];

/** Arena index (the server's `match.arena`) to its look; unknown ids fall back to the first. */
export const themeOf = (index: number): ArenaTheme => (ARENAS[index] ?? ARENAS[0]).id;

/** Everything about an arena's lighting that lives on the scene rather than in the arena itself. */
export interface ThemeLook {
  background: number;
  fog: [color: number, near: number, far: number];
  hemi: [sky: number, ground: number, intensity: number];
  ambient: number;
  /** Tone-mapping exposure (ACES). */
  exposure: number;
  sun: [color: number, intensity: number, x: number, y: number, z: number];
  /** Bloom strength (desktop) - the threshold stays 3.0, so only HDR emissives glow. */
  bloom: number;
  env: (renderer: WebGLRenderer) => Texture;
}

export const LOOKS: Record<ArenaTheme, ThemeLook> = {
  // night in the neon city: a cool floodlight from above, a blue-violet haze
  neon: {
    background: 0x0a0c18,
    fog: [0x161a33, 140, 820],
    hemi: [0xa8b8ff, 0x241a2c, 1.3],
    ambient: 0.14,
    exposure: 1.0,
    sun: [0xe4ecff, 1.85, -20, 70, 30],
    bloom: 0.65,
    env: neonEnvironment,
  },
  // a bright summer afternoon graded like the reference: a hard warm sun and little fill light (deep
  // shadows, saturated colour), a deep blue sky, and only a thin haze on the far skyline
  day: {
    background: 0x3f86e0,
    fog: [0x8fbdec, 650, 2600],
    hemi: [0xb8d6ff, 0x4a5638, 0.72],
    ambient: 0.04,
    exposure: 0.92,
    sun: [0xfff0d8, 3.3, 55, 95, -35],
    bloom: 0.3,
    env: dayEnvironment,
  },
};
