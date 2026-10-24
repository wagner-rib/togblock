-- 3D-FIX-08: 512x512 PNG of the 3D preview, captured at Add to basket and kept
-- with the order for the confirmation email, order pages and the gift card.
-- Stored in the DB like review photos, so they survive container redeploys.

CREATE TABLE IF NOT EXISTS design_thumbnails (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- unguessable: the id is the access key
  png         bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_design_thumbnails_created ON design_thumbnails (created_at);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS thumbnail_id uuid
  REFERENCES design_thumbnails(id) ON DELETE SET NULL;
ALTER TABLE cart_items  ADD COLUMN IF NOT EXISTS thumbnail_id uuid
  REFERENCES design_thumbnails(id) ON DELETE SET NULL;
