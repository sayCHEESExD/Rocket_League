import {
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { AvatarAppearance } from '@rlb/shared';
import { logger } from '../util/logger.js';

const SCOPE = 'bloxity/items';

/**
 * Every Bloxity slot that is a MESH hung on the body, in one table.
 *
 * Nine of the nineteen appearance slots are worn this way; the rest are body
 * parts (`BloxityRiderFactory`) or layers of the skin texture (the skin, face,
 * shirt and pants - `skinTextureUrl`). Each row says where the item's files
 * live on the CDN when the catalogue cannot say (`dir`) and how it is placed
 * (`mount`), and the numbers are Bloxity's own, from its avatar spec and the
 * SDK's renderer - these items are authored for that rig, so the values that
 * make them sit right are the ones they were authored against.
 *
 *  - `head`: a hat, and hair and masks loaded exactly like one - the same
 *    `hats` folder, on `Neck1`, lifted 0.8 up it. Worn together: a cap, a
 *    haircut and a pair of glasses are three items on one bone.
 *  - `back`: on `Spine2`, as the back item always was.
 *  - `rest`: neck, chest and waist. Parented to a spine bone with the local
 *    matrix restInverse(bone) * translate(origin) - the item is modelled in
 *    the body's rest-pose space, so the bone's rest transform is undone first
 *    and it then follows every pose and every bone scale the body does.
 *  - `pair`: hands and shoes. One id worn twice: on the left leaf bone, and a
 *    copy mirrored across x on the right. They follow the bone's POSITION and
 *    ROTATION but not its scale (see `BoneFollower`), because an arm stretched
 *    by `armLength` must not stretch the glove on its end.
 */
export type ItemMount =
  | { readonly kind: 'head' }
  | { readonly kind: 'back' }
  | { readonly kind: 'rest'; readonly bone: string; readonly origin: readonly [number, number, number] }
  | { readonly kind: 'pair'; readonly bone: string; readonly mirror: string };

export interface ItemSlot {
  readonly name: 'hat' | 'hair' | 'mask' | 'back' | 'neck' | 'chest' | 'waist' | 'hand' | 'shoes';
  readonly field: keyof AvatarAppearance;
  /** The CDN folder, for `specItemPaths`. */
  readonly dir: string;
  readonly mount: ItemMount;
}

export const ITEM_SLOTS: readonly ItemSlot[] = [
  { name: 'hat', field: 'hatId', dir: 'hats', mount: { kind: 'head' } },
  { name: 'hair', field: 'hairId', dir: 'hats', mount: { kind: 'head' } },
  { name: 'mask', field: 'maskId', dir: 'hats', mount: { kind: 'head' } },
  { name: 'back', field: 'backId', dir: 'back', mount: { kind: 'back' } },
  { name: 'neck', field: 'neckId', dir: 'neck', mount: { kind: 'rest', bone: 'Spine2', origin: [0, 4.8, 0] } },
  { name: 'chest', field: 'chestId', dir: 'chest', mount: { kind: 'rest', bone: 'Spine2', origin: [0, 3.6, 0] } },
  { name: 'waist', field: 'waistId', dir: 'waist', mount: { kind: 'rest', bone: 'Spine1', origin: [0, 2.4, 0] } },
  { name: 'hand', field: 'handId', dir: 'hand', mount: { kind: 'pair', bone: 'ArmL2_leaf', mirror: 'ArmR2_leaf' } },
  { name: 'shoes', field: 'shoesId', dir: 'shoes', mount: { kind: 'pair', bone: 'LegL2_leaf', mirror: 'LegR2_leaf' } },
];

/** One item's parsed mesh and its texture, shared by everybody wearing it. */
export interface ItemAsset {
  readonly template: Object3D;
  readonly texture: Texture;
}

/**
 * How long an item nobody is wearing stays parsed.
 *
 * Long enough to survive the one moment it is guaranteed to hit zero while
 * still wanted: a body rebuild, which takes every item off the old body and
 * puts the same items straight back on the new one. Without the grace period
 * a player changing HEAD would re-download and re-parse a three-megabyte
 * necklace they never took off.
 */
const EVICT_AFTER_MS = 15_000;

/**
 * THE WORN-ITEM CACHE: one parse per item, however many footballers wear it.
 *
 * Bloxity's accessory meshes are not small - a necklace can be a 3 MB OBJ, a
 * glove close to one - and a pitch of bots dressed from one catalogue list
 * wears the same few items over and over. Loading per wearer, as the hat code
 * once did, parsed each of them once PER PLAYER. Here an item is fetched and
 * parsed once, every wearer gets a `clone()` of it (clones share geometry),
 * and only the material is per wearer.
 *
 * Reference counted, so what is loaded is also disposed: the geometry and the
 * texture go when the last wearer has taken the item off (after
 * `EVICT_AFTER_MS`). A failed load is cached as null under the same rule, so a
 * broken item is not re-requested by every bot that wears it, yet is tried
 * again later rather than never.
 */
class ItemAssetCache {
  private readonly entries = new Map<
    string,
    { refs: number; promise: Promise<ItemAsset | null>; evict: ReturnType<typeof setTimeout> | null }
  >();
  private readonly objLoader = new OBJLoader();
  private readonly textureLoader = new TextureLoader();

  /**
   * Take a reference to an item and get it (or null if it cannot be had).
   *
   * Every acquire must be matched by exactly one `release(key)` with the key
   * returned here - whether or not the item is actually worn in the end.
   */
  acquire(meshUrl: string, textureUrl: string): { key: string; asset: Promise<ItemAsset | null> } {
    const key = `${meshUrl}|${textureUrl}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { refs: 0, promise: this.load(meshUrl, textureUrl), evict: null };
      this.entries.set(key, entry);
    }
    entry.refs += 1;
    if (entry.evict) {
      clearTimeout(entry.evict);
      entry.evict = null;
    }
    return { key, asset: entry.promise };
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs > 0 || entry.evict) return;
    entry.evict = setTimeout(() => {
      if (entry.refs > 0 || this.entries.get(key) !== entry) return;
      this.entries.delete(key);
      void entry.promise.then((asset) => {
        if (!asset) return;
        asset.template.traverse((child) => {
          if (child instanceof Mesh) child.geometry.dispose();
        });
        asset.texture.dispose();
      });
    }, EVICT_AFTER_MS);
  }

  private async load(meshUrl: string, textureUrl: string): Promise<ItemAsset | null> {
    const [template, texture] = await Promise.all([
      this.objLoader.loadAsync(meshUrl).catch(() => null),
      this.textureLoader.loadAsync(textureUrl).catch(() => null),
    ]);
    if (!template || !texture) {
      template?.traverse((child) => {
        if (child instanceof Mesh) child.geometry.dispose();
      });
      texture?.dispose();
      logger.warn(SCOPE, `item ${meshUrl} failed to load`);
      return null;
    }
    /*
     * NO `flipY = false` HERE, unlike the skin. The skin is applied to the GLB
     * body, and glTF puts the UV origin at the top left; these are OBJs, which
     * use the OpenGL convention three.js already defaults to. Forcing the glTF
     * rule onto them wraps every texture upside down, which on a helmet does
     * not read as upside down but as smeared garbage. Bloxity's renderer sets
     * `flipY` on the skin alone.
     */
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return { template, texture };
  }
}

export const itemAssets = new ItemAssetCache();

/**
 * One wearer's copy of a shared item: a clone of the template with its own
 * material, so disposing it never reaches another wearer's geometry.
 */
export const instantiate = (asset: ItemAsset): Object3D => {
  const object = asset.template.clone(true);
  const material = new MeshStandardMaterial({ map: asset.texture, roughness: 0.85 });
  object.traverse((child) => {
    if (child instanceof Mesh) {
      child.material = material;
      child.castShadow = true;
    }
  });
  return object;
};

/** Take a worn copy off and free what is its own: the material, never the shared geometry. */
export const discard = (object: Object3D): void => {
  object.removeFromParent();
  const seen = new Set<Material>();
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const material = child.material as Material | Material[];
    for (const entry of Array.isArray(material) ? material : [material]) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      entry.dispose();
    }
  });
};

const scratchMatrix = new Matrix4();
const scratchPosition = new Vector3();
const scratchRotation = new Quaternion();
const scratchScale = new Vector3();
const UNIT_SCALE = new Vector3(1, 1, 1);

/**
 * A node that follows a bone's POSITION and ROTATION but not its SCALE.
 *
 * What hands and shoes need, and what parenting cannot give: a child of a bone
 * inherits every scale above it - `armLength` on the upper arm, the torso and
 * shoulder widths on the spine - and a scale inherited through a rotated
 * parent is a SHEAR, which no counter-scale on the child can undo. So this
 * lives beside the skeleton, under the body's root, and rebuilds its own
 * matrix from the bone every time the scene's matrices are updated:
 *
 *   matrix = compose(bone position, bone rotation, scale 1) * local
 *
 * with the bone taken in the BODY ROOT's space (Bloxity's "world" is its
 * character; here the body is sized, turned and carried by the nodes above
 * its root, and this inherits exactly those by being the root's child).
 *
 * Hooked on `updateMatrixWorld` rather than a per-frame call from the game,
 * because a footballer is drawn from several places - the live frame, the
 * replay, the portrait snapshot - and every one of them renders through the
 * scene's matrix update, so none can draw a glove a frame behind its hand. The
 * bone's own chain is brought up to date first, so the order the scene
 * happens to visit the two in does not matter.
 */
export class BoneFollower extends Group {
  constructor(
    private readonly bone: Object3D,
    private readonly body: Object3D,
    private readonly local: Matrix4,
  ) {
    super();
    this.matrixAutoUpdate = false;
  }

  override updateMatrixWorld(force?: boolean): void {
    this.bone.updateWorldMatrix(true, false);
    scratchMatrix.copy(this.body.matrixWorld).invert().multiply(this.bone.matrixWorld);
    scratchMatrix.decompose(scratchPosition, scratchRotation, scratchScale);
    this.matrix.compose(scratchPosition, scratchRotation, UNIT_SCALE).multiply(this.local);
    this.matrixWorldNeedsUpdate = true;
    super.updateMatrixWorld(force);
  }

  /**
   * `Object3D.clone` builds the copy with `new this.constructor()` - no
   * arguments - which for this class would be a follower of nothing that
   * throws on the next matrix update. Nothing clones a dressed body today;
   * this keeps it safe if something ever does.
   */
  override clone(recursive?: boolean): this {
    return new BoneFollower(this.bone, this.body, this.local).copy(this, recursive) as this;
  }
}
