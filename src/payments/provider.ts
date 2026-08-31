export type PaymentMethod = "apple_pay" | "google_pay" | "card";

export type CreatePaymentInput = {
  goalieRequestId: string;
  senderEmail: string;
  amountUsdc: string;
  destinationAddress: `0x${string}`;
  method: PaymentMethod;
  clientIp?: string;
};

export type CreatedPayment = {
  provider: string;
  providerPaymentId?: string;
  checkoutUrl: string;
  status: "pending" | "processing";
};

export type PaymentStatus = {
  status: "pending" | "processing" | "completed" | "failed" | "refunded";
  transactionHash?: `0x${string}`;
};

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>;
  verifyPayment(providerPaymentId: string): Promise<PaymentStatus>;
  refundPayment(providerPaymentId: string): Promise<{ supported: boolean; status?: string }>;
}
