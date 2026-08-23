import type { ClientMessage, ServerMessage } from './types.ts';

/**
 * JSON, with no replacer and no rounding (NET-001, and NET-022's DEFERRED status).
 *
 * **Rounding coordinates here would be a bug, not an optimisation.** NFR-003 requires the
 * client's replay of an input to reproduce the server's state exactly, and JSON.stringify
 * already emits the shortest decimal string that round-trips an IEEE 754 double without
 * loss -- so the wire costs nothing in precision today. Trimming to three decimals would
 * save a fraction of the bandwidth NET-022 has already measured as within budget, and
 * spend the bit-identity the entire netcode design rests on.
 *
 * Binary encoding (NET-022) and delta compression (NET-023) are DEFERRED for the same
 * reason and must not be reached for here. Full JSON snapshots are also what make a desync
 * debuggable, and M1 is the milestone where desyncs happen.
 */
export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

/**
 * The inverse, and total: a socket delivers whatever the peer sent, including text that is
 * not JSON at all. Returns null rather than throwing, because the caller is a message
 * handler inside a tick loop that other players depend on (NFR-015).
 */
export function decode(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
