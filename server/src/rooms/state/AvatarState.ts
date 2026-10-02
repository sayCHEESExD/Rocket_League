import { Schema, type } from '@colyseus/schema';
import {
  AVATAR_SLOTS,
  DEFAULT_APPEARANCE,
  DEFAULT_PROPORTIONS,
  type AvatarAppearance,
  type AvatarProportions,
} from '@rlb/shared';

/**
 * One player's Bloxity appearance, replicated so everyone draws everyone.
 *
 * A nested schema rather than twenty-six more fields on `PlayerState`, because
 * these belong together and are written together: Colyseus sends only what
 * changed, so an appearance that never changes - the overwhelmingly common
 * case, since a player dresses once and then runs - costs one patch on join
 * and nothing afterwards.
 *
 * Every value arrives from a client and is sanitised before it is written
 * here. Nothing on this schema is read by the simulation, and nothing on it
 * can be: it is what a renderer draws, and the renderer runs on the far side
 * of the wire.
 */
export class AvatarState extends Schema {
  @type('string') skinId = DEFAULT_APPEARANCE.skinId;
  @type('string') headId = DEFAULT_APPEARANCE.headId;
  @type('string') torsoId = DEFAULT_APPEARANCE.torsoId;
  @type('string') armLId = DEFAULT_APPEARANCE.armLId;
  @type('string') armRId = DEFAULT_APPEARANCE.armRId;
  @type('string') legLId = DEFAULT_APPEARANCE.legLId;
  @type('string') legRId = DEFAULT_APPEARANCE.legRId;
  @type('string') hatId = DEFAULT_APPEARANCE.hatId;
  @type('string') backId = DEFAULT_APPEARANCE.backId;
  /*
   * The ten slots Bloxity added after the first nine. Twenty-six fields in
   * all, comfortably under the schema's 64-per-class limit - and strings that
   * are empty for most players, which Colyseus sends once on join and never
   * again.
   */
  @type('string') hairId = DEFAULT_APPEARANCE.hairId;
  @type('string') maskId = DEFAULT_APPEARANCE.maskId;
  @type('string') faceId = DEFAULT_APPEARANCE.faceId;
  @type('string') shirtId = DEFAULT_APPEARANCE.shirtId;
  @type('string') pantsId = DEFAULT_APPEARANCE.pantsId;
  @type('string') neckId = DEFAULT_APPEARANCE.neckId;
  @type('string') chestId = DEFAULT_APPEARANCE.chestId;
  @type('string') waistId = DEFAULT_APPEARANCE.waistId;
  @type('string') handId = DEFAULT_APPEARANCE.handId;
  @type('string') shoesId = DEFAULT_APPEARANCE.shoesId;

  @type('float32') height = DEFAULT_PROPORTIONS.height;
  @type('float32') shoulderWidth = DEFAULT_PROPORTIONS.shoulderWidth;
  @type('float32') armLength = DEFAULT_PROPORTIONS.armLength;
  @type('float32') legOffsetX = DEFAULT_PROPORTIONS.legOffsetX;
  @type('float32') torsoScaleX = DEFAULT_PROPORTIONS.torsoScaleX;
  @type('float32') neckHeight = DEFAULT_PROPORTIONS.neckHeight;
  @type('float32') headScale = DEFAULT_PROPORTIONS.headScale;

  /**
   * Write a sanitised look in place.
   *
   * In PLACE, and field by field: replacing the schema object would send the
   * whole thing to every client whether or not a slot had actually moved,
   * which is the same reason the leaderboard rows are written rather than
   * rebuilt.
   *
   * The ids go through `AVATAR_SLOTS` rather than a hand-written copy of it:
   * a slot added to the shared list is replicated without anyone remembering
   * this file (the field above still has to exist, and the compiler insists).
   */
  apply(appearance: AvatarAppearance, proportions: AvatarProportions): void {
    for (const slot of AVATAR_SLOTS) this[slot] = appearance[slot];

    this.height = proportions.height;
    this.shoulderWidth = proportions.shoulderWidth;
    this.armLength = proportions.armLength;
    this.legOffsetX = proportions.legOffsetX;
    this.torsoScaleX = proportions.torsoScaleX;
    this.neckHeight = proportions.neckHeight;
    this.headScale = proportions.headScale;
  }
}
