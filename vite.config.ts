import { defineConfig } from 'vite';

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
  },
});
