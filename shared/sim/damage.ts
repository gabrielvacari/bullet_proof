import {
  DAMAGE_HEAD,
  DAMAGE_LEGS,
  DAMAGE_TORSO,
  RESPAWN_TICKS,
} from '#shared/constants/index.ts';

import type { HitRegion, PlayerState } from './types.ts';

/** The result of applying one hit. */
export interface DamageOutcome {
  readonly state: PlayerState;
  /** True when this application took the player from alive to dead. */
  readonly lethal: boolean;
}

/**
 * Damage for a region -- FR-GP-026, and deliberately not a function of distance.
 *
 * FR-GP-028 makes damage constant over the weapon's whole range: a hit at 1 m and a hit
 * at WEAPON_RANGE cost the same. There is no falloff curve to tune because there is no
 * falloff, and passing a distance in would create a parameter someone would eventually
 * use.
 */
export function damageFor(region: HitRegion): number {
  if (region === 'HEAD') return DAMAGE_HEAD;
  if (region === 'TORSO') return DAMAGE_TORSO;
  return DAMAGE_LEGS;
}

/**
 * Applies one hit, and reports whether it was the one that killed.
 *
 * `lethal` is computed here rather than carried on ShotResult because whether a hit
 * killed depends on the victim's health at the moment the damage lands -- which the
 * caster cannot know and the applier cannot avoid knowing.
 *
 * That it is true **at most once per life** is what makes "exactly one NET-015 per
 * death" fall out of the model rather than needing a guard in the room: damage applied
 * to an already-dead player changes nothing and reports false, so two lethal hits in one
 * tick can never both be credited.
 */
export function applyDamage(state: PlayerState, damage: number): DamageOutcome {
  // Already dead. Not an error and not a special case to log -- two shots can be in
  // flight at once, and the second one simply finds nothing left to kill.
  if (state.health <= 0) return { state, lethal: false };

  // C24: health is never raised here. Negative damage is the only way it could be, and
  // a hit that heals is not a hit -- it changes nothing rather than being trusted.
  // damageFor never produces one; this keeps the guarantee true of the function rather
  // than of its current callers.
  if (damage <= 0) return { state, lethal: false };

  const health = state.health - damage;
  if (health > 0) return { state: { ...state, health }, lethal: false };

  return {
    state: {
      ...state,
      // Clamped, so two hits in one tick cannot drive it doubly negative and make a
      // later comparison against zero behave differently for the same inputs.
      health: 0,
      // Death cancels an in-progress reload (FR-GP-032); respawn grants a full
      // magazine, so there is nothing for the reload to finish.
      reloadTicks: 0,
      respawnTicks: RESPAWN_TICKS,
    },
    lethal: true,
  };
}
