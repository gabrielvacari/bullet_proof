import { INTERPOLATION_DELAY } from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';
import { type Vec3, ZERO, add } from '#shared/math/vec3.ts';
import { inputFromKeys } from '#shared/protocol/keys.ts';
import type { PlayerState } from '#shared/sim/types.ts';

import { aimDirection } from '#client/input/aim.ts';
import { keysFromHeld } from '#client/input/keys.ts';
import { startInputSession } from '#client/input/pointer-lock.ts';
import {
  type PendingInput,
  decayError,
  predict,
  reconcile,
  remember,
} from '#client/net/prediction.ts';
import {
  type SnapshotBuffer,
  emptyBuffer,
  forget,
  push,
  sample,
} from '#client/net/interpolation.ts';
import { connect } from '#client/net/socket.ts';
import { updateCamera } from '#client/render/camera.ts';
import { createPlayerView } from '#client/render/player.ts';
import { createRemoteViews } from '#client/render/remote.ts';
import { collisionBoxes, createStage, resize } from '#client/render/scene.ts';

import arenaData from '../../assets/maps/arena-01.json';
import { advance } from './loop.ts';

/**
 * M1 wiring.
 *
 * M0's accumulator called step() against local input and drew the result. The accumulator
 * is unchanged and step() is unchanged; what happens inside the loop is now three things:
 * predict the local player, send the input that produced the prediction, and draw everyone
 * else from the interpolation buffer.
 *
 * One input per **simulation tick**, not per rendered frame -- research.md R3 and gate
 * OQ-A. At 144 fps the per-frame reading would overflow the server's queue in a third of a
 * second and rubber-band continuously; consuming the queue faster instead would make frame
 * rate into movement speed.
 */

const canvas = document.getElementById('scene');
const overlay = document.getElementById('resume');
if (!(canvas instanceof HTMLCanvasElement) || overlay === null) {
  throw new Error('index.html is missing #scene or #resume');
}

const map = loadMap(arenaData);
const spawn = map.spawns[0];
if (spawn === undefined) throw new Error('map has no spawn point');

const stage = createStage(canvas, map);
const boxes = collisionBoxes(map);
const view = createPlayerView(stage.scene);
const remotes = createRemoteViews(stage.scene);
const session = startInputSession(canvas, overlay);

let current: PlayerState = {
  pos: spawn.pos,
  vel: [0, 0, 0],
  grounded: false,
  crouching: false,
};
let previous: PlayerState = current;

/** Everything sent and not yet acknowledged, for replay on reconciliation (NFR-007). */
let pending: PendingInput[] = [];
let seq = 0;
/** Render-only offset that decays a server correction away instead of teleporting. */
let renderError: Vec3 = ZERO;

let snapshots: SnapshotBuffer = emptyBuffer();
let selfId: string | null = null;

let accumulator = 0;
let lastFrame = 0;

/**
 * The nickname is generated because the start screen where a player types one is
 * FR-UI-001, in M3. It is validated server-side to FR-GP-008 regardless -- the validator
 * is a security boundary and does not wait for a UI -- and nothing renders it in M1,
 * because nameplates are FR-GP-048 in M4.
 */
function placeholderNickname(): string {
  const suffix = Math.floor(Math.random() * 9000) + 1000;
  return `player${String(suffix)}`;
}

const socket = connect({
  onOpen() {
    socket.send({ t: 'join', nickname: placeholderNickname(), mode: 'FFA' });
  },

  onJoined(message) {
    selfId = message.playerId;
    // Prediction starts from the transform the server assigned, so both sides begin from
    // the same state -- NFR-003's precondition (FR-GP-014).
    current = {
      pos: message.spawn.pos,
      vel: [0, 0, 0],
      grounded: false,
      crouching: false,
    };
    previous = current;
    pending = [];
    renderError = ZERO;
  },

  onSnapshot(message, receivedAtMs) {
    snapshots = push(snapshots, message, receivedAtMs);

    const mine = message.players.find((player) => player.id === selfId);
    if (mine === undefined) return;

    // NFR-007: adopt the server's state for ourselves, replay what it has not yet seen.
    const authoritative: PlayerState = {
      pos: mine.p,
      vel: mine.v,
      grounded: (mine.st & 1) !== 0,
      crouching: (mine.st & 2) !== 0,
    };

    const result = reconcile(current, pending, authoritative, message.ack, map);
    current = result.state;
    previous = result.state;
    pending = [...result.pending];
    // The correction is carried by the render, never by the simulation: smoothing the
    // state would make every later prediction start somewhere the server never agreed to.
    renderError = add(renderError, result.error);
  },

  onPlayerJoined() {
    // The capsule appears from the first snapshot that contains them, so nothing to do
    // here until M3 needs the nickname for a scoreboard.
  },

  onPlayerLeft(message) {
    // Both halves, or the capsule comes back for as long as the buffer holds them.
    remotes.remove(message.id);
    snapshots = forget(snapshots, message.id);
  },

  onError(message) {
    // NET-020: branch on the code, never on the text.
    showNotice(message.code === 'ROOM_FULL' ? 'This room is full.' : message.message);
  },

  onDisconnected(reason) {
    // NFR-013 only. The designed "Disconnected" screen is FR-UI-013, in M5.
    showNotice(reason);
  },
});

function showNotice(text: string): void {
  const strong = overlay?.querySelector('strong');
  // Player-supplied text never reaches the DOM as markup (NFR-012).
  if (strong !== null && strong !== undefined) strong.textContent = text;
  if (overlay !== null) overlay.hidden = false;
}

const fit = (): void => {
  resize(stage, globalThis.innerWidth, globalThis.innerHeight);
};
globalThis.addEventListener('resize', fit);
fit();

function frame(now: number): void {
  const elapsed = lastFrame === 0 ? 0 : (now - lastFrame) / 1000;
  lastFrame = now;

  const aim = session.aim();
  const dir = aimDirection(aim);

  const tick = advance(accumulator, elapsed);
  accumulator = tick.accumulator;

  for (let substep = 0; substep < tick.substeps; substep += 1) {
    // While unlocked the player stands still but the world keeps running -- FR-GP-021
    // says the match continues and the player stays in it.
    const held = session.locked() ? session.held() : new Set<string>();
    const keys = keysFromHeld(held);

    previous = current;
    // Predicted from the bitmask that is about to be sent, never from the key set it came
    // from: anything lost in the encoding must be lost identically on both sides.
    current = predict(current, inputFromKeys(keys, dir), map);

    seq += 1;
    pending = remember(pending, seq, inputFromKeys(keys, dir));
    socket.send({ t: 'input', seq, keys, dir });

    renderError = decayError(renderError);
  }

  const drawn = view.draw(
    { ...previous, pos: add(previous.pos, renderError) },
    { ...current, pos: add(current.pos, renderError) },
    tick.alpha,
  );

  remotes.update(sample(snapshots, Date.now() - INTERPOLATION_DELAY), selfId);
  updateCamera(stage.camera, drawn, aim, boxes);
  stage.renderer.render(stage.scene, stage.camera);

  globalThis.requestAnimationFrame(frame);
}

globalThis.requestAnimationFrame(frame);
