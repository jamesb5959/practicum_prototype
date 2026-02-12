import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [sveltekit(), cesium()],
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium')
  }
});
