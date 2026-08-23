import { defineConfig } from 'vite';

import { SERVER_PORT, WS_PATH } from '#shared/constants/index.ts';

/**
 * Client build only. The server is a plain long-lived Node process (NFR-002) and is
 * deliberately not bundled -- it runs its TypeScript directly via Node's type stripping.
 *
 * There is no `resolve.alias` block here on purpose. Module resolution goes through
 * package.json "imports" (#shared/*), which Vite and Node both understand natively.
 * An alias defined here would resolve for the client and silently not exist for the
 * server -- exactly the divergence NFR-003 exists to prevent.
 */
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  server: {
    open: true,
    /*
     * The page and its socket share one origin, so the client has no URL to configure
     * and two browsers reach the same server by opening the same address twice.
     *
     * SERVER_PORT and WS_PATH are imported rather than written here: the proxy target
     * and the port the server listens on must not be able to drift apart, and SC-4
     * makes a number written down in two files a defect.
     */
    proxy: {
      [WS_PATH]: {
        target: `ws://127.0.0.1:${String(SERVER_PORT)}`,
        ws: true,
      },
    },
  },
});
