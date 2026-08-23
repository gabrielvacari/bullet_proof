import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { SERVER_TICK_HZ, TICK_DURATION_MS, WS_PATH } from '#shared/constants/index.ts';
import { loadMap } from '#shared/map/load.ts';
import type { GameMap } from '#shared/map/types.ts';
import { decode, encode } from '#shared/protocol/encode.ts';
import { KEY_FORWARD } from '#shared/protocol/keys.ts';
import type { ClientMessage, ServerMessage } from '#shared/protocol/types.ts';

import { createSession } from './net/connection.ts';
import type { Transport } from './net/transport.ts';
import { listen } from './net/ws/server.ts';
import { createLoop } from './room/loop.ts';
import { type Room, createRoom } from './room/room.ts';

/**
 * The whole thing, over a real socket, using Node 24's own WebSocket client.
 *
 * Slow, few, and the only tests that would catch a wiring mistake -- a handler never
 * attached, a message never routed, a player removed from the room but not from the
 * broadcast. Every unit test above passes happily with the wires crossed.
 */

const MAP: GameMap = loadMap(
  JSON.parse(readFileSync('assets/maps/arena-01.json', 'utf8')) as unknown,
);

interface Harness {
  readonly url: string;
  readonly room: Room;
  stop(): Promise<void>;
}

let harness: Harness | null = null;

/** The same wiring as server/index.ts, on an ephemeral port and a hand-driven clock. */
async function startServer(): Promise<Harness> {
  const room = createRoom('r_test', MAP);
  const started: { server: Server; transport: Transport } = await listen(0);

  started.transport.onConnection((connection) => {
    const session = createSession(connection, room, Date.now());
    connection.onMessage((text) => {
      session.handle(text, Date.now());
    });
    connection.onClose(() => {
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

  const { port } = started.server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${String(port)}${WS_PATH}`,
    room,
    async stop() {
      loop.stop();
      // The transport closes its own players' sockets; an upgraded socket is no longer
      // the HTTP server's business, so server.close() alone would wait on it forever.
      await started.transport.close();
    },
  };
}

afterEach(async () => {
  await harness?.stop();
  harness = null;
});

/** One client: a real socket, plus everything it has been told. */
interface Client {
  readonly socket: WebSocket;
  readonly received: ServerMessage[];
  send(message: ClientMessage): void;
  waitFor<T extends ServerMessage['t']>(
    type: T,
    predicate?: (message: Extract<ServerMessage, { t: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { t: T }>>;
  close(): void;
}

function open(url: string): Promise<Client> {
  const received: ServerMessage[] = [];
  const waiters: ((message: ServerMessage) => boolean)[] = [];
  const socket = new WebSocket(url);

  socket.addEventListener('message', (event: MessageEvent<string>) => {
    const message = decode(event.data) as ServerMessage;
    received.push(message);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i]?.(message) === true) waiters.splice(i, 1);
    }
  });

  const client: Client = {
    socket,
    received,
    send(message) {
      socket.send(encode(message));
    },
    waitFor(type, predicate) {
      type Wanted = Extract<ServerMessage, { t: typeof type }>;

      const already = received.find(
        (m): m is Wanted => m.t === type && (predicate?.(m as Wanted) ?? true),
      );
      if (already !== undefined) return Promise.resolve(already);

      return new Promise<Wanted>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timed out waiting for ${type}`));
        }, 3000);

        waiters.push((message) => {
          if (message.t !== type) return false;
          const wanted = message as Wanted;
          if (predicate?.(wanted) === false) return false;
          clearTimeout(timer);
          resolve(wanted);
          return true;
        });
      });
    },
    close() {
      socket.close();
    },
  };

  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve(client);
    });
    socket.addEventListener('error', () => {
      reject(new Error('could not connect'));
    });
  });
}

async function joinedClient(url: string, nickname: string): Promise<Client> {
  const client = await open(url);
  client.send({ t: 'join', nickname, mode: 'FFA' });
  await client.waitFor('joined');
  return client;
}

