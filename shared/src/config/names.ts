/**
 * NAMES FOR THE SEATS NOBODY TOOK. Bots play under ordinary player handles -
 * the game never tells anyone which seats are bots (no tag, no badge, a ping
 * like anyone's), so a match always reads as a full lobby of people.
 */
const FIRST = ['Kai', 'Milo', 'Zara', 'Leo', 'Ivy', 'Ryo', 'Nina', 'Jax', 'Omar', 'Luca', 'Mina', 'Theo', 'Sami', 'Ezra', 'Noor', 'Finn', 'Ava', 'Remy', 'Yuki', 'Dex', 'Aria', 'Nico', 'Tess', 'Ravi'];
const WORD = ['Drift', 'Nova', 'Blaze', 'Echo', 'Frost', 'Pixel', 'Storm', 'Apex', 'Volt', 'Comet', 'Lunar', 'Ember', 'Rift', 'Orbit', 'Flux', 'Zephyr', 'Jolt', 'Halo', 'Cobalt', 'Slate'];
const TAIL = ['RL', 'GG', 'Plays', 'TV', 'Pro', 'Aerial', 'Kicks', 'Boost', 'Wheels', 'Flip'];

/** A believable handle from a random source (Math.random on the server, never in the sim). */
export const playerLikeName = (rnd: () => number): string => {
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
  const n = Math.floor(rnd() * 100);
  switch (Math.floor(rnd() * 6)) {
    case 0:
      return `${pick(FIRST)}${pick(TAIL)}`;
    case 1:
      return `${pick(FIRST).toLowerCase()}_${n}`;
    case 2:
      return `${pick(WORD)}${pick(FIRST)}`;
    case 3:
      return `${pick(WORD)}${n}`;
    case 4:
      return `${pick(FIRST)}${pick(WORD)}`;
    default:
      return `${pick(WORD).toLowerCase()}.${pick(TAIL).toLowerCase()}`;
  }
};
