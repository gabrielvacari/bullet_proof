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
  /**
   * A *request* to fire -- NET-004b. The server decides whether a shot happens, and the
   * weapon rules in step() are the only gate on it (FR-GP-029).
   */
  readonly fire: boolean;
  readonly reload: boolean;
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
  /** Integer, 0..PLAYER_MAX_HEALTH. Clamped at zero -- FR-GP-034. */
  readonly health: number;
  /** Integer, 0..MAGAZINE_SIZE. Reserve ammunition is unlimited -- FR-GP-030. */
  readonly magazine: number;
  /**
   * Ticks until the next shot is permitted. **Fractional**: TICKS_PER_SHOT is 3.75, and
   * accumulating it rather than assigning it is what keeps the long-run rate exactly
   * FIRE_RATE_RPS.
   */
  readonly fireCooldown: number;
  /** Ticks left in a reload; 0 means not reloading -- FR-GP-031. */
  readonly reloadTicks: number;
  /** Ticks left before respawn; 0 means none pending -- FR-GP-037. */
  readonly respawnTicks: number;
}

/*
 * Absent from PlayerState, each for a reason:
 *
 *   - no `armour`, `shield` or `vest`: FR-GP-034 requires that no such value exist, not
 *     that it be zero. There is no field to set.
 *   - no `alive` flag: derived from `health > 0`. Two fields could disagree; one cannot.
 *   - no `weapon`: FR-GP-023 requires no code path to change a player's weapon, and the
 *     cheapest guarantee is having nothing to change.
 *   - no `kills`, `deaths` or `score`: scoring is FR-GP-041, in M3, and belongs to the
 *     room rather than to the simulated player.
 *   - no `lastHitBy` or `killer`: a kill is an event the room emits (NET-015), not a
 *     property a player carries.
 *   - no position history: NFR-009 refuses rewind by decision, and adding the buffer
 *     "for later" is precisely what 09-out-of-scope.md forbids.
 */

/** The three regions of FR-GP-026, and the strings NET-013 through NET-015 carry. */
export type HitRegion = 'HEAD' | 'TORSO' | 'LEGS';

/**
 * One of FR-GP-027's static primitives, built on demand from a player's pos and
 * crouching and **never stored**. A stored volume could drift from the transform it
 * claims to describe, which is the bug the requirement exists to prevent.
 *
 * A sphere is expressed as a capsule whose ends coincide, so the caller needs one shape
 * and one intersection routine rather than a discriminated union and two.
 */
export interface HitVolume {
  readonly region: HitRegion;
  readonly a: Vec3;
  readonly b: Vec3;
  readonly radius: number;
}

/**
 * What step() produces on a tick where the weapon rules permitted a shot.
 *
 * It carries no target, no victim, no damage and no hit flag, because at the moment it
 * is produced none of those is known -- step() sees exactly one player (C8). Resolution
 * is a separate, room-level step.
 */
export interface ShotIntent {
  /** pos + EYE_HEIGHT. The origin FR-GP-024 names. */
  readonly eye: Vec3;
  /**
   * The **nominal** camera position, from CAMERA_OFFSET and dir -- ADR-0002.
   *
   * Camera collision (FR-GP-020) is deliberately excluded. Feeding the pulled-in camera
   * into the shot would make the aim point jump the instant a player backed into a wall,
   * and would drag a client/render concern into the authoritative path.
   */
  readonly cameraEye: Vec3;
  /** The unit aim vector the player sent, unchanged -- ADR-0001. */
  readonly dir: Vec3;
}

/** What stopped the ray. */
export type ShotKind = 'NONE' | 'GEOMETRY' | 'PLAYER';

/**
 * The single value NET-012 through NET-015 are all derived from, so those four messages
 * can never describe different events.
 *
 * `lethal` is deliberately not here: whether a hit killed depends on the victim's health
 * at the moment the damage lands, which is the applier's business, not the caster's.
 */
export interface ShotResult {
  /** The eye. Goes straight into NET-012's `from`. */
  readonly from: Vec3;
  /** Impact point, or the point at WEAPON_RANGE when nothing was hit. */
  readonly to: Vec3;
  readonly kind: ShotKind;
  /** Set only when kind is 'PLAYER'. */
  readonly victimId: string | null;
  /** Set only when kind is 'PLAYER'. */
  readonly region: HitRegion | null;
  /** Zero unless kind is 'PLAYER'. From the region, never from range -- FR-GP-028. */
  readonly damage: number;
}

/**
 * A candidate for a shot, deliberately narrower than PlayerState: velocity, ammunition
 * and reload state cannot influence a hit, so they are not in scope to be accidentally
 * read (C16).
 */
export interface TargetPlayer {
  readonly id: string;
  readonly pos: Vec3;
  readonly crouching: boolean;
  readonly health: number;
}

/**
 * step()'s widened return. A breaking change to M0's contract, and called out as one:
 * every existing caller and test reads `.state`.
 */
export interface StepResult {
  readonly state: PlayerState;
  /** Present only on a tick where the weapon rules permitted a shot. */
  readonly shot: ShotIntent | null;
}
