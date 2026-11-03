import { defineConfig } from 'vite';

// Served from its own subdomain (store-kpis-demo.atlas-lac.com), so assets live at the root.
export default defineConfig({
  base: '/',
});
