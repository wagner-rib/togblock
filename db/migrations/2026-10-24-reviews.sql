-- FIX-06: customer reviews with optional photo, moderated before display.
-- Photos live in the DB (not the container filesystem) so they survive redeploys.

CREATE TABLE IF NOT EXISTS reviews (
  id            bigserial PRIMARY KEY,
  order_id      bigint REFERENCES orders(id) ON DELETE SET NULL,
  product_type  text,
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body          text NOT NULL,
  display_name  text NOT NULL,
  location      text,
  photo         bytea,
  photo_mime    text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  moderated_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reviews_status_created ON reviews (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_order ON reviews (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_requested_at timestamptz;
