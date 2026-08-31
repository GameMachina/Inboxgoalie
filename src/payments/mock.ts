import type { CreatePaymentInput, CreatedPayment, PaymentProvider, PaymentStatus } from "./provider.js";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    return { provider: this.name, providerPaymentId: `mock-${input.goalieRequestId}`, checkoutUrl: `${process.env.APP_BASE_URL}/mock-pay/${input.goalieRequestId}`, status: "pending" };
  }
  async getPaymentStatus(_id: string): Promise<PaymentStatus> { return { status: "completed" }; }
  async verifyPayment(id: string) { return this.getPaymentStatus(id); }
  async refundPayment(_id: string) { return { supported: true, status: "mock-refunded" }; }
}
