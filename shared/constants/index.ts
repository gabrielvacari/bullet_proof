/**
 * Every tuning value in the project. Nothing else defines a number (SC-4).
 *
 * The authority for these values is requirements/07-constants.md; this file is its
 * executable form and the names match it exactly, so a `{CONSTANT_NAME}` reference in
 * any requirement resolves here. Changing a value there and here must be the only edit
 * needed to change behaviour.
 *
 * Units, applied consistently -- 07-constants.md states some durations in seconds and
 * others in milliseconds, so the conversion happens once, here:
 *   - distance        metres
 *   - speed           metres per second
 *   - acceleration    metres per second squared
 *   - angle           radians
 *   - duration        milliseconds, except TICK_DURATION_S (see below)
 */

/* ---------------------------------------------------------------- Match ---- */

/** Hard cap per room -- FR-GP-013. */
export const MAX_PLAYERS_PER_ROOM = 10;
/** 8 minutes. */
export const MATCH_DURATION = 480_000;
/** Kills by one player to end an FFA match. */
export const FRAG_LIMIT_FFA = 20;
/** Kills by one team to end a TDM match. */
export const FRAG_LIMIT_TDM = 40;
/** Results screen duration before the match restarts. */
export const POST_MATCH_DURATION = 15_000;
/** How long an empty room survives before it is destroyed. */
export const EMPTY_ROOM_GRACE_PERIOD = 30_000;

/* --------------------------------------------------------------- Player ---- */

/** No armour -- FR-GP-034. */
export const PLAYER_MAX_HEALTH = 100;
export const RESPAWN_DELAY = 3_000;
/** From the nearest living enemy, when choosing a spawn -- FR-GP-038. */
export const MIN_SPAWN_DISTANCE = 15;
/** Standing capsule height. */
export const PLAYER_HEIGHT = 1.8;
/** Crouched capsule height, and the height of waist-high cover -- FR-MAP-005. */
export const CROUCH_HEIGHT = 1.1;
/** Collision capsule radius. */
export const PLAYER_RADIUS = 0.4;
/** Ray origin for firing -- FR-GP-024. */
export const EYE_HEIGHT = 1.6;

/* ------------------------------------------------------------- Movement ---- */

export const WALK_SPEED = 5.0;
/** Forward-dominant movement only -- FR-GP-016, D-017. */
export const SPRINT_SPEED = 8.0;
export const CROUCH_SPEED = 2.5;
/** Upward impulse on jump -- FR-GP-017. */
export const JUMP_VELOCITY = 6.0;
/** Deliberately stronger than real gravity: snappier arcs. */
export const GRAVITY = -20.0;
/** Fraction of ground acceleration that applies mid-air. */
export const AIR_CONTROL = 0.3;
/**
 * cos(45 degrees). Sprint applies while the movement input's dot product with forward
 * is at least this -- D-017.
 *
 * Stored as a cosine rather than an angle on purpose: comparing angles would require
 * Math.cos inside the simulation, and ECMA-262 leaves that implementation-approximated.
 * See docs/adr/0001-aim-enters-the-simulation-as-a-direction-vector.md.
 */
export const SPRINT_FORWARD_MIN_DOT = 0.707_106_781_186_547_6;
/** Downward probe below the capsule that defines grounded -- FR-GP-017. */
export const GROUND_PROBE_DISTANCE = 0.05;

/* --------------------------------------------------------------- Weapon ---- */

export const MAGAZINE_SIZE = 30;
export const RELOAD_TIME = 2_000;
/** Shots per second, ~480 RPM, server-enforced -- FR-GP-029. */
export const FIRE_RATE_RPS = 8;
/** Should comfortably exceed ARENA_SIZE. */
export const WEAPON_RANGE = 100;
/** 2 shots to kill -- FR-GP-026. */
export const DAMAGE_HEAD = 50;
/** 5 shots to kill -- FR-GP-026. */
export const DAMAGE_TORSO = 20;
/** 10 shots to kill -- FR-GP-026. */
export const DAMAGE_LEGS = 10;

/* ------------------------------------------------------------------ Map ---- */

/** Horizontal extent of the arena -- FR-MAP-009. */
export const ARENA_SIZE = 80;
/** FR-MAP-004. */
export const MIN_ENCLOSED_ROOMS = 3;
/** FR-MAP-007. */
export const MIN_SPAWN_POINTS = 12;

