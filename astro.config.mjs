import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://togblocks.com',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: {
    host: '0.0.0.0',
    port: 5003,
    allowedHosts: ['deeptrendlab.com', 'togblocks.com', 'www.togblocks.com'],
  },
  security: {
    checkOrigin: false,
  },
  integrations: [sitemap()],
});
