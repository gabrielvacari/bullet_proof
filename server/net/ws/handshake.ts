import { createHash } from 'node:crypto';

/**
 * The RFC 6455 opening handshake.
 *
 * The whole of it: a client offers a random `Sec-WebSocket-Key`, and the server proves it
 * understood the protocol by returning the SHA-1 of that key concatenated with a fixed
 * GUID, in base64. It is not a security mechanism -- it exists so that a caching proxy
 * cannot accidentally complete an upgrade.
 *
 * No extension is negotiated. `permessage-deflate` is offered by every browser and simply
 * not echoed here, so it is not used: compressing JSON that NET-022 has already measured
 * as within budget would add a code path to the one part of M1 that parses hostile bytes.
 */

/** RFC 6455 section 1.3. Fixed by the specification, not a tuning value. */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** The base64 length of a 16-byte key: the only shape a conforming client sends. */
const KEY_LENGTH = 24;

export function acceptKey(key: string): string {
  return createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');
}

/**
 * Whether an upgrade request may be completed.
 *
 * The path check is what stops the server from accepting a socket on any URL a stranger
 * tries -- WS_PATH is the only one it speaks, and every other upgrade is refused rather
 * than silently upgraded and then ignored.
 */
export function isUpgradeAcceptable(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  url: string | undefined,
  path: string,
): boolean {
  if (url === undefined) return false;
  // A query string is not part of the path, and M1 defines no query parameters.
  if (url.split('?')[0] !== path) return false;

  const upgrade = headers['upgrade'];
  if (typeof upgrade !== 'string' || upgrade.toLowerCase() !== 'websocket') return false;

  const version = headers['sec-websocket-version'];
  if (version !== '13') return false;

  const key = headers['sec-websocket-key'];
  return typeof key === 'string' && key.length === KEY_LENGTH;
}

/** The 101 response. CRLF-terminated, with the blank line that ends the header block. */
export function upgradeResponse(key: string): string {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    '',
    '',
  ].join('\r\n');
}

/** The refusal, for an upgrade this server does not speak. */
export function rejectResponse(): string {
  return ['HTTP/1.1 400 Bad Request', 'Connection: close', '', ''].join('\r\n');
}
