const appId = process.env.PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;

if (!appId || !appSecret) {
  throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET are required");
}

const auth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
const response = await fetch("https://api.privy.io/v1/wallets", {
  method: "POST",
  headers: {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
    "privy-app-id": appId,
    "privy-idempotency-key": "inbox-goalie-settlement-operator-v1",
  },
  body: JSON.stringify({ chain_type: "ethereum" }),
});

const body = await response.json();
if (!response.ok) {
  throw new Error(`Privy wallet creation failed (${response.status}): ${JSON.stringify(body)}`);
}

console.log(JSON.stringify({
  wallet_id: body.id,
  address: body.address,
  chain_type: body.chain_type,
}, null, 2));
