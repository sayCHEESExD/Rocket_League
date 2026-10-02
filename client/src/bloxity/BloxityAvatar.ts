import {
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  SRGBColorSpace,
  TextureLoader,
  type Bone,
  type Group,
  type Object3D,
  type Texture,
} from 'three';
import { logger } from '../util/logger.js';
import {
  DEFAULT_SKIN_URL,
  assetUrl,
  describeItem,
  skinTextureUrl,
  specItemPaths,
} from './bloxityAssets.js';
import { bloxityRiderFactory } from './BloxityRiderFactory.js';
import {
  isEquippedId,
  type LegionEquipped,
  type LegionProportions,
} from './legionTypes.js';
import {
  BoneFollower,
  ITEM_SLOTS,
  discard,
  instantiate,
  itemAssets,
  type ItemAsset,
  type ItemSlot,
} from './wornItems.js';
import { neckScale } from '@rlb/shared';

const SCOPE = 'bloxity/avatar';

type SlotName = ItemSlot['name'];

/**
 * Bloxity cosmetics, applied to whichever body a footballer is wearing.
 *
 * Three things are applied, and the choice of which three is deliberate:
 *
 *  - the SKIN, as a texture swap on the body's own material - and the skin
 *    is where the FACE, SHIRT and PANTS go too, because Bloxity composites
 *    those into one texture server-side (`skinTextureUrl`);
 *  - the WORN ITEMS - hat, hair, mask, back, neck, chest, waist, hands and
 *    shoes - as meshes placed against real bones (`ITEM_SLOTS` says how);
 *  - the PROPORTIONS, as scales and offsets on those same bones.
 *
 * The body PARTS are not applied here: those replace geometry on the body
 * itself and so belong to whatever built it - see `BloxityRiderFactory`. This
 * class dresses whichever body is currently mounted, Bloxity body or bundled
 * `player.fbx`, which is why `rebind` exists.
 *
 * Asset paths come from Bloxity's item catalogue first: an id is looked up and
 * its `assetPaths` are used verbatim. Only when the catalogue cannot describe
 * an item does the spec's own path pattern stand in (`specItemPaths`).
 *
 * Every load is asynchronous and every one may fail. None of them throws into
 * a frame: a failure is logged and the slot is simply left empty.
 */
export class BloxityAvatar {
  private riderVisual: Group;
  /** The body's root: what rest poses are measured in, and where followers live. */
  private riderModel: Object3D;
  private bones: ReadonlyMap<string, Bone>;
  /** True while the rider is a Bloxity body rather than the bundled one. */
  private wearingBloxityBody = false;

  /** The rider's own material, cloned so remote players keep the default. */
  private material: MeshStandardMaterial | null = null;
  /** The texture the model shipped with, to go back to when a skin is removed. */
  private defaultMap: Texture | null = null;
  /** The skin texture THIS avatar loaded and so owns - disposed when replaced. */
  private skinTexture: Texture | null = null;

  /** What each slot is wearing on this body, and the cache reference it holds. */
  private readonly attachments = new Map<SlotName, { nodes: Object3D[]; key: string }>();

  /*
   * What is currently WORN in each slot.
   *
   * THREE states, not two, and the third is the whole reason this is not a
   * plain `string | null`: undefined (for the skin; a MISSING key for the
   * items) means "nothing has been applied to this body yet", null means
   * "applied, and the answer was none".
   *
   * Collapsing those two is a real bug and it shipped. A rebind used to set
   * these to `null` to mean "re-wear everything", but for a player with no
   * skin equipped the WANTED value is also `null` - so the comparison in
   * `applySkin` matched, the load was skipped, and a freshly built Bloxity
   * body was left with no texture at all, which renders white.
   */
  /** The skin as a key: the composite URL, else the plain skin id, else null. */
  private currentSkin: string | null | undefined = undefined;
  private readonly worn = new Map<SlotName, string | null>();
  /**
   * A generation per slot, bumped on every change and on every rebind.
   *
   * An item is fetched over the network, so a slot can change - or the whole
   * body be swapped - while its load is in flight. A load that finishes under
   * a newer token is thrown away instead of being attached. Comparing the id
   * alone is not enough: a rebind re-wears the SAME id, and the old load
   * would then land on the new body next to the new load's copy.
   */
  private readonly tokens = new Map<SlotName, number>();

