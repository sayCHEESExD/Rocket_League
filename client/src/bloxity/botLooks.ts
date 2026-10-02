import { DEFAULT_APPEARANCE, type AvatarAppearance } from '@rlb/shared';

/**
 * BOTS WEAR REAL BLOXITY ITEMS, so a pitch of bots looks like a pitch of
 * players: an outfit (skin), a real haircut, sometimes a cap or glasses, now
 * and then a face, a shirt and pants or a pair of shoes, and a head shape -
 * all from Bloxity's public catalogue (`GET https://api.bloxity.io/v1/avatar/items`,
 * every id below checked against it on 2026-09-30), chosen by the bot's `look`
 * so every client dresses the same bot the same way. Items that fail to load
 * simply leave that slot empty.
 *
 * NOTHING HERE IS MOSTLY RED OR BLUE. With no uniforms, the team is shown by
 * the ring, the name plate and the marker; a bot in a red shirt on the Blue
 * team reads as a Red player, so every list was picked by looking at the items
 * with that rule in mind (the old Crimson Headband was dropped for it).
 */

/** Real `hair` items: natural colours, a mix of short, long, spiked and tied. */
const HAIR: readonly string[] = [
  '6a4fe904a8f5d46b881cdb8e', // Silver Spike Hair
  '6a4fdd0ba8f5d46b881608e2', // Ash Spike Hair
  '6a5fc1b82569bb07ad28cf4e', // Chestnut Waves
  '6a50080d1dc04005b8daee77', // Raven Spike Hair
  '6a5fbfba293c46117092394c', // Golden Waves
  '6a5fb1165b56c1647d739d06', // Espresso Straight Hair
  '6a5fb8496bc581447f1bf786', // Braided Brown Hair
  '6a5f55de49230685c1b0a7af', // Honey Long Hair
  '6a4e03ebad3e41fe381e53ad', // Midnight Spike Hair
  '6a5fabe85b56c1647d718ffc', // Mocha Long Hair
  '6a5fe637d1632552ee42306e', // Chestnut Bun
  '6a4e0020ad3e41fe381d280b', // Wild Black Spikes
  '6a66ebda21e7b205cbcc23f4', // Sandy Spike Hair
  '6a67805621e7b205cbe9c646', // Scruffy Grey Hair
  '6a4fed1fa8f5d46b881f6b3b', // Dusty Mop Hair
  '6a4fd611a8f5d46b8810b858', // Golden Spike Hair
  '6a66ffbc21e7b205cbcdf211', // Flaxen Mop Hair
  '6a4e0437ad3e41fe381e68a9', // Chestnut Spikes
  '6a4e0008ad3e41fe381d20d3', // Umber Spikes
  '6a5fc5efe7e02debd6ed605c', // Dark Bob
  '6a6705bc21e7b205cbce6713', // Sandy Crop Hair
  '6a5fdf72e7e02debd6f7b5de', // Clipped Brown Hair
  '6a66f88521e7b205cbcd5ea7', // Onyx Crop Hair
  '6a67792421e7b205cbe5bbe5', // Straw Mop Hair
  '6a66feb121e7b205cbcddccc', // Silver Mop Hair
];

/**
 * Hairstyles the catalogue files as HATS. Worn in the hat slot INSTEAD of
 * hair: two haircuts on one head is a helmet of hair.
 */
const HAIR_HATS: readonly string[] = [
  '6a44d52d089e7e9a7db5aad6', // Feral Mane
];

/** Caps and beanies, worn OVER a haircut - hair and hat are separate slots. */
const CAPS: readonly string[] = [
  '6a44d5c6089e7e9a7db5d03c', // Floral Cap
  '6a44d5be089e7e9a7db5ce7c', // City Cap
  '6a44d5c2089e7e9a7db5cf82', // Graffiti Cap
  '6a44d57b089e7e9a7db5bd8e', // White Beanie
  '6a44d4ea089e7e9a7db59814', // Gray Beanie
  '6a44d5cf089e7e9a7db5d242', // Star Cap
  '6a44d51f089e7e9a7db5a73d', // Gray Cap
  '6a44d4e6089e7e9a7db5974e', // Bucket Hat
  '6a44d4b7089e7e9a7db58a45', // White Cap
  '69c816c73ecd845acf823167', // Black Flat Cap
  '69c816bf3ecd845acf823110', // Olive Garrison Cap
  '6a98472f221a5efc42b9c284', // cool hat 26
  '69c816c63ecd845acf82315e', // Slate Bolt Crest
];

