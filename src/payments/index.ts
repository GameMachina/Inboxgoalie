import type { PaymentProvider } from "./provider.js";
import { CoinbaseOnrampProvider } from "./coinbase.js";
import { MockPaymentProvider } from "./mock.js";

let singleton: PaymentProvider | undefined;

export function paymentProvider(): PaymentProvider {
  if (singleton) return singleton;
  singleton = process.env.PAYMENT_PROVIDER === "mock" ? new MockPaymentProvider() : new CoinbaseOnrampProvider();
  return singleton;
}