  private readonly textureLoader = new TextureLoader();

  private disposed = false;

  constructor(riderVisual: Group, riderModel: Object3D) {
    this.riderVisual = riderVisual;
    this.riderModel = riderModel;
    this.bones = collectBones(riderModel);
    this.material = this.cloneRiderMaterial(riderModel);
    this.defaultMap = this.material?.map ?? null;
  }

  /**
   * Wear what the account has equipped.
   *
   * Safe to call on every avatar event: each slot is compared against what is
   * already worn, so the common case - a proportions change - touches no
   * network at all.
   */
  apply(equipped: LegionEquipped, proportions: LegionProportions): void {
    if (this.disposed) return;

    this.applySkin(equipped);
    for (const slot of ITEM_SLOTS) {
      this.wear(slot, equipped[slot.field] ?? null).catch((error: unknown) => {
        logger.warn(SCOPE, `${slot.name} could not be worn: ${String(error)}`);
      });
    }
    this.applyProportions(proportions);
  }

  /**
   * Follow the rider onto a new body.
   *
   * Called when the mount swaps in a Bloxity avatar, or swaps back to the
   * bundled one. Everything this class holds is bound to a particular model -
   * the bones it hangs items on, the material it re-skins - so a swap has to
   * re-collect all of it and then re-wear what was already worn, which is what
   * forgetting every slot arranges: the next `apply` sees every slot as changed
   * and puts it back on the new body. (The item cache keeps what was just
   * taken off parsed for a while, so putting it back costs no download.)
   */
  rebind(riderVisual: Group, riderModel: Object3D, bloxityBody: boolean): void {
    this.takeOffAll();

    this.riderVisual = riderVisual;
    this.riderModel = riderModel;
    this.bones = collectBones(riderModel);
    this.material = this.cloneRiderMaterial(riderModel);
    this.defaultMap = this.material?.map ?? null;
    this.wearingBloxityBody = bloxityBody;

    // The old body's material went with it; the texture on it was ours.
    this.skinTexture?.dispose();
    this.skinTexture = null;

    // UNDEFINED / missing, not null: "not applied to this body yet". See the fields.
    this.currentSkin = undefined;
    this.worn.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.takeOffAll();
    this.skinTexture?.dispose();
    this.skinTexture = null;
    this.material?.dispose();
    this.material = null;
  }

  // ------------------------------------------------------------------ skin

  /**
   * Pick the body texture: the COMPOSITE when a face, shirt or pants is worn,
   * the plain skin otherwise.
   *
   * Keyed on the URL-ish value rather than on the skin id, because changing
   * only the shirt is a different texture on the same skin.
   */
  private applySkin(equipped: LegionEquipped): void {
    const skinId = isEquippedId(equipped.skinId) ? equipped.skinId : null;
    const composite = skinTextureUrl(equipped);
    const wanted = composite ?? skinId;
    if (wanted === this.currentSkin) return;
    this.currentSkin = wanted;
    this.loadSkin(wanted, skinId, composite).catch((error: unknown) => {
      logger.warn(SCOPE, `skin could not be applied: ${String(error)}`);
    });
  }

  /**
   * Put a skin on the body.
   *
   * Tried as a short list, best first, so one failure does not leave a body
   * white: the composite (a render on Bloxity's API, the part most likely to
   * have a bad moment), then the plain skin, then - on a Bloxity body - the
   * portal's own default skin. A Bloxity body with no skin equipped is not
   * bare - it wears that default, which is what their renderer falls back to.
   * The bundled rider instead goes back to the texture it shipped with,
   * because a Bloxity skin is authored for a different UV layout entirely.
   */
  private async loadSkin(
    key: string | null,
    skinId: string | null,
    composite: string | null,
  ): Promise<void> {
    const material = this.material;
    if (!material) return;

    const candidates: string[] = [];
    if (composite) candidates.push(composite);
    if (skinId) {
      const item = await describeItem(skinId);
      candidates.push(assetUrl(item?.assetPaths?.texture ?? specItemPaths('skins', skinId).texture));
    }
    if (this.wearingBloxityBody) candidates.push(DEFAULT_SKIN_URL);

    // Still wanted, on this body? The player may have changed while this was in flight.
    const stale = (): boolean =>
      this.disposed || this.currentSkin !== key || this.material !== material;
    if (stale()) return;

    if (candidates.length === 0) {
      this.setSkinMap(material, this.defaultMap, null);
      return;
    }

    for (const url of candidates) {
      let texture: Texture;
      try {
        texture = await this.textureLoader.loadAsync(url);
      } catch {
        logger.warn(SCOPE, `skin ${url} failed to load`);
        continue;
      }
      if (stale()) {
        texture.dispose();
        return;
      }
      texture.colorSpace = SRGBColorSpace;
      // glTF puts the UV origin at the top left; this skin goes on the GLB body.
      texture.flipY = false;
      // Bloxity skins are pixel art. Smoothing them turns a face into a
      // smudge, which is why their own renderer filters them this way too.
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      this.setSkinMap(material, texture, texture);
      return;
    }
  }

