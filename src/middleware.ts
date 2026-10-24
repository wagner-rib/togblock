import { defineMiddleware } from 'astro:middleware';
import { sendDueReviewRequests } from './lib/reviews';

// Background job: review request emails 7 days after dispatch (FIX-06).
// Started lazily on the first request so it only runs in the live server process,
// never during `astro build`. Set REVIEW_REQUESTS=off to disable.
const HOUR = 60 * 60 * 1000;
const g = globalThis as typeof globalThis & { __tbReviewJob?: NodeJS.Timeout };

function startReviewJob() {
  if (g.__tbReviewJob || process.env.REVIEW_REQUESTS === 'off') return;
  const run = () => sendDueReviewRequests()
    .then(n => { if (n) console.log(`[reviews] sent ${n} review request email(s)`); })
    .catch(err => console.error('[reviews] job failed:', err));
  g.__tbReviewJob = setInterval(run, HOUR);
  setTimeout(run, 60_000);
}

export const onRequest = defineMiddleware((_ctx, next) => {
  startReviewJob();
  return next();
});
