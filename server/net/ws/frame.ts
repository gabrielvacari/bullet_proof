import { MAX_MESSAGE_BYTES } from '#shared/constants/index.ts';

/**
 * RFC 6455 framing -- the subset a browser speaks to this server, and nothing else.
 *
 * This exists because adding `ws` needs the project owner's approval, which the M1 flow
 * could not obtain unattended (research.md R2, gate OQ-B). It sits behind
 * server/net/transport.ts, so approving `ws` later replaces this directory and touches
 * nothing that knows about the game.
 *
 * Everything here is a pure function over Buffers: bytes in, frames out. That is what
 * makes the 90% threshold on server/** reachable on the one piece of M1 that parses bytes
 * a stranger chose, and it is why the file can be fuzzed rather than merely exercised.
 *
 * The rules that keep it small:
 *   - a frame declaring more than MAX_MESSAGE_BYTES is refused on its header, before the
 *     payload is allocated or scanned (NFR-010);
 *   - the 64-bit length form is refused outright -- nothing legitimate at this scale needs
 *     one, and accepting it would mean trusting a stranger's allocation size;
 *   - binary frames are refused, because v1 is JSON text (NET-022 is DEFERRED);
 *   - client frames must be masked, as the RFC requires; an unmasked one is a broken or
 *     hostile peer either way.
 */

export const OPCODE_CONTINUATION = 0x0;
export const OPCODE_TEXT = 0x1;
export const OPCODE_BINARY = 0x2;
export const OPCODE_CLOSE = 0x8;
export const OPCODE_PING = 0x9;
export const OPCODE_PONG = 0xa;

/** Normal closure -- RFC 6455 section 7.4.1. */
export const CLOSE_NORMAL = 1000;
/** Message too big for this endpoint to process. */
export const CLOSE_TOO_LARGE = 1009;
/** A protocol error: an unmasked frame, an undefined opcode, an orphan continuation. */
export const CLOSE_PROTOCOL_ERROR = 1002;

const MASK_BYTES = 4;
const LENGTH_16 = 126;
const LENGTH_64 = 127;
const FIN_BIT = 0x80;
const OPCODE_MASK = 0x0f;
const MASK_BIT = 0x80;
const LENGTH_MASK = 0x7f;
const BYTE = 0xff;
const BITS_PER_BYTE = 8;

export type FrameError = 'TOO_LARGE' | 'UNMASKED' | 'UNSUPPORTED';

export interface Frame {
  /** Always OPCODE_TEXT, OPCODE_CLOSE, OPCODE_PING or OPCODE_PONG once decoded. */
  readonly opcode: number;
  readonly payload: string;
}

/** A message split across frames, held until its final fragment arrives. */
export interface PendingFragment {
  readonly opcode: number;
  readonly chunks: readonly Buffer[];
  readonly bytes: number;
}

export interface DecodeResult {
  readonly frames: readonly Frame[];
  /** Bytes of an incomplete frame, to be prepended to the next chunk. */
  readonly rest: Buffer;
  /** A fragmented message still waiting for its final frame. */
  readonly pending: PendingFragment | null;
  /** Non-null means the connection must be closed; nothing after it was decoded. */
  readonly error: FrameError | null;
}

/**
 * Decodes every complete frame in `chunk`, returning the leftover bytes and any fragment
 * still in progress. Never throws: it runs on whatever a socket delivers.
 */
export function decodeFrames(
  chunk: Buffer,
  pending: PendingFragment | null = null,
): DecodeResult {
  const frames: Frame[] = [];
  let fragment = pending;
  let offset = 0;

  for (;;) {
    const header = readHeader(chunk, offset);
    if (header === null) break;
    if (typeof header === 'string') {
      return { frames, rest: Buffer.alloc(0), pending: null, error: header };
    }

    const body = unmask(chunk, header);
    offset = header.end;

    if (isControl(header.opcode)) {
      // Control frames are never fragmented, and their payloads are tiny.
      if (!header.fin) {
        return { frames, rest: Buffer.alloc(0), pending: null, error: 'UNSUPPORTED' };
      }
      frames.push({ opcode: header.opcode, payload: body.toString('utf8') });
      continue;
    }

    const merged = accumulate(fragment, header.opcode, body);
    if (typeof merged === 'string') {
      return { frames, rest: Buffer.alloc(0), pending: null, error: merged };
    }

    if (!header.fin) {
      fragment = merged;
      continue;
    }

    frames.push({
      opcode: merged.opcode,
      payload: Buffer.concat(merged.chunks).toString('utf8'),
    });
    fragment = null;
  }

  return { frames, rest: chunk.subarray(offset), pending: fragment, error: null };
}

