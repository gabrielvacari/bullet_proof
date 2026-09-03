import {
  HEAD_CENTRE_FRACTION,
  HEAD_RADIUS_FRACTION,
  LEG_BOTTOM_FRACTION,
  LEG_RADIUS_FRACTION,
  LEG_TOP_FRACTION,
  TORSO_BOTTOM_FRACTION,
  TORSO_RADIUS_FRACTION,
  TORSO_TOP_FRACTION,
} from '#shared/constants/index.ts';
import type { Vec3 } from '#shared/math/vec3.ts';

import { capsuleHeight } from './collide.ts';
import type { HitVolume } from './types.ts';

/**
 * FR-GP-027's three static primitives, built on demand and never stored.
 *
 * "Never stored" is the requirement, not an implementation preference. A volume kept on
 * the player could drift from the transform it claims to describe -- a stale head sphere
 * is a player being shot where their head used to be -- and the cheapest way to make that
 * impossible is to have nowhere to keep one.
 *
 * Deriving them from animated bones is the other failure this forbids. The volumes are a
 * pure function of `(pos, crouching)` and of nothing else (C16): not of velocity, not of
 * an animation clip, not of elapsed time. That is what lets the client and the server
 * agree about a hit without the client ever running an animation (NFR-017).
 */
export function hitVolumes(pos: Vec3, crouching: boolean): readonly HitVolume[] {
  const height = capsuleHeight(crouching);
  const [x, y, z] = pos;

  const at = (fraction: number): Vec3 => [x, y + fraction * height, z];
  const headCentre = at(HEAD_CENTRE_FRACTION);

  return [
    // A sphere, expressed as a capsule whose ends coincide, so the caller needs one
    // intersection routine rather than a discriminated union and two.
    {
      region: 'HEAD',
      a: headCentre,
      b: headCentre,
      radius: HEAD_RADIUS_FRACTION * height,
    },
    {
      region: 'TORSO',
      a: at(TORSO_BOTTOM_FRACTION),
      b: at(TORSO_TOP_FRACTION),
      radius: TORSO_RADIUS_FRACTION * height,
    },
    {
      region: 'LEGS',
      a: at(LEG_BOTTOM_FRACTION),
      b: at(LEG_TOP_FRACTION),
      radius: LEG_RADIUS_FRACTION * height,
    },
  ];
}
