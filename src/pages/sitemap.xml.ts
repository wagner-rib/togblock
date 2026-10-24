import type { APIRoute } from 'astro';

// The sitemap integration writes /sitemap-index.xml; keep the conventional URL working too.
export const GET: APIRoute = () =>
  new Response(null, { status: 301, headers: { Location: '/sitemap-index.xml' } });