describe('two players, one server', () => {
  it('lets both join and shows each of them the other', async () => {
    harness = await startServer();

    const first = await joinedClient(harness.url, 'gabriel');
    const second = await joinedClient(harness.url, 'ana');

    // Each appears in the other's snapshots -- NET-009a, regardless of line of sight.
    const seenBySecond = await second.waitFor(
      'snapshot',
      (message) => message.players.length === 2,
    );
    expect(seenBySecond.players).toHaveLength(2);

    const seenByFirst = await first.waitFor(
      'snapshot',
      (message) => message.players.length === 2,
    );
    expect(seenByFirst.players).toHaveLength(2);

    first.close();
    second.close();
  });

  it('announces an arrival to whoever was already there (NET-010)', async () => {
    harness = await startServer();

    const first = await joinedClient(harness.url, 'gabriel');
    await joinedClient(harness.url, 'ana');

    const announced = await first.waitFor('playerJoined');
    expect(announced.nickname).toBe('ana');

    first.close();
  });

  /** NFR-006/NFR-007's server half: the input is applied and acknowledged. */
  it('applies an input and acknowledges it in that client own snapshot', async () => {
    harness = await startServer();

    const client = await joinedClient(harness.url, 'gabriel');
    const before = await client.waitFor('snapshot');
    const startX = before.players[0]?.p[0] ?? 0;

    for (let seq = 1; seq <= SERVER_TICK_HZ; seq += 1) {
      client.send({ t: 'input', seq, keys: KEY_FORWARD, dir: [0, 0, -1] });
      await sleep(TICK_DURATION_MS);
    }

    const after = await client.waitFor('snapshot', (message) => message.ack > 0);
    expect(after.ack).toBeGreaterThan(0);

    const moved = after.players[0];
    if (moved === undefined) throw new Error('the player vanished');
    // Moving forward from a spawn changes the position; which axis depends on the spawn.
    expect(moved.p[0] !== startX || moved.p[2] !== (before.players[0]?.p[2] ?? 0)).toBe(
      true,
    );

    client.close();
  });

  /** FR-GP-040: the ghost this forbids is the most visible bug in a multiplayer demo. */
  it('removes a player who closes their tab, within one tick', async () => {
    harness = await startServer();

    const staying = await joinedClient(harness.url, 'gabriel');
    const leaving = await joinedClient(harness.url, 'ana');

    await staying.waitFor('snapshot', (message) => message.players.length === 2);

    leaving.close();
    const left = await staying.waitFor('playerLeft');
    expect(left.id).toBeTruthy();

    const alone = await staying.waitFor(
      'snapshot',
      (message) => message.players.length === 1,
    );
    expect(alone.players).toHaveLength(1);
    expect(harness.room.playerCount).toBe(1);

    staying.close();
  });

  it('treats an explicit leave exactly like a closed socket (NET-006)', async () => {
    harness = await startServer();

    const staying = await joinedClient(harness.url, 'gabriel');
    const leaving = await joinedClient(harness.url, 'ana');
    await staying.waitFor('snapshot', (message) => message.players.length === 2);

    leaving.send({ t: 'leave' });

    await staying.waitFor('playerLeft');
    await staying.waitFor('snapshot', (message) => message.players.length === 1);
    expect(harness.room.playerCount).toBe(1);

    staying.close();
  });

  /** NFR-011 and NFR-010, against a client that is actually hostile rather than mocked. */
  it('keeps one player moving while another floods and sends garbage', async () => {
    harness = await startServer();

    const honest = await joinedClient(harness.url, 'gabriel');
    const hostile = await joinedClient(harness.url, 'ana');
    await honest.waitFor('snapshot', (message) => message.players.length === 2);

    hostile.socket.send('not json at all');
    hostile.socket.send('{"t":"input","dt":999999}');
    for (let seq = 1; seq <= 200; seq += 1) {
      hostile.send({ t: 'input', seq, keys: KEY_FORWARD, dir: [0, 0, -1] });
    }

    // The honest client is unaffected: its own inputs are still applied and acknowledged.
    for (let seq = 1; seq <= SERVER_TICK_HZ; seq += 1) {
      honest.send({ t: 'input', seq, keys: KEY_FORWARD, dir: [0, 0, -1] });
      await sleep(TICK_DURATION_MS);
    }

    const acked = await honest.waitFor('snapshot', (message) => message.ack > 0);
    expect(acked.ack).toBeGreaterThan(0);

    honest.close();
    hostile.close();
  });

  it('rejects a join the server does not accept, and closes the socket', async () => {
    harness = await startServer();

    const client = await open(harness.url);
    client.send({ t: 'join', nickname: 'a', mode: 'FFA' });

    const error = await client.waitFor('error');
    expect(error.code).toBe('MALFORMED');
    expect(harness.room.playerCount).toBe(0);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
