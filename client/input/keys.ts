import {
  KEY_BACK,
  KEY_CROUCH,
  KEY_FORWARD,
  KEY_JUMP,
  KEY_LEFT,
  KEY_RIGHT,
  KEY_SPRINT,
} from '#shared/protocol/keys.ts';

/**
 * Held browser keys translated into the NET-004 bitmask.
 *
 * This is the only half of the translation that is a browser concern, and it is the only
 * half that lives here. What a bit *means* -- the movement vector, the normalised
 * diagonal -- is in shared/protocol/keys.ts, because NFR-003 requires the client's
 * prediction and the server's tick to derive it from the same code.
 *
 * The split matters: the client predicts from the bitmask this function returns, not from
 * the key set it was given. Predicting from the richer local value is the classic version
 * of this bug, and it stays invisible until someone strafes diagonally.
 *
 * Pure on purpose. The DOM listeners that maintain the held-key set live in the boot
 * shell, so the rules stay testable without a browser.
 */

export const KEYS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight'],
} as const;

function bitIf(condition: boolean, bit: number): number {
  return condition ? bit : 0;
}

function anyHeld(held: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.some((code) => held.has(code));
}

export function keysFromHeld(held: ReadonlySet<string>): number {
  return (
    bitIf(held.has(KEYS.forward), KEY_FORWARD) |
    bitIf(held.has(KEYS.back), KEY_BACK) |
    bitIf(held.has(KEYS.left), KEY_LEFT) |
    bitIf(held.has(KEYS.right), KEY_RIGHT) |
    bitIf(held.has(KEYS.jump), KEY_JUMP) |
    bitIf(anyHeld(held, KEYS.sprint), KEY_SPRINT) |
    bitIf(anyHeld(held, KEYS.crouch), KEY_CROUCH)
  );
}
