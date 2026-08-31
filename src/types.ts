export type Receiver = {
  id: string;
  email: string;
  display_name: string | null;
  payout_wallet_address: string | null;
  payout_chain: string;
  message_price_usdc: string;
  platform_fee_bps: number;
};

export type GoalieRequest = {
  id: string;
  token: string;
  receiver_id: string;
  sender_email: string;
  sender_name: string | null;
  subject: string | null;
  source_message_id: string | null;
  amount_usdc: string;
  currency: string;
  chain: string;
  status: "pending" | "payment_pending" | "paid" | "released" | "expired" | "refunded";
  created_at: string;
  paid_at: string | null;
  released_at: string | null;
};

export type PaymentRecord = {
  id: string;
  goalie_request_id: string;
  provider: string;
  provider_payment_id: string | null;
  sender_email: string;
  receiver_wallet: string;
  amount_usdc: string;
  platform_fee_usdc: string;
  currency: string;
  chain: string;
  transaction_hash: string | null;
  settlement_transaction_hash: string | null;
  status: string;
};
