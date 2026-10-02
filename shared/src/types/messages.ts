import type { AvatarAppearance, AvatarProportions } from './avatar.js';

export interface SetAvatarMessage {
  appearance: AvatarAppearance;
  proportions: AvatarProportions;
}

export interface SetIdentityMessage {
  displayName: string;
  avatarUrl: string;
}

export interface SetAuthMessage {
  token: string | null;
}

export interface GoalMessage {
  /** Team that scored. */
  team: number;
  scorer: string;
  assist: string;
  /** Ball speed at the line, uu/s. */
  speed: number;
  /** Server tick of the goal (the replay ends here). */
  tick: number;
  /** -1 = the -Y goal, +1 = the +Y goal. */
  side: number;
  ownGoal: boolean;
}

export interface FeedMessage {
  kind: 'demo' | 'save' | 'shot' | 'epic' | 'chat';
  a: string;
  b: string;
  text: string;
}

export interface MatchEndRow {
  id: string;
  name: string;
  team: number;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
  bot: boolean;
}

export interface MatchEndMessage {
  winner: number;
  blue: number;
  orange: number;
  mvp: string;
  rows: MatchEndRow[];
}