  /** Swap the body's map, disposing the skin this avatar owned before. */
  private setSkinMap(material: MeshStandardMaterial, map: Texture | null, owned: Texture | null): void {
    material.map = map;
    material.needsUpdate = true;
    if (this.skinTexture && this.skinTexture !== owned) this.skinTexture.dispose();
    this.skinTexture = owned;
  }

  // ------------------------------------------------------------------ items

  /**
   * Put one slot's item on, or take it off.
   *
   * To a BONE, never to the rider group: an item hung off the group would keep
   * its own idea of where the head is while the head moved, which is the same
   * class of mistake as copying a transform a frame late.
   */
  private async wear(slot: ItemSlot, id: string | null): Promise<void> {
    const wanted = isEquippedId(id) ? id : null;
    if (this.worn.has(slot.name) && this.worn.get(slot.name) === wanted) return;
    this.worn.set(slot.name, wanted);
    const token = (this.tokens.get(slot.name) ?? 0) + 1;
    this.tokens.set(slot.name, token);

    this.takeOff(slot.name);
    if (!wanted) return;

    /*
     * Rest-pose accessories only go on a BLOXITY body. They are placed with
     * `player.glb`'s rest transforms, and the bundled `player.fbx` is another
     * rig in other units: there is no honest place on it for a Bloxity glove.
     * The bundled body is only ever the fallback for Bloxity being
     * unreachable - in which case these meshes could not be fetched either.
     * The slot is still recorded as worn, and a rebind onto a Bloxity body
     * puts it on.
     */
    const kind = slot.mount.kind;
    if ((kind === 'rest' || kind === 'pair') && !this.wearingBloxityBody) return;

    const stale = (): boolean => this.disposed || this.tokens.get(slot.name) !== token;

    // The catalogue knows where the item lives; the spec's pattern is the fallback.
    const item = await describeItem(wanted);
    if (stale()) return;
    const listed = item?.assetPaths;
    const paths =
      listed?.mesh && listed.texture
        ? { mesh: listed.mesh, texture: listed.texture }
        : specItemPaths(slot.dir, wanted);
    if (!paths.mesh) return;

    const { key, asset: pending } = itemAssets.acquire(assetUrl(paths.mesh), assetUrl(paths.texture));
    const asset = await pending;
    if (!asset || stale()) {
      itemAssets.release(key);
      return;
    }

    let nodes: Object3D[] | null = null;
    try {
      nodes = this.place(slot, asset);
    } catch (error: unknown) {
      logger.warn(SCOPE, `${slot.name} ${wanted} could not be placed: ${String(error)}`);
    }
    if (!nodes) {
      itemAssets.release(key);
      return;
    }
    this.attachments.set(slot.name, { nodes, key });
    logger.info(SCOPE, `wearing ${slot.name} ${wanted}`);
  }

