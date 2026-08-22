import type { Vec3 } from '#shared/math/vec3.ts';

/**
 * One tick of player **intent**.
 *
 * What is absent here is load-bearing:
 *   - no `dt`: the timestep is TICK_DURATION_S, a constant. NET-004a forbids a
 *     client-supplied delta time, and having no field to read closes that hole by
 *     construction rather than by validation.
 *   - no yaw/pitch: an angle would force Math.cos into the simulation, whose result
 *     ECMA-262 does not pin down across engines. See ADR-0001.
 *   - no position, velocity or speed: an input able to assert an outcome would violate
 *     NFR-001 the moment M1 puts it behind a socket. The type is the enforcement.
 *   - no `seq`: sequence numbers belong to the transport, not the simulation. step()
 *     must not know that a network exists.
 */
export interface PlayerInput {
  /** Camera-relative movement intent. Y is always 0; length is at most 1. */
  readonly move: Vec3;
  /** Aim direction as a unit vector -- ADR-0001. */
  readonly dir: Vec3;
  readonly jump: boolean;
  readonly crouch: boolean;
  readonly sprint: boolean;
}

/**
 * The complete output of one simulation tick and the complete input to the next.
 *
 * M0 carries only what movement needs. Health, ammo and alive state join it in M2;
 * orientation never does, because that is presentation (ADR-0001), and nothing
 * animation-related ever does (NFR-017).
 */
export interface PlayerState {
  /**
   * The capsule **base** -- where the player meets the floor, not the centre. Spawn
   * points are floor positions (FR-MAP-003), so this needs no offset at spawn.
   */
  readonly pos: Vec3;
  /** Metres per second. */
  readonly vel: Vec3;
  /** Recomputed from the ground probe every tick, never carried over. */
  readonly grounded: boolean;
  /** Drives capsule height, and cannot become false under a ceiling. */
  readonly crouching: boolean;
}