/** `mask` items: glasses and shades, nothing that hides the face. */
const GLASSES: readonly string[] = [
  '6a44d4e4089e7e9a7db596b7', // Black Glasses
  '6a44d523089e7e9a7db5a863', // Thin Glasses
  '6a44d5ab089e7e9a7db5c9cf', // Sport Shades
  '6a44d4ec089e7e9a7db598b4', // Cheetah Sunglasses
  '6a44d4e7089e7e9a7db597a5', // Rimless Glasses
  '6a44d58e089e7e9a7db5c206', // Round Glasses
  '6a44c5c5089e7e9a7db1106e', // Wire Frame Glasses
];

/** `face` items: dark, brown, green or amber eyes - no red or blue ones. */
const FACES: readonly string[] = [
  '6ab60ad10620ae2cf91aeec0', // Face 1
  '6ab60c8bca852e4c1354bf5c', // Face 3
  '6ab60c998a9c9d744a1b4385', // Face 12
  '6ab60c89ca852e4c1354be88', // Face 2
  '6ab60c9b0620ae2cf91be835', // Face 13
  '6ab60c8c0620ae2cf91be197', // Face 4
  '6ab60cb1ca852e4c1354d071', // Face 27
  '6ab60cae8a9c9d744a1b4d5e', // Face 25
  '6ab60c94ca852e4c1354c3a4', // Face 9
  '6ab60cb3ca852e4c1354d110', // Face 28
  '6ab60cb5ca852e4c1354d1b1', // Face 29
  '6ab60cd70620ae2cf91c0627', // Face 51
  '6ab60cd48a9c9d744a1b607e', // Face 49
  '6ab60cc40620ae2cf91bfd75', // Face 39
];

/** `shirt` items in greys, whites, browns, olives and greens. */
const SHIRTS: readonly string[] = [
  '6ab63d6f82c0fe30369d49f3', // Shirt 7
  '6ab63d714af02b1331f1a845', // Shirt 8
  '6ab63d6a4af02b1331f1a53c', // Shirt 4
  '6ab63d6c82c0fe30369d48b6', // Shirt 5
  '6abab1f405a72c79e2e847b9', // Shirt_26
  '6abab21b70618987edf25b52', // Shirt_30
  '6abab1a270618987edf20613', // Shirt_21
  '6abab915b7f49bffd39a2ab4', // Shirt_38
  '6aba99b0172caa08e4a7e3e6', // Shirt_9
  '6abac32993a128297ed0a6a3', // Shirt_49
  '6abab1fe17b8feef41868b4b', // Shirt_27
  '6abab8d5748a8f7d4f38fa1f', // Shirt_31
  '6abab902bfae980ff12e431e', // Shirt_36
  '6abac2f4e093f2e00856037c', // Shirt_44
  '6abab8e8d81f8cafc527e543', // Shirt_33
  '6abac29d70618987edfe299b', // Shirt_41
  '6abac30005a72c79e2f5890c', // Shirt_45
  '6abab8fab7f49bffd39a1409', // Shirt_35
  '6abab1d593a128297ec4337f', // Shirt_25
  '6abac36005a72c79e2f5e3e3', // Shirt_53
];

/** `pants` items: blacks, greys, olives and camo. */
const PANTS: readonly string[] = [
  '6ab60ad90620ae2cf91af2f3', // Pants 1
  '6ab60cfb8a9c9d744a1b75ff', // Pants 9
  '6ab60d100620ae2cf91c26f0', // Pants 21
  '6ab60d1cca852e4c1354ff4d', // Pants 28
  '6ab60cf78a9c9d744a1b7416', // Pants 7
  '6ab60cf68a9c9d744a1b72e5', // Pants 6
  '6aba4965d1d71646b29fa9ae', // Pants_8
  '6ab60d1e8a9c9d744a1b8a67', // Pants 29
  '6ab60d010620ae2cf91c1ed1', // Pants 13
  '6aba4b2c2e312c0925570193', // Pants_31
  '6ab60d038a9c9d744a1b7ad4', // Pants 14
  '6aba48d0107a5003ae3c2508', // Pants_1
];

