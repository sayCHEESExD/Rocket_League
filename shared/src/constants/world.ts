/**
 * World-space constants shared by the renderer and the authoritative server.
 *
 * Units are "world units" (1 unit ~= 1.5 Roblox studs). The supplied
 * player.fbx is authored at 320 units tall, so it is scaled down on load.
 */

/** Multiplier applied to the loaded FBX so the character is PLAYER_HEIGHT tall. */
export const FBX_TO_WORLD_SCALE = 0.01;

/** Player height in world units (320 * FBX_TO_WORLD_SCALE). */
export const PLAYER_HEIGHT = 3.2;

/** Horizontal half-width of the player's collision body. */
export const PLAYER_RADIUS = 0.8;

/**
 * How large the head is drawn, Roblox-style. Applied to the neck bone by
 * `PlayerRig`, multiplied with the portal's own head proportion.
 */
export const HEAD_SCALE = 1.12;

export const neckScale = (portalHeadScale = 1): number => {
  const chosen = Number.isFinite(portalHeadScale) && portalHeadScale > 0 ? portalHeadScale : 1;
  return HEAD_SCALE * chosen;
};
