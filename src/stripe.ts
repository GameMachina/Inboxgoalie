import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is required");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const platformFeeBps = Number(process.env.PLATFORM_FEE_BPS ?? 3000);

export function platformFee(amountCents: number) {
  return Math.max(1, Math.floor((amountCents * platformFeeBps) / 10_000));
}
