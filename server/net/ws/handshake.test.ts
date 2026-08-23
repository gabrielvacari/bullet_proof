import { describe, expect, it } from 'vitest';

import { WS_PATH } from '#shared/constants/index.ts';

import {
  acceptKey,
  isUpgradeAcceptable,
  rejectResponse,
  upgradeResponse,
} from './handshake.ts';

const KEY = 'dGhlIHNhbXBsZSBub25jZQ==';

function headers(
  overrides: Record<string, string | string[] | undefined> = {},
): Record<string, string | string[] | undefined> {
  return {
    upgrade: 'websocket',
    'sec-websocket-version': '13',
    'sec-websocket-key': KEY,
    ...overrides,
  };
}

describe('acceptKey', () => {
  /** RFC 6455 section 1.3 uses exactly this key and expects exactly this answer. */
  it('reproduces the example from the specification', () => {
    expect(acceptKey(KEY)).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('depends on the key, so a different key gives a different answer', () => {
    expect(acceptKey('x'.repeat(24))).not.toBe(acceptKey(KEY));
  });
});

describe('isUpgradeAcceptable', () => {
  it('accepts a well-formed upgrade on the configured path', () => {
    expect(isUpgradeAcceptable(headers(), WS_PATH, WS_PATH)).toBe(true);
  });

  it('accepts a query string on the right path', () => {
    expect(isUpgradeAcceptable(headers(), `${WS_PATH}?v=1`, WS_PATH)).toBe(true);
  });

  /** Every other URL is refused rather than upgraded and then quietly ignored. */
  it('refuses any other path', () => {
    expect(isUpgradeAcceptable(headers(), '/', WS_PATH)).toBe(false);
    expect(isUpgradeAcceptable(headers(), `${WS_PATH}/extra`, WS_PATH)).toBe(false);
    expect(isUpgradeAcceptable(headers(), undefined, WS_PATH)).toBe(false);
  });

  it('accepts the Upgrade header in any case, as HTTP allows', () => {
    expect(isUpgradeAcceptable(headers({ upgrade: 'WebSocket' }), WS_PATH, WS_PATH)).toBe(
      true,
    );
  });

  it('refuses a missing or wrong Upgrade header', () => {
    expect(isUpgradeAcceptable(headers({ upgrade: undefined }), WS_PATH, WS_PATH)).toBe(
      false,
    );
    expect(isUpgradeAcceptable(headers({ upgrade: 'h2c' }), WS_PATH, WS_PATH)).toBe(
      false,
    );
    expect(
      isUpgradeAcceptable(headers({ upgrade: ['websocket'] }), WS_PATH, WS_PATH),
    ).toBe(false);
  });

  it('refuses any version but 13', () => {
    expect(
      isUpgradeAcceptable(headers({ 'sec-websocket-version': '8' }), WS_PATH, WS_PATH),
    ).toBe(false);
    expect(
      isUpgradeAcceptable(
        headers({ 'sec-websocket-version': undefined }),
        WS_PATH,
        WS_PATH,
      ),
    ).toBe(false);
  });

  it('refuses a key that is missing or the wrong length', () => {
    expect(
      isUpgradeAcceptable(headers({ 'sec-websocket-key': undefined }), WS_PATH, WS_PATH),
    ).toBe(false);
    expect(
      isUpgradeAcceptable(headers({ 'sec-websocket-key': 'short' }), WS_PATH, WS_PATH),
    ).toBe(false);
    expect(
      isUpgradeAcceptable(headers({ 'sec-websocket-key': ['a', 'b'] }), WS_PATH, WS_PATH),
    ).toBe(false);
  });
});

describe('responses', () => {
  it('builds a 101 carrying the accept key, ended by a blank line', () => {
    const response = upgradeResponse(KEY);
    expect(response.startsWith('HTTP/1.1 101 Switching Protocols\r\n')).toBe(true);
    expect(response).toContain(`Sec-WebSocket-Accept: ${acceptKey(KEY)}\r\n`);
    expect(response.endsWith('\r\n\r\n')).toBe(true);
  });

  it('negotiates no extension, so permessage-deflate is not used', () => {
    expect(upgradeResponse(KEY).toLowerCase()).not.toContain('sec-websocket-extensions');
  });

  it('builds a 400 that closes the connection', () => {
    expect(rejectResponse()).toBe(
      'HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n',
    );
  });
});
