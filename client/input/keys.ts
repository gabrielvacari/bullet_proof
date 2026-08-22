import { type Vec3, normalise } from '#shared/math/vec3.ts';
import type { PlayerInput } from '#shared/sim/types.ts';

/**
 * Held keys translated into simulation intent.
 *
 * Pure on purpose: the DOM listeners that maintain the held-key set live in the boot
 * shell, so the translation itself -- where the actual rules are -- stays testable
 * without a browser.
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

function anyHeld(held: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.some((code) => held.has(code));
}

function axis(held: ReadonlySet<string>, positive: string, negative: string): number {
  return (held.has(positive) ? 1 : 0) - (held.has(negative) ? 1 : 0);
}

/**
 * Camera-relative movement intent: x strafes right, z goes forward.
 *
 * Normalised, so W+A is not faster than W. Without this, diagonal movement would be
 * sqrt(2) times quicker, which players find immediately and never stop doing.
 */
export function movementFrom(held: ReadonlySet<string>): Vec3 {
  return normalise([
    axis(held, KEYS.right, KEYS.left),
    0,
    axis(held, KEYS.forward, KEYS.back),
  ]);
}

export function inputFrom(held: ReadonlySet<string>, dir: Vec3): PlayerInput {
  return {
    move: movementFrom(held),
    dir,
    jump: held.has(KEYS.jump),
    crouch: anyHeld(held, KEYS.crouch),
    sprint: anyHeld(held, KEYS.sprint),
  };
}
