/**
 * Server entry point. Deliberately inert until M1.
 *
 * NFR-002 requires a long-lived stateful process; the WebSocket server, the room and the
 * tick loop all arrive in M1, when the protocol exists to drive them. Writing a tick loop
 * before then would only mean rewriting it.
 *
 * What this file does earn today is the one thing M0 cannot otherwise prove: that
 * shared/ actually resolves and runs under plain Node, not just through Vite's resolver.
 * See specs/000-m0-walking-box/research.md R2 -- tsconfig `paths` would have satisfied
 * the client and failed here, and we would not have found out until M1.
 */

import { SERVER_TICK_HZ, TICK_DURATION_MS } from '#shared/constants/index.ts';
import { validateInput } from '#shared/sim/validate.ts';

export function describeRuntime(): string {
  const probe = validateInput({
    move: [0, 0, 0],
    dir: [0, 0, -1],
    jump: false,
    crouch: false,
    sprint: false,
  });
  const shared = probe === null ? 'unreachable' : 'reachable';
  return `bullet-proof server (inert until M1) — shared/ ${shared}, tick ${String(SERVER_TICK_HZ)} Hz / ${TICK_DURATION_MS.toFixed(2)} ms`;
}

console.log(describeRuntime());
