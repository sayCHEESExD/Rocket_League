import { AdditiveBlending, Color, DoubleSide, NormalBlending, ShaderMaterial } from 'three';

/**
 * THE ENCLOSURE PATTERN: a hexagon lattice with pentagon panels set into it,
 * the stitching of a football, drawn per pixel. UVs are in metres along the
 * surface (around the walls, up the curve, across the roof), so the cells are
 * the same size everywhere and the lattice runs continuously from the walls
 * over the top. Lines are anti-aliased with screen-space derivatives, so the
 * far side of the arena reads as a fine mesh instead of shimmering noise.
 */
export interface BarrierOptions {
  /** Cell size, metres. */
  cell: number;
  /** Base tint and line colour. */
  tint: number;
  line: number;
  /** Fill alpha, line alpha, pentagon alpha. */
  fill: number;
  lines: number;
  pent: number;
  /** Tint toward the team colours by length (arena walls/roof). */
  teams: boolean;
  additive?: boolean;
  /** Line half-width in cell units (default 0.035) and pentagon radius (default 0.24); pentagons outline-only when set. */
  width?: number;
  pentR?: number;
  pentOutline?: boolean;
  /**
   * How much of the lattice fades out where its lines get finer than a pixel (far away, grazing
   * angles). There the lines blur into an even veil of line colour; 0.55 keeps a faint dome, 1.0
   * lets a daylight sky through clean.
   */
  farFade?: number;
}

export const barrierMaterial = (o: BarrierOptions): ShaderMaterial =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: o.additive ? AdditiveBlending : NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uCell: { value: o.cell },
      uTint: { value: new Color(o.tint) },
      uLine: { value: new Color(o.line) },
      uBlue: { value: new Color(0x3d86ff) },
      uOrange: { value: new Color(0xff8a2a) },
      uA: { value: [o.fill, o.lines, o.pent] },
      uTeams: { value: o.teams ? 1 : 0 },
      uPulse: { value: [0, 0] },
      uWidth: { value: o.width ?? 0.035 },
      uPentR: { value: o.pentR ?? 0.24 },
      uOutline: { value: o.pentOutline ? 1 : 0 },
      uFarFade: { value: o.farFade ?? 0.55 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      varying vec2 vUv;
      varying vec3 vWorld;
      uniform float uTime, uCell, uTeams, uWidth, uPentR, uOutline, uFarFade;
      uniform vec3 uTint, uLine, uBlue, uOrange;
      uniform float uA[3];
      uniform float uPulse[2];
      const vec2 HS = vec2(1.0, 1.7320508);
      vec4 hexCell(vec2 p) {
        vec4 c = floor(vec4(p, p - vec2(0.5, 1.0)) / HS.xyxy) + 0.5;
        vec4 h = vec4(p - c.xy * HS, p - (c.zw + 0.5) * HS);
        return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, c.xy) : vec4(h.zw, c.zw + 0.5);
      }
      float hexDist(vec2 p) {
        p = abs(p);
        return max(dot(p, normalize(HS)), p.x);
      }
      float sdPentagon(vec2 p, float r) {
        const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
        p.y = -p.y;
        p.x = abs(p.x);
        p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
        p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
        p -= vec2(clamp(p.x, -r * k.z, r * k.z), r);
        return length(p) * sign(p.y);
      }
      void main() {
        vec2 p = vUv / uCell;
        vec4 h = hexCell(p);
        float d = 0.5 - hexDist(h.xy);
        float aa = fwidth(d) * 1.2;
        float far = clamp(aa * 18.0, 0.0, 1.0);
        float line = 1.0 - smoothstep(uWidth, uWidth + aa, d);
        // a pentagon in roughly one cell in four, laid out like a ball's panels
        vec2 id = h.zw;
        float pick = mod(id.x * 2.0 + id.y * 3.0, 5.0);
        float isPent = step(pick, 0.5);
        float pd = sdPentagon(h.xy, uPentR);
        float pentFill = isPent * (1.0 - smoothstep(-aa, aa, pd)) * (1.0 - uOutline);
        float pentEdge = isPent * (1.0 - smoothstep(0.0, aa * 1.2 + uWidth * 0.5, abs(pd)));
        vec3 tint = uTint;
        vec3 lc = uLine;
        if (uTeams > 0.5) {
          float t = clamp(-vWorld.z / 51.2, -1.0, 1.0);
          vec3 team = t < 0.0 ? uBlue : uOrange;
          float k = smoothstep(0.25, 1.0, abs(t));
          tint = mix(tint, team, k * 0.55);
          lc = mix(lc, team * 1.4 + 0.25, k * 0.45);
          float pulse = t < 0.0 ? uPulse[0] : uPulse[1];
          lc += team * pulse * k * 1.5;
        }
        // a slow sweep of light across the lattice
        float sweep = 0.5 + 0.5 * sin(vUv.x * 0.08 + vUv.y * 0.05 - uTime * 0.6);
        float a = uA[0] + (line * uA[1] * (0.75 + 0.25 * sweep) + pentEdge * uA[1] * 0.8) * (1.0 - far * uFarFade) + pentFill * uA[2];
        vec3 col = mix(tint, lc, clamp(line + pentEdge, 0.0, 1.0));
        col = mix(col, tint * 0.45, pentFill * (1.0 - pentEdge));
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
  });
