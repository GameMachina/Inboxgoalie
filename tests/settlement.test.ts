import test from "node:test";
import assert from "node:assert/strict";
import { platformFeeUsdc } from "../src/payments/settlement.js";
import { MockPaymentProvider } from "../src/payments/mock.js";

test("20% platform fee on 10 USDC is 2 USDC", () => {
  assert.equal(platformFeeUsdc("10.000000", 2000), "2.000000");
});

test("zero fee is supported", () => {
  assert.equal(platformFeeUsdc("10.000000", 0), "0.000000");
});

test("mock provider preserves provider abstraction", async () => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  const provider = new MockPaymentProvider();
  const created = await provider.createPayment({
    goalieRequestId: "00000000-0000-0000-0000-000000000001",
    senderEmail: "sender@example.com",
    amountUsdc: "10.000000",
    destinationAddress: "0x0000000000000000000000000000000000000001",
    method: "card",
  });
  assert.equal(created.provider, "mock");
  assert.match(created.checkoutUrl, /mock-pay/);
  assert.equal((await provider.verifyPayment(created.providerPaymentId!)).status, "completed");
});
