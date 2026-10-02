import type { Camera, Material, Object3D, Scene, Texture, WebGLRenderer } from 'three';

/** Every texture a material (or a shader material's uniforms) uses. */
const texturesOf = (material: Material, out: Set<Texture>): void => {
  for (const value of Object.values(material)) if (value && (value as Texture).isTexture) out.add(value as Texture);
  const uniforms = (material as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
  if (uniforms) for (const u of Object.values(uniforms)) if (u.value && (u.value as Texture).isTexture) out.add(u.value as Texture);
};

/**
 * GET A SCENE ONTO THE GPU BEFORE ANYONE LOOKS AT IT: compile every program
 * (asynchronously, where the driver can) and upload every texture - including
 * the ones on objects outside the current view, which a plain render would
 * leave for whichever frame first turns the camera towards them (the intro
 * sweeping across the stands was exactly that frame). Never throws.
 */
export const warmScene = async (renderer: WebGLRenderer, scene: Scene, camera: Camera): Promise<void> => {
  // compile skips hidden objects - and the effects (boost trails, the ball-cam ring, explosion
  // flashes) are hidden until their first use: show everything for the compile, then restore
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    /* the render that follows compiles anything this missed */
  } finally {
    for (const o of hidden) o.visible = false;
  }
  const textures = new Set<Texture>();
  scene.traverse((o: Object3D) => {
    const m = (o as Object3D & { material?: Material | Material[] }).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) texturesOf(mat, textures);
  });
  if (scene.environment) textures.add(scene.environment);
  for (const t of textures) {
    try {
      renderer.initTexture(t);
    } catch {
      /* a texture that cannot be uploaded yet will be on first use */
    }
  }
};