  /** Hang an item's copies on this body, per its slot's mount. Null if the bones are missing. */
  private place(slot: ItemSlot, asset: ItemAsset): Object3D[] | null {
    const mount = slot.mount;
    const native = this.wearingBloxityBody;

    if (mount.kind === 'head' || mount.kind === 'back') {
      const anchor = this.bones.get(mount.kind === 'head' ? 'Neck1' : 'Spine2');
      if (!anchor) {
        logger.warn(SCOPE, `no bone to hang a ${slot.name} on`);
        return null;
      }
      const object = instantiate(asset);
      // An item is sized against the BONE it hangs on, and the two bodies do
      // not share a bone space: `player.fbx` is authored in centimetres and
      // scaled down on load, while the Bloxity body is the rig these items
      // were made for. So a Bloxity body gets Bloxity's own numbers - scale 1,
      // a head item lifted 0.8 up the head bone, a back item sitting on the
      // spine - and the bundled body keeps the values tuned for it.
      object.scale.setScalar(native ? 1 : ITEM_SCALE);
      if (mount.kind === 'head') object.position.set(0, native ? BLOXITY_HAT_LIFT : HAT_LIFT, 0);
      else object.position.set(0, 0, native ? 0 : BACK_OFFSET);
      anchor.add(object);
      return [object];
    }

    if (mount.kind === 'rest') {
      const bone = this.bones.get(mount.bone);
      const restInverse = bloxityRiderFactory.restInverse(mount.bone);
      if (!bone || !restInverse) {
        logger.warn(SCOPE, `no rest pose for ${mount.bone}; ${slot.name} not worn`);
        return null;
      }
      // local = restInverse(bone) * translate(origin), as a child of the bone:
      // at rest it lands exactly where it was modelled, and from then on it
      // bends, turns AND scales with the bone - the torso proportions below
      // widen the chest under a chest piece, and the piece widens with it.
      const [x, y, z] = mount.origin;
      const local = restInverse.clone().multiply(new Matrix4().makeTranslation(x, y, z));
      const object = instantiate(asset);
      local.decompose(object.position, object.quaternion, object.scale);
      bone.add(object);
      return [object];
    }

    // A PAIR: the item on the left leaf, a mirrored copy on the right one.
    const nodes: Object3D[] = [];
    for (const [boneName, mirrored] of [
      [mount.bone, false],
      [mount.mirror, true],
    ] as const) {
      const bone = this.bones.get(boneName);
      const restInverse = bloxityRiderFactory.restInverse(boneName);
      if (!bone || !restInverse) {
        logger.warn(SCOPE, `no rest pose for ${boneName}; ${slot.name} not worn`);
        for (const node of nodes) discard(node);
        return null;
      }
      // restInverse(bone) * scale(-1, 1, 1) for the right side: the model is
      // authored once, for the left, and mirrored across the body's x. The
      // mirror flips the triangle winding, which three.js corrects for any
      // object whose world matrix has a negative determinant.
      const local = restInverse.clone();
      if (mirrored) local.multiply(new Matrix4().makeScale(-1, 1, 1));
      const follower = new BoneFollower(bone, this.riderModel, local);
      follower.name = `${slot.name}-${mirrored ? 'R' : 'L'}`;
      follower.add(instantiate(asset));
      this.riderModel.add(follower);
      nodes.push(follower);
    }
    return nodes;
  }

  private takeOff(name: SlotName): void {
    const attachment = this.attachments.get(name);
    if (!attachment) return;
    for (const node of attachment.nodes) discard(node);
    itemAssets.release(attachment.key);
    this.attachments.delete(name);
  }

  /** Everything off, and every in-flight load made stale. */
  private takeOffAll(): void {
    for (const name of [...this.attachments.keys()]) this.takeOff(name);
    for (const slot of ITEM_SLOTS) this.tokens.set(slot.name, (this.tokens.get(slot.name) ?? 0) + 1);
  }

  // ----------------------------------------------------------- proportions

