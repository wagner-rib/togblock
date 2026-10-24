import type { APIRoute } from 'astro';
import { allowUpload, checkPng, saveThumbnail } from '../../../lib/thumbnails';

// POST image/png (raw body) → { id }. Called by the builder at Add to basket.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || clientAddress || 'unknown';
  if (!allowUpload(ip)) return json({ error: 'Too many uploads, please try again in a few minutes' }, 429);
  if (request.headers.get('content-type') !== 'image/png') return json({ error: 'Send image/png' }, 415);

  const png = Buffer.from(await request.arrayBuffer());
  const problem = checkPng(png);
  if (problem) return json({ error: problem }, 400);

  try {
    return json({ id: await saveThumbnail(png) }, 201);
  } catch (err) {
    console.error('Thumbnail save failed:', err);
    return json({ error: 'Could not save the preview image' }, 500);
  }
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
