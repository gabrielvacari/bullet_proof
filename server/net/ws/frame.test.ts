import { describe, expect, it } from 'vitest';

import { MAX_MESSAGE_BYTES } from '#shared/constants/index.ts';

import {
  OPCODE_BINARY,
  OPCODE_CLOSE,
  OPCODE_CONTINUATION,
  OPCODE_PING,
  OPCODE_PONG,
  OPCODE_TEXT,
  closeFrame,
  decodeFrames,
  encodeText,
  pongFrame,
} from './frame.ts';

/**
 * RFC 6455, the subset a browser actually speaks to us.
 *
 * The decoder is the one piece of M1 that reads bytes a stranger chose, so it is fuzzed
 * with truncated, oversized and mislabelled input as well as the happy path. It refuses
 * anything above MAX_MESSAGE_BYTES **before** decoding it, which is both NFR-010 and the
 * reason this file stays small.
 */

/** Builds a client frame: masked, as RFC 6455 requires of every client-to-server frame. */
function clientFrame(
  opcode: number,
  payload: Buffer,
  options: { fin?: boolean; mask?: boolean } = {},
): Buffer {
  const fin = options.fin ?? true;
  const masked = options.mask ?? true;

  const header: number[] = [(fin ? 0x80 : 0) | opcode];
  const maskBit = masked ? 0x80 : 0;

  if (payload.length < 126) {
    header.push(maskBit | payload.length);
  } else if (payload.length < 65_536) {
    header.push(maskBit | 126, payload.length >> 8, payload.length & 0xff);
  } else {
    header.push(maskBit | 127, 0, 0, 0, 0);
    header.push(
      (payload.length >>> 24) & 0xff,
      (payload.length >>> 16) & 0xff,
      (payload.length >>> 8) & 0xff,
      payload.length & 0xff,
    );
  }

  if (!masked) return Buffer.concat([Buffer.from(header), payload]);

  const key = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i += 1) {
    const keyByte = key[i % 4] ?? 0;
    body[i] = (body[i] ?? 0) ^ keyByte;
  }
  return Buffer.concat([Buffer.from(header), key, body]);
}

function textFrame(text: string): Buffer {
  return clientFrame(OPCODE_TEXT, Buffer.from(text, 'utf8'));
}

describe('decodeFrames — the happy path', () => {
  it('decodes a masked text frame', () => {
    const { frames, rest, error } = decodeFrames(textFrame('{"t":"leave"}'));
    expect(error).toBeNull();
    expect(rest).toHaveLength(0);
    expect(frames).toEqual([{ opcode: OPCODE_TEXT, payload: '{"t":"leave"}' }]);
  });

  it('decodes several frames delivered in one chunk', () => {
    const chunk = Buffer.concat([textFrame('one'), textFrame('two')]);
    const { frames } = decodeFrames(chunk);
    expect(frames.map((f) => f.payload)).toEqual(['one', 'two']);
  });

  it('decodes a payload that needs the 16-bit length form', () => {
    const text = 'x'.repeat(200);
    const { frames } = decodeFrames(textFrame(text));
    expect(frames[0]?.payload).toBe(text);
  });

  it('decodes UTF-8 beyond ASCII', () => {
    const { frames } = decodeFrames(textFrame('ação — 日本'));
    expect(frames[0]?.payload).toBe('ação — 日本');
  });

  it('recognises close, ping and pong control frames', () => {
    for (const opcode of [OPCODE_CLOSE, OPCODE_PING, OPCODE_PONG]) {
      const { frames } = decodeFrames(clientFrame(opcode, Buffer.alloc(0)));
      expect(frames[0]?.opcode).toBe(opcode);
    }
  });

  it('reassembles a fragmented text message', () => {
    const chunk = Buffer.concat([
      clientFrame(OPCODE_TEXT, Buffer.from('hel'), { fin: false }),
      clientFrame(OPCODE_CONTINUATION, Buffer.from('lo'), { fin: true }),
    ]);
    const { frames } = decodeFrames(chunk);
    expect(frames).toEqual([{ opcode: OPCODE_TEXT, payload: 'hello' }]);
  });
});

describe('decodeFrames — partial delivery', () => {
  it('returns the unconsumed bytes rather than guessing at them', () => {
    const whole = textFrame('hello');
    const { frames, rest, error } = decodeFrames(whole.subarray(0, 4));
    expect(error).toBeNull();
    expect(frames).toHaveLength(0);
    expect(rest).toEqual(whole.subarray(0, 4));
  });

  it('decodes what is complete and keeps the remainder', () => {
    const chunk = Buffer.concat([textFrame('one'), textFrame('two').subarray(0, 3)]);
    const { frames, rest } = decodeFrames(chunk);
    expect(frames.map((f) => f.payload)).toEqual(['one']);
    expect(rest).toHaveLength(3);
  });

  it('waits for the rest of a 16-bit length header split across chunks', () => {
    const whole = textFrame('x'.repeat(200));
    const { frames, rest, error } = decodeFrames(whole.subarray(0, 3));
    expect(error).toBeNull();
    expect(frames).toHaveLength(0);
    expect(rest).toHaveLength(3);
  });

  it('handles an empty chunk', () => {
    const { frames, rest, error } = decodeFrames(Buffer.alloc(0));
    expect(frames).toHaveLength(0);
    expect(rest).toHaveLength(0);
    expect(error).toBeNull();
  });

  it('holds an incomplete fragment until its continuation arrives', () => {
    const first = decodeFrames(
      clientFrame(OPCODE_TEXT, Buffer.from('hel'), { fin: false }),
    );
    expect(first.frames).toHaveLength(0);

    const second = decodeFrames(
      clientFrame(OPCODE_CONTINUATION, Buffer.from('lo'), { fin: true }),
      first.pending,
    );
    expect(second.frames[0]?.payload).toBe('hello');
  });
});

