import type { APIRoute } from 'astro';
import { getThumbnail } from '../../../lib/thumbnails';

// The random id is the access key (thumbnails show a child's name), so: no listing,
// no indexing, private caching. Content never changes for an id, hence immutable.
export const GET: APIRoute = async ({ params }) => {
  const png = await getThumbnail(String(params.id ?? '').replace(/\.png$/, ''));
  if (!png) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