/* ----------------------------------------------------------- Networking ---- */

/** Fixed simulation step -- NFR-005. */
export const SERVER_TICK_HZ = 30;
/** Snapshot broadcast rate -- NFR-005. */
export const SNAPSHOT_HZ = 20;
/** Roughly two snapshot intervals -- NFR-008. */
export const INTERPOLATION_DELAY = 100;
/** Above 60 fps to allow headroom -- NFR-010. */
export const MAX_INPUTS_PER_SECOND = 70;
/** Per client, per tick queue depth -- NET-004a. */
export const MAX_QUEUED_INPUTS = 10;
/** Inbound message size cap -- NFR-010. */
export const MAX_MESSAGE_BYTES = 1_024;
/** Tolerance when validating that input.dir is unit length -- NET-004c. */
export const AIM_EPSILON = 0.001;

/* ---------------------------------------------------- Identity and input ---- */

export const NICKNAME_MIN_LENGTH = 2;
/** Must fit a nameplate and a scoreboard row. */
export const NICKNAME_MAX_LENGTH = 16;
/** Alphabet excludes 0 O 1 I L -- FR-GP-012. */
export const ROOM_CODE_LENGTH = 4;

/* ---------------------------------------------------- Camera and client ---- */

/** Right, up, back -- over the shoulder. FR-GP-019. */
export const CAMERA_OFFSET = [0.6, 1.7, -3.0] as const;
/** About -69 degrees. */
export const CAMERA_PITCH_MIN = -1.2;
/** About +52 degrees. */
export const CAMERA_PITCH_MAX = 0.9;
/**
 * sin(CAMERA_PITCH_MIN) and sin(CAMERA_PITCH_MAX): the vertical component an aim vector
 * may take. Stored as sines for the same reason SPRINT_FORWARD_MIN_DOT is stored as a
 * cosine -- validating a pitch angle would require Math.sin, which ADR-0001 bars from
 * shared/. Used by NET-004c to clamp aim server-side.
 */
export const AIM_DIR_Y_MIN = -0.932_039_085_967_226_3;
export const AIM_DIR_Y_MAX = 0.783_326_909_627_483_4;
/** Radians per pixel of mouse movement -- FR-GP-022. */
export const MOUSE_SENSITIVITY_DEFAULT = 0.002;
/** Occlusion raycast rate -- FR-GP-048. */
export const NAMEPLATE_LOS_CHECK_HZ = 10;
/** NFR-014. */
export const TARGET_FPS = 60;
/** Below this the game refuses to load -- FR-UI-014. */
export const MIN_VIEWPORT_WIDTH = 1_024;
export const KILL_FEED_MAX_ENTRIES = 5;
export const KILL_FEED_ENTRY_TTL = 6_000;
/**
 * Cap on simulation ticks consumed per rendered frame. Surplus accumulated time is
 * discarded rather than simulated: chasing a backlog after a stall makes each frame
 * slower, which grows the backlog further until the page freezes.
 */
export const MAX_SUBSTEPS_PER_FRAME = 5;

/* ------------------------------------------- Derived -- never hardcode these ---- */

/** Tick duration in seconds. The simulation integrates m/s, so it needs seconds. */
export const TICK_DURATION_S = 1 / SERVER_TICK_HZ;
/** Tick duration in milliseconds -- 33.33 ms at 30 Hz. */
export const TICK_DURATION_MS = 1_000 / SERVER_TICK_HZ;
/** Snapshot interval in milliseconds -- 50 ms at 20 Hz. */
export const SNAPSHOT_INTERVAL_MS = 1_000 / SNAPSHOT_HZ;
/** Seconds to empty a magazine -- 3.75 s. */
export const MAGAZINE_DURATION_S = MAGAZINE_SIZE / FIRE_RATE_RPS;
/** Shots to kill, by region. */
export const SHOTS_TO_KILL_HEAD = Math.ceil(PLAYER_MAX_HEALTH / DAMAGE_HEAD);
export const SHOTS_TO_KILL_TORSO = Math.ceil(PLAYER_MAX_HEALTH / DAMAGE_TORSO);
export const SHOTS_TO_KILL_LEGS = Math.ceil(PLAYER_MAX_HEALTH / DAMAGE_LEGS);
