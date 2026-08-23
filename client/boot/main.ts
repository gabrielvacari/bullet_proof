import { PLAYER_HEIGHT, TICK_DURATION_S } from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';
import { inputFromKeys } from '#shared/protocol/keys.ts';
import { step } from '#shared/sim/step.ts';
import type { PlayerState } from '#shared/sim/types.ts';

import { aimDirection } from '#client/input/aim.ts';
import { keysFromHeld } from '#client/input/keys.ts';
import { startInputSession } from '#client/input/pointer-lock.ts';
import { updateCamera } from '#client/render/camera.ts';
import { createPlayerView } from '#client/render/player.ts';
import { collisionBoxes, createStage, resize } from '#client/render/scene.ts';

import arenaData from '../../assets/maps/arena-01.json';
import { advance } from './loop.ts';

/**
 * M0 wiring. Single-player and offline by design: the client calls shared/sim directly
 * and no socket is opened. M1 replaces this caller with a server and a prediction
 * buffer -- and the simulation itself does not change.
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
const session = startInputSession(canvas, overlay);

let current: PlayerState = {
  pos: spawn.pos,
  vel: [0, 0, 0],
  grounded: false,
  crouching: false,
};
let previous: PlayerState = current;
let accumulator = 0;
let lastFrame = 0;

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
    previous = current;
    // While unlocked the player stands still but the world keeps running -- FR-GP-021
    // says the match continues and the player stays in it.
    const held = session.locked() ? session.held() : new Set<string>();
    current = step(current, inputFromKeys(keysFromHeld(held), dir), map);
  }

  const drawn = view.draw(previous, current, tick.alpha);
  updateCamera(stage.camera, drawn, aim, boxes);
  stage.renderer.render(stage.scene, stage.camera);

  globalThis.requestAnimationFrame(frame);
}

globalThis.requestAnimationFrame(frame);

// Referenced so the constants import is not dropped; also a useful console sanity check.
console.log(
  `bullet proof — M0, ${String(map.blocks.length)} blocks, tick ${TICK_DURATION_S.toFixed(4)} s, player ${String(PLAYER_HEIGHT)} m`,
);
