CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS receivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  display_name text,
  price_cents integer NOT NULL DEFAULT 1000 CHECK (price_cents >= 100),
  currency text NOT NULL DEFAULT 'usd',
  stripe_account_id text,
  stripe_onboarding_complete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goalie_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  receiver_id uuid NOT NULL REFERENCES receivers(id) ON DELETE CASCADE,
  sender_email text NOT NULL,
  sender_name text,
  subject text,
  source_message_id text,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','refunded')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE INDEX IF NOT EXISTS goalie_requests_receiver_idx ON goalie_requests(receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS goalie_requests_sender_idx ON goalie_requests(sender_email, created_at DESC);
