import { readFile } from 'node:fs/promises';

import { SERVER_PORT, SERVER_TICK_HZ, WS_PATH } from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';

import { createSession } from './net/connection.ts';
import { listen } from './net/ws-transport.ts';
import { createLoop } from './room/loop.ts';
import { createRoom } from './room/room.ts';

/**
 * The server process (NFR-002): long-lived, stateful, and the only authority over the
 * match (NFR-001).
 *
 * One hardcoded room, created at startup, as 08-roadmap.md assigns to M1. Matchmaking and
 * private room codes are FR-GP-010 and FR-GP-011, in M3 -- but the room is built by a
 * factory that takes an id and reaches for no global, so the second one that arrives then
 * cannot observe the first (NFR-015).
 *
 * Restarting this process ends every match. That is expected and documented (NFR-002); a
 * dropped player rejoins as a new player, never a resumed one (D-009).
 */

const MAP_PATH = 'assets/maps/arena-01.json';
const ROOM_ID = 'r_1';

async function main(): Promise<void> {
  const map = loadMap(JSON.parse(await readFile(MAP_PATH, 'utf8')) as unknown);
  const room = createRoom(ROOM_ID, map);

  const { transport } = await listen(SERVER_PORT);

  transport.onConnection((connection) => {
    const session = createSession(connection, room, Date.now());

    connection.onMessage((text) => {
      session.handle(text, Date.now());
    });
    connection.onClose(() => {
      // FR-GP-040: the player goes with the socket, within one tick, leaving no ghost.
      session.disconnect();
    });
  });

  const loop = createLoop(
    () => {
      room.tick();
    },
    { now: () => Date.now(), schedule: (fn, ms) => setTimeout(fn, ms) },
  );
  loop.start();

  console.log(
    `bullet proof — room ${ROOM_ID} on map ${map.id}, ` +
      `ws://localhost:${String(SERVER_PORT)}${WS_PATH}, ` +
      `${String(SERVER_TICK_HZ)} Hz`,
  );
}

await main();
