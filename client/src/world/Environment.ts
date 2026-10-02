import {
  BackSide,
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * The reflection environment for Neon Park: a dark night dome ringed with
 * glowing panels in the city's neon colours, prefiltered once. Car paint,
 * glass, the wet asphalt and its puddles all pick up pink, cyan and orange
 * streaks from it - the cheap stand-in for real reflections of the city.
 */
export const neonEnvironment = (renderer: WebGLRenderer): Texture => {
  const scene = new Scene();
  const dome = new Mesh(new SphereGeometry(50, 32, 16), new MeshBasicMaterial({ color: 0x0a0c18, side: BackSide }));
  scene.add(dome);
  const panels: [number, number, number, number, number][] = [
    // colour, angle (deg), height, width, tall
    [0xff3fa8, 0, 6, 12, 10],
    [0x2ff3ff, 40, 10, 8, 18],
    [0xffb030, 85, 4, 16, 6],
    [0x3d6bff, 130, 12, 10, 14],
    [0xff5a2a, 180, 5, 14, 8],
    [0xb06bff, 225, 9, 9, 16],
    [0x2ff3ff, 270, 3, 18, 5],
    [0xffe04a, 315, 11, 7, 12],
  ];
  for (const [col, deg, y, w, h] of panels) {
    const a = (deg * Math.PI) / 180;
    const m = new Mesh(new BoxGeometry(w, h, 1), new MeshBasicMaterial({ color: new Color(col).multiplyScalar(2.2) }));
    m.position.set(Math.cos(a) * 40, y, Math.sin(a) * 40);
    m.lookAt(0, y, 0);
    scene.add(m);
  }
  // soft overhead floodlight glow
  const top = new Mesh(new BoxGeometry(30, 1, 30), new MeshBasicMaterial({ color: new Color(0x9fb8ff).multiplyScalar(1.1) }));
  top.position.y = 40;
  scene.add(top);
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  return env;
};

/**
 * The reflection environment for Grand Prix Park: a blue sky dome fading to a
 * bright hazy horizon, green-grey ground, the sun, and a ring of pale glass
 * towers - so paint and glass pick up sky and skyline like the arena around them.
 */
export const dayEnvironment = (renderer: WebGLRenderer): Texture => {
  const scene = new Scene();
  const dome = new SphereGeometry(50, 32, 16);
  const pos = dome.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const top = new Color(0x3a86e6);
  const hor = new Color(0xe2f1ff);
  const ground = new Color(0x56604a);
  const c = new Color();
  for (let i = 0; i < pos.count; i += 1) {
    const h = pos.getY(i) / 50;
    if (h >= 0) c.copy(hor).lerp(top, Math.pow(h, 0.6));
    else c.copy(hor).lerp(ground, Math.min(1, -h * 4));
    col[i * 3] = c.r * 1.3;
    col[i * 3 + 1] = c.g * 1.3;
    col[i * 3 + 2] = c.b * 1.3;
  }
  dome.setAttribute('color', new Float32BufferAttribute(col, 3));
  scene.add(new Mesh(dome, new MeshBasicMaterial({ vertexColors: true, side: BackSide })));
  const sun = new Mesh(new SphereGeometry(3, 12, 8), new MeshBasicMaterial({ color: new Color(1, 0.95, 0.85).multiplyScalar(30) }));
  sun.position.set(26, 38, -18);
  scene.add(sun);
  for (let k = 0; k < 10; k += 1) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    const h = 8 + (k % 3) * 5;
    const m = new Mesh(new BoxGeometry(5, h, 5), new MeshBasicMaterial({ color: new Color(0x9cc6ec).multiplyScalar(1.1) }));
    m.position.set(Math.cos(a) * 40, h / 2, Math.sin(a) * 40);
    scene.add(m);
  }
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return env;
};
