ALTER TABLE receivers ADD COLUMN IF NOT EXISTS payout_wallet_address text;
ALTER TABLE receivers ADD COLUMN IF NOT EXISTS payout_chain text NOT NULL DEFAULT 'base';
ALTER TABLE receivers ADD COLUMN IF NOT EXISTS message_price_usdc numeric(18,6) NOT NULL DEFAULT 10.000000;
ALTER TABLE receivers ADD COLUMN IF NOT EXISTS platform_fee_bps integer NOT NULL DEFAULT 2000 CHECK (platform_fee_bps BETWEEN 0 AND 10000);

ALTER TABLE goalie_requests ADD COLUMN IF NOT EXISTS amount_usdc numeric(18,6);
ALTER TABLE goalie_requests ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'base';
ALTER TABLE goalie_requests ADD COLUMN IF NOT EXISTS released_at timestamptz;
UPDATE goalie_requests SET amount_usdc = amount_cents::numeric / 100 WHERE amount_usdc IS NULL;
ALTER TABLE goalie_requests ALTER COLUMN amount_usdc SET NOT NULL;
ALTER TABLE goalie_requests DROP CONSTRAINT IF EXISTS goalie_requests_status_check;
ALTER TABLE goalie_requests ADD CONSTRAINT goalie_requests_status_check CHECK (status IN ('pending','payment_pending','paid','released','expired','refunded'));

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goalie_request_id uuid UNIQUE NOT NULL REFERENCES goalie_requests(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_payment_id text,
  sender_email text NOT NULL,
  receiver_wallet text NOT NULL,
  amount_usdc numeric(18,6) NOT NULL,
  platform_fee_usdc numeric(18,6) NOT NULL,
  currency text NOT NULL DEFAULT 'USDC',
  chain text NOT NULL DEFAULT 'base',
  transaction_hash text,
  settlement_transaction_hash text,
  status text NOT NULL DEFAULT 'pending',
  provider_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS payments_provider_id_idx ON payments(provider, provider_payment_id);
CREATE INDEX IF NOT EXISTS payments_tx_hash_idx ON payments(transaction_hash);

-- Stripe columns are intentionally retained for rollback/history. New code no longer reads or writes them.
