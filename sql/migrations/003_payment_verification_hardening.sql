-- Prevent a single Base transaction from being attributed to multiple Goalie requests.
CREATE UNIQUE INDEX IF NOT EXISTS payments_unique_transaction_hash_idx
  ON payments(transaction_hash)
  WHERE transaction_hash IS NOT NULL;

-- Provider payment IDs should also be unique within a provider when present.
CREATE UNIQUE INDEX IF NOT EXISTS payments_unique_provider_payment_idx
  ON payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
