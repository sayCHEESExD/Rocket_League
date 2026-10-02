import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const clientRoot = fileURLToPath(new URL('.', import.meta.url));
const repoAssets = fileURLToPath(new URL('../assets', import.meta.url));

/**
 * Files in `assets/` this game never loads (they came with the asset pack),
 * pruned from the build so they do not count against the 12 MB budget.
 */
const UNSHIPPED_ASSETS = [
  'player/base_rig.fbx',
  'ui/aura.png',
  'ui/Bills.png',
  'ui/energy.png',
  'ui/equipment.png',
  'ui/inventory.png',
  'ui/rebirth.png',
  'ui/shop.png',
  'ui/Sound.png',
  'ui/Upgrades.png',
  'audio/music.mp3',
  'audio/sui.mp3',
  'audio/walk.mp3',
  'audio/jump.mp3',
];

/** Drops UNSHIPPED_ASSETS after Vite copies publicDir into the build output. */
const pruneUnusedAssets = (): Plugin => ({
  name: 'rlb:prune-unused-assets',
  apply: 'build',
  async closeBundle() {
    for (const relativePath of UNSHIPPED_ASSETS) {
      await rm(join(clientRoot, 'dist', relativePath), { force: true });
    }
  },
});

export default defineConfig({
  plugins: [pruneUnusedAssets()],
  root: clientRoot,
  /**
   * Serve the repo-level `assets/` directory directly as the public root, so
   * the FBX and its texture are reachable at `/player/*` with NO duplicate
   * copies of the source assets inside the client workspace.
   */
  publicDir: repoAssets,
  server: {
    // Unique among the sibling games on this machine.
    port: 5480,
    strictPort: true,
    // Reachable from a phone on the same LAN for mobile testing.
    host: true,
  },
  preview: {
    port: 4480,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // Browser build budget is 12 MB; warn well before we get close.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          net: ['colyseus.js'],
        },
      },
    },
  },
});
