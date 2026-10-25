-- Optional gift message from checkout, printed on the gift card in the box.
-- (orders.notes stays for delivery/special instructions.)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_message text;
