type PrivyRpcResult = {
  method?: string;
  data?: {
    hash?: `0x${string}`;
    transaction_id?: string;
  };
  error?: { message?: string } | string;
};

function privyConfig() {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const walletId = process.env.PRIVY_OPERATOR_WALLET_ID;
  if (!appId || !appSecret || !walletId) {
    throw new Error("PRIVY_APP_ID, PRIVY_APP_SECRET and PRIVY_OPERATOR_WALLET_ID are required");
  }
  return { appId, appSecret, walletId };
}

export async function sendPrivyEvmTransaction(input: {
  to: `0x${string}`;
  data: `0x${string}`;
  chainId: number;
  idempotencyKey: string;
}) {
  const { appId, appSecret, walletId } = privyConfig();
  const auth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  const response = await fetch(`https://api.privy.io/v1/wallets/${walletId}/rpc`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      "privy-app-id": appId,
      "privy-idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      method: "eth_sendTransaction",
      caip2: `eip155:${input.chainId}`,
      chain_type: "ethereum",
      params: {
        transaction: {
          to: input.to,
          data: input.data,
          value: 0,
        },
      },
    }),
  });

  const body = (await response.json()) as PrivyRpcResult;
  if (!response.ok) {
    const detail = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(`Privy transaction failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const hash = body.data?.hash;
  if (!hash) throw new Error("Privy transaction response did not include a transaction hash");
  return { hash, privyTransactionId: body.data?.transaction_id };
}
