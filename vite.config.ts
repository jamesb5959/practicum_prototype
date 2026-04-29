import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [sveltekit(), cesium()],
  resolve: {
    alias: {
      // Compatibility shim for older Cesium engine builds that still import
      // a zip.js path no longer exported by recent @zip.js/zip.js versions.
      '@zip.js/zip.js/lib/zip-no-worker.js': '@zip.js/zip.js/lib/zip-core.js'
    }
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium')
  }
});