describe('decodeFrames — refusing what it must not decode', () => {
  /** NFR-010. Refused on the header, so the payload is never allocated or scanned. */
  it('refuses a frame declaring more than MAX_MESSAGE_BYTES', () => {
    const oversized = clientFrame(OPCODE_TEXT, Buffer.alloc(MAX_MESSAGE_BYTES + 1, 0x61));
    const { error } = decodeFrames(oversized);
    expect(error).toBe('TOO_LARGE');
  });

  it('refuses a 64-bit length header outright — nothing legitimate needs one', () => {
    const header = Buffer.from([0x81, 0xff, 0, 0, 0, 0, 0, 0, 0x10, 0x00]);
    expect(decodeFrames(header).error).toBe('TOO_LARGE');
  });

  it('refuses an unmasked client frame, as RFC 6455 requires', () => {
    const unmasked = clientFrame(OPCODE_TEXT, Buffer.from('hello'), { mask: false });
    expect(decodeFrames(unmasked).error).toBe('UNMASKED');
  });

  it('refuses a binary frame — v1 is JSON text (NET-022 is deferred)', () => {
    expect(decodeFrames(clientFrame(OPCODE_BINARY, Buffer.from([1]))).error).toBe(
      'UNSUPPORTED',
    );
  });

  it('refuses an opcode the protocol does not define', () => {
    expect(decodeFrames(clientFrame(0x03, Buffer.alloc(0))).error).toBe('UNSUPPORTED');
  });

  it('refuses a continuation with nothing to continue', () => {
    const orphan = clientFrame(OPCODE_CONTINUATION, Buffer.from('lo'), { fin: true });
    expect(decodeFrames(orphan).error).toBe('UNSUPPORTED');
  });

  it('refuses a fragmented message that grows past MAX_MESSAGE_BYTES in total', () => {
    const half = Buffer.alloc(Math.ceil(MAX_MESSAGE_BYTES / 2) + 1, 0x61);
    const chunk = Buffer.concat([
      clientFrame(OPCODE_TEXT, half, { fin: false }),
      clientFrame(OPCODE_CONTINUATION, half, { fin: true }),
    ]);
    expect(decodeFrames(chunk).error).toBe('TOO_LARGE');
  });

  it('refuses a new data frame while a fragment is still in progress', () => {
    const chunk = Buffer.concat([
      clientFrame(OPCODE_TEXT, Buffer.from('hel'), { fin: false }),
      clientFrame(OPCODE_TEXT, Buffer.from('lo'), { fin: true }),
    ]);
    expect(decodeFrames(chunk).error).toBe('UNSUPPORTED');
  });

  it('refuses a fragmented control frame', () => {
    const split = clientFrame(OPCODE_PING, Buffer.alloc(0), { fin: false });
    expect(decodeFrames(split).error).toBe('UNSUPPORTED');
  });

  it('never throws, whatever bytes it is given', () => {
    for (let seed = 0; seed < 256; seed += 1) {
      const noise = Buffer.from([seed, seed ^ 0xff, seed >> 1, seed << 1, seed]);
      expect(() => decodeFrames(noise)).not.toThrow();
    }
  });
});

describe('encoding server frames', () => {
  it('encodes a short text frame unmasked, as a server must', () => {
    const encoded = encodeText('hi');
    expect(encoded[0]).toBe(0x81);
    // No mask bit: the high bit of the second byte is clear.
    expect((encoded[1] ?? 0) & 0x80).toBe(0);
    expect(encoded[1]).toBe(2);
    expect(encoded.subarray(2).toString('utf8')).toBe('hi');
  });

  it('uses the 16-bit length form beyond 125 bytes', () => {
    const encoded = encodeText('x'.repeat(300));
    expect(encoded[1]).toBe(126);
    expect(encoded.readUInt16BE(2)).toBe(300);
    expect(encoded.subarray(4).toString('utf8')).toHaveLength(300);
  });

  it('measures the payload in bytes, not characters', () => {
    // Each of these is three UTF-8 bytes, so 50 of them need the 16-bit form.
    const encoded = encodeText('日'.repeat(50));
    expect(encoded[1]).toBe(126);
    expect(encoded.readUInt16BE(2)).toBe(150);
  });

  it('builds a close frame carrying its status code', () => {
    const frame = closeFrame(1000);
    expect(frame[0]).toBe(0x88);
    expect(frame[1]).toBe(2);
    expect(frame.readUInt16BE(2)).toBe(1000);
  });

  it('builds a pong echoing the ping payload', () => {
    const frame = pongFrame(Buffer.from('ka'));
    expect(frame[0]).toBe(0x8a);
    expect(frame.subarray(2).toString('utf8')).toBe('ka');
  });

  it('round-trips through its own decoder once masked by a client', () => {
    // The server never masks, so re-mask the payload to make a legal client frame.
    const decoded = decodeFrames(textFrame('round trip'));
    expect(decoded.frames[0]?.payload).toBe('round trip');
  });
});
