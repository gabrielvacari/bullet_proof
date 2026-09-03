import { type Vec3, normalise } from '#shared/math/vec3.ts';
import type { PlayerInput } from '#shared/sim/types.ts';

/**
 * The NET-004 key bitmask, and the single implementation of what it means.
 *
 * This file exists because of NFR-003, not because of tidiness. If the client turned held
 * keys into a movement vector and the server turned the bitmask into a movement vector,
 * there would be two implementations of "what does W+A mean", and they would eventually
 * disagree about a normalised diagonal in the last bits -- which is exactly the divergence
 * NFR-003 exists to prevent, and it would be invisible until someone strafed along a wall.
 *
 * So the client calls this on **the bitmask it is about to send**, never on the key set it
 * sampled. Anything lost in the encoding is then lost identically on both sides, and that
 * is the property that makes prediction converge.
 */

export const KEY_FORWARD = 1;
export const KEY_BACK = 2;
export const KEY_LEFT = 4;
export const KEY_RIGHT = 8;
export const KEY_JUMP = 16;
export const KEY_SPRINT = 32;
export const KEY_CROUCH = 64;
/** NET-004b: a *request*. The server decides whether the shot happens. Ignored until M2. */
export const KEY_FIRE = 128;
/** NET-004b. Ignored until M2. */
export const KEY_RELOAD = 256;

/** Every defined bit. A `keys` value with anything above this is not this protocol's. */
export const KEY_MASK_ALL =
  KEY_FORWARD |
  KEY_BACK |
  KEY_LEFT |
  KEY_RIGHT |
  KEY_JUMP |
  KEY_SPRINT |
  KEY_CROUCH |
  KEY_FIRE |
  KEY_RELOAD;

function held(keys: number, bit: number): boolean {
  return (keys & bit) !== 0;
}

function axis(keys: number, positive: number, negative: number): number {
  return (held(keys, positive) ? 1 : 0) - (held(keys, negative) ? 1 : 0);
}

/**
 * Turns a validated bitmask and aim vector into one tick of simulation intent.
 *
 * Opposing keys cancel: holding forward and back is the same as holding neither, which is
 * what a player pressing both actually wants. The vector is normalised so W+A is not
 * sqrt(2) times quicker than W -- players find that immediately and never stop doing it.
 *
 * KEY_FIRE and KEY_RELOAD are accepted and ignored. They are M2's, and the bits are
 * validated in range so that a client running ahead of the server cannot smuggle anything
 * through them.
 */
export function inputFromKeys(keys: number, dir: Vec3): PlayerInput {
  return {
    move: normalise([
      axis(keys, KEY_RIGHT, KEY_LEFT),
      0,
      axis(keys, KEY_FORWARD, KEY_BACK),
    ]),
    dir,
    jump: held(keys, KEY_JUMP),
    crouch: held(keys, KEY_CROUCH),
    sprint: held(keys, KEY_SPRINT),
  };
}

/**
 * The input a player who sent nothing this tick gets (NET-004a, and R1 in the M1 research).
 *
 * No movement, no jump, no sprint, no crouch -- only the aim they last established, so a
 * stalled player does not spin to face north. Repeating their last input instead would let
 * "hold W, then pull the network cable" become a movement technique: a player whose socket
 * has died would sprint forward until it timed out. A player who sends nothing does
 * nothing, which is what server authority means (NFR-001).
 */
export function neutralInput(dir: Vec3): PlayerInput {
  return { move: [0, 0, 0], dir, jump: false, crouch: false, sprint: false };
}