/**
 * `shoes`: the one pair of the catalogue's six that is neither red, blue,
 * purple nor pink (Shoes 6 looks black from the front but has red heels).
 * Boots are what a footballer's feet are for.
 */
const SHOES: readonly string[] = [
  '6ab64c903e750aae4d2093b3', // Shoes 1 (white and black)
];

/**
 * Everyday outfits. Nothing mostly red or blue: with no uniforms, a bot in a
 * red hoodie on the Blue team would be confusing.
 */
const OUTFITS: readonly string[] = [
  '69d8a70b2240b84a28355eeb', // Midnight Denim
  '6a05227281f9706108234f12', // Wanderer
  '69cccd98e846506e2c476254', // Patchwork
  '6a1706a6d4201907d64acbeb', // Grey Tactical Rig
  '69c816ee3ecd845acf8232fc', // Starter Bundle
  '69cf6a006beecd2f1a3bc792', // Crisp White
  '69e1b0938d404ab25a210f29', // Coral
  '69d9f4ed83cf7151394bb6c6', // Misty
  '69fb8c5f72ac4dc84d04a2bc', // Obsidian Tee
  '6a07c1f698605c8317b3b6b4', // Claywalker
  '6a340818fc4fae7a288456c3', // Shadow Casual
  '6a1166852607e8a27115d9c1', // Frostbyte
  '6a1164542607e8a27115a976', // Toxin
  '69d361ef898417846b76f8b2', // Graphite
  '69cd97305f01496f7ab21926', // Dust Bowl
  '69d9f57883cf7151394bb91d', // Snow Hoodie
  '69cb0115c3c4aac219abd921', // Tangerine Smile
  '6a33e8e79e836249988851d5', // Chain Streetwear
  '6a4069b1cb8211ae598b9201', // Panda Hoodie
  '69d35e1b898417846b76ee64', // Pewter Basics
];

const HEADS: readonly string[] = [
  '', // the stock head
  '69d616eb89c7be405c2a49ce', // Roundy Head
  '69d6170c89c7be405c2a4a42', // Chubby Head
  '69d4ba11898417846b7a9af7', // Bevelled Head
  '', // the stock head again: the most common look
];

/**
 * A small deterministic generator (mulberry32) seeded from the bot.
 *
 * One draw per decision, rather than slicing bits off a single hash: the old
 * three choices fitted in one 32-bit hash, the eleven below do not, and bits
 * reused between decisions would tie them together (every bot with a given
 * cap wearing the same glasses).
 */
const generator = (seed: number): (() => number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (list: readonly string[], roll: number): string =>
  list[Math.floor(roll * list.length) % list.length] ?? '';

/**
 * A bot's catalogue look from its replicated `look` and its id.
 *
 * The odds keep the extras EXTRAS: most bots are an outfit and a haircut, and
 * the composite skin (face/shirt/pants) is a separate texture per combination
 * rendered by Bloxity's API, so it is the rarest thing a bot wears.
 */
export const botAppearance = (look: number, id: string): AvatarAppearance => {
  let hash = look * 2654435761;
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  const roll = generator(hash >>> 0);

  const outfit = pick(OUTFITS, roll());
  const head = pick(HEADS, roll());

  // Hair: a real haircut for most, a hat-hairstyle for a few, bald for some.
  let hairId = '';
  let hatId = '';
  const style = roll();
  if (style < 0.1) hatId = pick(HAIR_HATS, roll());
  else if (style < 0.9) hairId = pick(HAIR, roll());
  // A cap over whatever haircut there is - never over a hat-hairstyle.
  if (!hatId && roll() < 0.3) hatId = pick(CAPS, roll());

  const maskId = roll() < 0.15 ? pick(GLASSES, roll()) : '';
  const faceId = roll() < 0.25 ? pick(FACES, roll()) : '';
  // Shirt and pants go together: half an outfit over a skin reads as a glitch.
  const dressed = roll() < 0.2;
  const shirtId = dressed ? pick(SHIRTS, roll()) : '';
  const pantsId = dressed ? pick(PANTS, roll()) : '';
  const shoesId = roll() < 0.35 ? pick(SHOES, roll()) : '';

  return {
    ...DEFAULT_APPEARANCE,
    skinId: outfit,
    headId: head,
    hatId,
    hairId,
    maskId,
    faceId,
    shirtId,
    pantsId,
    shoesId,
  };
};
