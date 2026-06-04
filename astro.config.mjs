import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://togblocks.ie',
  output: 'static',
  server: {
    host: '0.0.0.0',
    port: 5003,
    allowedHosts: ['deeptrendlab.com'],
  },
  integrations: [sitemap()],
});
