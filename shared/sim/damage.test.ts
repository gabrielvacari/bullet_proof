import { describe, expect, it } from 'vitest';

import {
  DAMAGE_HEAD,
  DAMAGE_LEGS,
  DAMAGE_TORSO,
  MAGAZINE_SIZE,
  PLAYER_MAX_HEALTH,
  RELOAD_TICKS,
  RESPAWN_TICKS,
  SHOTS_TO_KILL_HEAD,
  SHOTS_TO_KILL_LEGS,
  SHOTS_TO_KILL_TORSO,
} from '#shared/constants/index.ts';

import { applyDamage, damageFor } from './damage.ts';
import { spawnedPlayer } from './step.ts';
import type { HitRegion, PlayerState } from './types.ts';

const ALIVE = spawnedPlayer([0, 0, 0]);

describe('damageFor', () => {
  it('reads the constant for each region', () => {
    expect(damageFor('HEAD')).toBe(DAMAGE_HEAD);
    expect(damageFor('TORSO')).toBe(DAMAGE_TORSO);
    expect(damageFor('LEGS')).toBe(DAMAGE_LEGS);
  });

  it('gives the 2 / 5 / 10 shots to kill of FR-GP-026, derived', () => {
    // Derived from the constants rather than written down, so retuning a damage value
    // cannot leave this test asserting the old game.
    const kills = (region: HitRegion): number => {
      let state: PlayerState = ALIVE;
      let shots = 0;
      while (state.health > 0) {
        state = applyDamage(state, damageFor(region)).state;
        shots += 1;
      }
      return shots;
    };
    expect(kills('HEAD')).toBe(SHOTS_TO_KILL_HEAD);
    expect(kills('TORSO')).toBe(SHOTS_TO_KILL_TORSO);
    expect(kills('LEGS')).toBe(SHOTS_TO_KILL_LEGS);
  });

  it('sums mixed regions correctly -- M2-4', () => {
    // One leg hit and four torso hits is 90: still alive by ten.
    let state: PlayerState = applyDamage(ALIVE, damageFor('LEGS')).state;
    for (let i = 0; i < 4; i += 1) {
      state = applyDamage(state, damageFor('TORSO')).state;
    }
    expect(state.health).toBe(PLAYER_MAX_HEALTH - DAMAGE_LEGS - 4 * DAMAGE_TORSO);
    expect(state.health).toBeGreaterThan(0);
  });
});

describe('applyDamage', () => {
  it('C21: clamps health at zero rather than going negative', () => {
    const dead = applyDamage(ALIVE, PLAYER_MAX_HEALTH * 10);
    expect(dead.state.health).toBe(0);
    expect(dead.lethal).toBe(true);
  });

  it('C21: two hits in one tick cannot drive health doubly negative', () => {
    const first = applyDamage(ALIVE, PLAYER_MAX_HEALTH);
    const second = applyDamage(first.state, PLAYER_MAX_HEALTH);
    expect(second.state.health).toBe(0);
  });

  it('C22: lethal is true at most once per life', () => {
    const first = applyDamage(ALIVE, PLAYER_MAX_HEALTH);
    expect(first.lethal).toBe(true);
    // Every later hit on the corpse reports false, which is what makes "exactly one
    // NET-015 per death" fall out of the model rather than needing a guard.
    for (let i = 0; i < 5; i += 1) {
      expect(applyDamage(first.state, DAMAGE_HEAD).lethal).toBe(false);
    }
  });

  it('C22: a hit that does not kill is not lethal', () => {
    expect(applyDamage(ALIVE, DAMAGE_LEGS).lethal).toBe(false);
  });

  it('C22: damage to a corpse changes nothing at all', () => {
    const corpse: PlayerState = { ...ALIVE, health: 0, respawnTicks: RESPAWN_TICKS };
    const after = applyDamage(corpse, DAMAGE_HEAD);
    expect(after.state).toBe(corpse);
  });

  it('C23: death clears an in-progress reload and starts the respawn clock', () => {
    const reloading: PlayerState = { ...ALIVE, reloadTicks: RELOAD_TICKS, magazine: 0 };
    const killed = applyDamage(reloading, PLAYER_MAX_HEALTH);
    expect(killed.state.reloadTicks).toBe(0);
    expect(killed.state.respawnTicks).toBe(RESPAWN_TICKS);
  });

  it('C23: a non-lethal hit starts no respawn clock and cancels no reload', () => {
    const reloading: PlayerState = { ...ALIVE, reloadTicks: RELOAD_TICKS };
    const hurt = applyDamage(reloading, DAMAGE_LEGS);
    expect(hurt.state.respawnTicks).toBe(0);
    expect(hurt.state.reloadTicks).toBe(RELOAD_TICKS);
  });

  it('C24: never raises health, even given negative damage', () => {
    const hurt: PlayerState = { ...ALIVE, health: 40 };
    expect(applyDamage(hurt, -50).state.health).toBe(40);
    expect(applyDamage(hurt, 0).state.health).toBe(40);
    expect(applyDamage(hurt, -50).lethal).toBe(false);
  });

  it('leaves everything the hit does not concern alone', () => {
    const hurt = applyDamage({ ...ALIVE, magazine: 7 }, DAMAGE_TORSO);
    expect(hurt.state.magazine).toBe(7);
    expect(hurt.state.pos).toBe(ALIVE.pos);
  });

  it('does not mutate the state it was given', () => {
    const frozen = Object.freeze({ ...ALIVE, magazine: MAGAZINE_SIZE });
    expect(() => applyDamage(frozen, DAMAGE_HEAD)).not.toThrow();
    expect(frozen.health).toBe(PLAYER_MAX_HEALTH);
  });
});
