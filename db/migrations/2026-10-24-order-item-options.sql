-- Orders never recorded what was configured beyond name + colours: letter size,
-- add-ons (dots, gift box), door-sign shape and colours. The checkout API now
-- re-prices each item from this configuration and stores it here.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS options jsonb;
ALTER TABLE cart_items  ADD COLUMN IF NOT EXISTS options jsonb;
