export type Receiver = {
  id: string;
  email: string;
  display_name: string | null;
  price_cents: number;
  currency: string;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
};

export type GoalieRequest = {
  id: string;
  token: string;
  receiver_id: string;
  sender_email: string;
  sender_name: string | null;
  subject: string | null;
  source_message_id: string | null;
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "expired" | "refunded";
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
  paid_at: string | null;
};