  /**
   * Apply the account's proportions.
   *
   * Scale and POSITION only - never rotation. `PlayerRig` rebuilds every
   * bone's quaternion from its rest pose on every single frame, so a rotation
   * written here would be gone before it was drawn; scale and position are
   * untouched by it and therefore survive.
   *
   * BONES, not `skeleton.boneMatrices` - and that settles what the worn items
   * need. Bloxity's spec has two cases: a renderer that bends vertices by
   * editing bone matrices must shift the hand and shoe copies sideways and
   * widen neck/chest/waist pieces by hand, because the bones themselves never
   * moved; a renderer that moves the BONES gets all of that for free. This is
   * the second kind. A rest-pose item is a child of its spine bone and scales
   * with it; a hand or shoe follower reads its bone's position every frame,
   * and that position already carries the wider shoulders (the arms hang off
   * the scaled `Spine2`) and the wider straddle (`LegL1`/`LegR1` are moved).
   * So no compensation is applied, and adding the spec's would double it.
   */
  private applyProportions(p: LegionProportions): void {
    const num = (value: number, fallback = 1): number =>
      Number.isFinite(value) && value > 0 ? value : fallback;

    // Height scales the whole rider. The robot's seat is a fixed point, so
    // this grows the rider upward from where they sit rather than through the
    // robot's back.
    this.riderVisual.scale.setScalar(num(p.height));

    const spine1 = this.bones.get('Spine1');
    if (spine1) spine1.scale.x = num(p.torsoScaleX);

    const spine2 = this.bones.get('Spine2');
    if (spine2) spine2.scale.x = num(p.shoulderWidth);

    /*
     * The portal's head proportion, TIMES this game's own.
     *
     * Not `setScalar(num(p.headScale))`. That ran after the rig was bound and
     * overwrote the enlargement the pilot needs to be recognisable from the
     * chase camera, putting almost every player back on a head scale of
     * exactly 1. `neckScale` multiplies the two, so a player's own choice
     * still does what they chose.
     */
    const neck = this.bones.get('Neck1');
    if (neck) neck.scale.setScalar(neckScale(num(p.headScale)));

    for (const name of ['ArmL1', 'ArmR1'] as const) {
      const bone = this.bones.get(name);
      if (bone) bone.scale.y = num(p.armLength);
    }

    // `legOffsetX` is a straddle, so it moves the legs apart rather than
    // scaling them: the rider is sitting on a barrel, and that is the one
    // proportion this game's pose actually cares about.
    const straddle = Number.isFinite(p.legOffsetX) ? p.legOffsetX : 1;
    for (const [name, side] of [['LegL1', 1], ['LegR1', -1]] as const) {
      const bone = this.bones.get(name);
      if (!bone) continue;
      bone.position.x = bone.userData['restX'] as number ?? bone.position.x;
      if (bone.userData['restX'] === undefined) bone.userData['restX'] = bone.position.x;
      bone.position.x = (bone.userData['restX'] as number) + side * (straddle - 1) * LEG_SPREAD;
    }
  }

  /**
   * Give the local rider its own material.
   *
   * Every instance shares ONE material by design, which is exactly right until
   * one of them needs a different skin - at which point writing to it would
   * re-skin every remote player too.
   */
  private cloneRiderMaterial(model: Object3D): MeshStandardMaterial | null {
    let cloned: MeshStandardMaterial | null = null;
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      // Gear bolted to the bones (the cutter) keeps its own material.
      if (isGear(child)) return;
      const material = child.material;
      if (!(material instanceof MeshStandardMaterial)) return;
      cloned ??= material.clone();
      child.material = cloned;
    });
    return cloned;
  }
}

/** How big a CDN item is, in the bone space it hangs in. */
const ITEM_SCALE = 0.9;
/** A hat sits above the head bone's origin, on the bundled body. */
const HAT_LIFT = 0.55;
/**
 * The same lift on a Bloxity body.
 *
 * Bloxity's own figure, not a tuned one: their renderer parents a hat to the
 * head bone at `(0, 0.8, 0)`. These items are authored for that rig, so the
 * number that makes them sit right is theirs.
 */
const BLOXITY_HAT_LIFT = 0.8;
/** A back item sits behind the chest. */
const BACK_OFFSET = -0.35;
/** World units the legs move apart per unit of `legOffsetX`. */
const LEG_SPREAD = 0.12;

/** True for anything under a mount the game bolted to a bone: never re-skinned. */
const isGear = (object: Object3D): boolean => {
  for (let at: Object3D | null = object; at; at = at.parent) if (at.userData['gear'] === true) return true;
  return false;
};

/** The rig's bones, by name. Same first-bone rule `PlayerRig` uses. */
const collectBones = (model: Object3D): Map<string, Bone> => {
  const found = new Map<string, Bone>();
  model.traverse((child) => {
    const bone = child as Bone;
    if (bone.isBone && !found.has(bone.name)) found.set(bone.name, bone);
  });
  return found;
};
