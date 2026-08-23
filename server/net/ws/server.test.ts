import type { AddressInfo, Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_MESSAGE_BYTES, WS_PATH } from '#shared/constants/index.ts';

import type { Connection, Transport } from '../transport.ts';
import { listen } from './server.ts';

/**
 * The transport against a real socket, using Node 24's built-in WebSocket **client**.
 *
 * These are the tests the pure codec cannot give: that the handshake actually completes
 * with a client that did not read our source, that a message survives the whole path, and
 * that a closing socket reaches the game as one `onClose`. They need no dependency --
 * research.md R2 chose the hand-rolled server partly because Node already ships the
 * client that proves it works.
 */

let open: { server: Server; transport: Transport } | null = null;

async function start(): Promise<{ url: string; accepted: Connection[] }> {
  const started = await listen(0);
  open = started;

  const accepted: Connection[] = [];
  started.transport.onConnection((connection) => {
    accepted.push(connection);
  });

  const { port } = started.server.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${String(port)}${WS_PATH}`, accepted };
}

afterEach(async () => {
  await open?.transport.close();
  open = null;
});

/** Resolves on the client's first message, or rejects if the socket closes first. */
function firstMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      resolve(event.data);
    });
    socket.addEventListener('close', () => {
      reject(new Error('closed before any message'));
    });
  });
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve();
    });
    socket.addEventListener('error', () => {
      reject(new Error('handshake failed'));
    });
  });
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.addEventListener('close', (event: CloseEvent) => {
      resolve(event.code);
    });
  });
}

describe('the WebSocket transport, end to end', () => {
  it('completes the handshake with a client that never read our source', async () => {
    const { url, accepted } = await start();
    const socket = new WebSocket(url);
    await opened(socket);

    expect(accepted).toHaveLength(1);
    socket.close();
  });

  it('carries a message in each direction', async () => {
    const { url, accepted } = await start();
    const socket = new WebSocket(url);
    await opened(socket);

    const connection = accepted[0];
    if (connection === undefined) throw new Error('no connection');

    const received = new Promise<string>((resolve) => {
      connection.onMessage(resolve);
    });
    socket.send('{"t":"leave"}');
    expect(await received).toBe('{"t":"leave"}');

    const echoed = firstMessage(socket);
    connection.send('{"t":"playerLeft","id":"p_1"}');
    expect(await echoed).toBe('{"t":"playerLeft","id":"p_1"}');

    socket.close();
  });

  it('carries a message larger than the 125-byte short length form', async () => {
    const { url, accepted } = await start();
    const socket = new WebSocket(url);
    await opened(socket);

    const connection = accepted[0];
    if (connection === undefined) throw new Error('no connection');

    const long = 'x'.repeat(MAX_MESSAGE_BYTES - 1);
    const received = new Promise<string>((resolve) => {
      connection.onMessage(resolve);
    });
    socket.send(long);
    expect(await received).toBe(long);

    socket.close();
  });

  it('reports a client-initiated close exactly once', async () => {
    const { url, accepted } = await start();
    const socket = new WebSocket(url);
    await opened(socket);

    const connection = accepted[0];
    if (connection === undefined) throw new Error('no connection');

    let closes = 0;
    const sawClose = new Promise<void>((resolve) => {
      connection.onClose(() => {
        closes += 1;
        resolve();
      });
    });

    socket.close();
    await sawClose;
    expect(closes).toBe(1);
  });

  it('closes the client when the server closes the connection', async () => {
    const { url, accepted } = await start();
    const socket = new WebSocket(url);
    await opened(socket);

    const connection = accepted[0];
    if (connection === undefined) throw new Error('no connection');

    const code = closed(socket);
    connection.close();
    await expect(code).resolves.toBeGreaterThan(0);
  });

  /** NFR-010, proven against a real client rather than a constructed buffer. */
  it('closes a client that sends more than MAX_MESSAGE_BYTES', async () => {
    const { url } = await start();
    const socket = new WebSocket(url);
    await opened(socket);

    const code = closed(socket);
    socket.send('x'.repeat(MAX_MESSAGE_BYTES + 1));
    await expect(code).resolves.toBeGreaterThan(0);
  });

  it('refuses an upgrade on any path but WS_PATH', async () => {
    const started = await listen(0);
    open = started;
    const { port } = started.server.address() as AddressInfo;

    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/not-the-socket`);
    await expect(opened(socket)).rejects.toThrow('handshake failed');
  });

  it('ignores a send or close on an already-closed connection', async () => {
    const { url, accepted } = await start();
    const socket = new WebSocket(url);
    await opened(socket);

    const connection = accepted[0];
    if (connection === undefined) throw new Error('no connection');

    connection.close();
    // Idempotent: a room removing a player it has already dropped must not throw.
    expect(() => {
      connection.close();
      connection.send('ignored');
    }).not.toThrow();
  });
});