interface Header {
  readonly fin: boolean;
  readonly opcode: number;
  readonly maskAt: number;
  readonly bodyAt: number;
  readonly length: number;
  readonly end: number;
}

/** Returns null when more bytes are needed, or a FrameError when the frame is refused. */
function readHeader(chunk: Buffer, offset: number): Header | FrameError | null {
  if (chunk.length - offset < 2) return null;

  // readUInt8 rather than indexing: the length check above already guarantees both bytes
  // exist, and indexing under noUncheckedIndexedAccess would add an unreachable branch.
  const first = chunk.readUInt8(offset);
  const second = chunk.readUInt8(offset + 1);
  const opcode = first & OPCODE_MASK;

  if (opcode === OPCODE_BINARY || !isKnownOpcode(opcode)) return 'UNSUPPORTED';
  if ((second & MASK_BIT) === 0) return 'UNMASKED';

  const short = second & LENGTH_MASK;
  if (short === LENGTH_64) return 'TOO_LARGE';

  let length = short;
  let maskAt = offset + 2;
  if (short === LENGTH_16) {
    if (chunk.length - offset < 4) return null;
    length = chunk.readUInt16BE(offset + 2);
    maskAt = offset + 4;
  }
  if (length > MAX_MESSAGE_BYTES) return 'TOO_LARGE';

  const bodyAt = maskAt + MASK_BYTES;
  const end = bodyAt + length;
  if (chunk.length < end) return null;

  return { fin: (first & FIN_BIT) !== 0, opcode, maskAt, bodyAt, length, end };
}

function isKnownOpcode(opcode: number): boolean {
  return (
    opcode === OPCODE_CONTINUATION ||
    opcode === OPCODE_TEXT ||
    opcode === OPCODE_BINARY ||
    opcode === OPCODE_CLOSE ||
    opcode === OPCODE_PING ||
    opcode === OPCODE_PONG
  );
}

function isControl(opcode: number): boolean {
  return opcode === OPCODE_CLOSE || opcode === OPCODE_PING || opcode === OPCODE_PONG;
}

function unmask(chunk: Buffer, header: Header): Buffer {
  const body = Buffer.from(chunk.subarray(header.bodyAt, header.end));
  for (let i = 0; i < body.length; i += 1) {
    const keyByte = chunk.readUInt8(header.maskAt + (i % MASK_BYTES));
    body.writeUInt8(body.readUInt8(i) ^ keyByte, i);
  }
  return body;
}

/**
 * Joins a data frame onto whatever fragment is in progress, enforcing the size cap across
 * the whole message rather than each frame -- otherwise a client could send a megabyte in
 * thousand-byte instalments.
 */
function accumulate(
  fragment: PendingFragment | null,
  opcode: number,
  body: Buffer,
): PendingFragment | FrameError {
  if (opcode === OPCODE_CONTINUATION) {
    if (fragment === null) return 'UNSUPPORTED';
    const bytes = fragment.bytes + body.length;
    if (bytes > MAX_MESSAGE_BYTES) return 'TOO_LARGE';
    return { opcode: fragment.opcode, chunks: [...fragment.chunks, body], bytes };
  }

  // A new data frame while one is already in progress is a protocol violation.
  if (fragment !== null) return 'UNSUPPORTED';
  return { opcode, chunks: [body], bytes: body.length };
}

/* ------------------------------------------------------------- Encoding ---- */

/** A server never masks (RFC 6455 section 5.1), so the mask bit is always clear here. */
export function encodeText(text: string): Buffer {
  return frame(OPCODE_TEXT, Buffer.from(text, 'utf8'));
}

export function closeFrame(code: number): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return frame(OPCODE_CLOSE, payload);
}

export function pongFrame(payload: Buffer): Buffer {
  return frame(OPCODE_PONG, payload);
}

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const header =
    length < LENGTH_16
      ? Buffer.from([FIN_BIT | opcode, length])
      : Buffer.from([
          FIN_BIT | opcode,
          LENGTH_16,
          (length >> BITS_PER_BYTE) & BYTE,
          length & BYTE,
        ]);
  return Buffer.concat([header, payload]);
}
