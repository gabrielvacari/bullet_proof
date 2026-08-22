import {
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  MOUSE_SENSITIVITY_DEFAULT,
} from '#shared/constants/index.ts';
import type { Vec3 } from '#shared/math/vec3.ts';

/**
 * Yaw and pitch live here, on the client, and are converted to a direction vector before
 * anything reaches the simulation.
 *
 * This module is the only place in the project allowed to call trigonometry on an aim
 * angle. ECMA-262 leaves Math.sin and Math.cos implementation-approximated, so the
 * simulation -- which runs on Node and on three browser engines -- must never call them.
 * See docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md.
 */
export interface Aim {
  readonly yaw: number;
  readonly pitch: number;
}

export const INITIAL_AIM: Aim = { yaw: 0, pitch: 0 };

/** Applies a mouse delta in pixels, clamping pitch so the view never flips (FR-GP-019). */
export function applyMouseDelta(aim: Aim, dx: number, dy: number): Aim {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return aim;

  const yaw = aim.yaw - dx * MOUSE_SENSITIVITY_DEFAULT;
  const pitch = clamp(
    aim.pitch - dy * MOUSE_SENSITIVITY_DEFAULT,
    CAMERA_PITCH_MIN,
    CAMERA_PITCH_MAX,
  );
  return { yaw, pitch };
}

/** The unit aim vector the simulation consumes. Right-handed, Y up, forward is -Z. */
export function aimDirection(aim: Aim): Vec3 {
  const cosPitch = Math.cos(aim.pitch);
  return [
    -Math.sin(aim.yaw) * cosPitch,
    Math.sin(aim.pitch),
    -Math.cos(aim.yaw) * cosPitch,
  ];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
