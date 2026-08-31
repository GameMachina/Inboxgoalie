# 🥅 Inbox Goalie

**Your AI already knows what matters. Let it guard your inbox.**

Inbox Goalie is a receiver-side ChatGPT/MCP plugin for turning unsolicited email into paid priority requests. V0.2 replaces Stripe Connect with Base-native USDC settlement.

## Current payment flow

```text
Sender opens Goalie link
        ↓
Apple Pay / Google Pay via Coinbase Headless Onramp
or card via Coinbase one-click Onramp Session
        ↓
Fiat becomes USDC on Base
        ↓
USDC lands in InboxGoaliePayments contract
        ↓
Backend independently verifies Coinbase/onchain settlement
        ↓
settlePayment(messageId, receiver, amount, feeBps)
        ↓
Receiver wallet gets its USDC share
Inbox Goalie treasury gets the platform fee
        ↓
Message status becomes released
```

The sender does **not** create a Coinbase account, connect a crypto wallet, manage gas, bridge tokens, or handle seed phrases in the intended guest-checkout flow. The receiver supplies a Base-compatible wallet as the payout destination.

## Why there is a settlement contract

Coinbase Onramp can send USDC to a Base destination address, but a normal ERC-20 transfer into a contract does not invoke application logic. Inbox Goalie therefore receives the USDC at a minimal settlement contract and, after independent verification of the actual USDC transfer, an operator transaction calls `settlePayment`. The contract atomically sends the receiver share and treasury fee. Funds are intended to remain in the contract only for the verification/settlement window; Inbox Goalie does not maintain user credit balances in V1.

## Receiver flow

MCP tools:

- `setup_receiver` — receiver email, price in USDC and fee basis points
- `connect_payout_wallet` — store a Base-compatible payout wallet
- `create_goalie_request` — create the sender payment link + Goalie reply
- `get_goalie_status` — read provider/onchain/release status
- `list_goalie_requests` — recent Goalie requests

Example economics with a $10 price and 20% fee:

```text
Gross settlement: 10 USDC
Receiver:          8 USDC
Inbox Goalie:      2 USDC
```

## Sender checkout

The payment page exposes:

- Pay with Apple Pay
- Pay with Google Pay
- Pay with Card

Apple Pay / Google Pay use Coinbase's current Headless Onramp Order API. Card uses Coinbase's one-click Onramp Session API. Payment providers are behind the `PaymentProvider` interface in `src/payments/provider.ts`, so Transak, MoonPay, Ramp, or regional providers can be added without changing Goalie request logic.

## Requirements and current Coinbase constraints

Coinbase Headless Onramp currently supports guest Apple Pay and Google Pay and is currently US-only for Headless users. Web Apple Pay requires production access, an allow-listed/verified domain, and the required iframe/security setup. Coinbase's hosted Onramp Session API supports `CARD` and returns a single-use checkout URL.

Coinbase sandbox Headless orders simulate success but do **not** create a real Base Sepolia USDC transfer. For contract development, deploy to Base Sepolia, use test USDC/faucet funds, and exercise the independent `/payments/verify/:requestId` path with a real Sepolia transaction hash. For production guest checkout, switch to Base mainnet configuration.

## Database migration

Existing installs should run:

```bash
psql "$DATABASE_URL" -f sql/migrations/002_base_payments.sql
```

The migration adds:

- `receivers.payout_wallet_address`
- `receivers.payout_chain`
- `receivers.message_price_usdc`
- `receivers.platform_fee_bps`
- generalized `payments` table with provider IDs, Base transaction hashes, settlement transaction hashes and verification timestamps

Old Stripe columns are retained only for rollback/history and are no longer read or written by V0.2. `src/stripe.ts` and the Stripe package dependency have been removed.

## Environment

Copy `.env.example` and configure:

```bash
BASE_CHAIN_ID=84532
BASE_RPC_URL=...
USDC_CONTRACT_ADDRESS=...
INBOX_GOALIE_PAYMENT_CONTRACT_ADDRESS=...
INBOX_GOALIE_TREASURY_ADDRESS=...
SETTLEMENT_OPERATOR_PRIVATE_KEY=...

CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
COINBASE_WEBHOOK_SECRET=...
COINBASE_ONRAMP_SANDBOX=true
COINBASE_ONRAMP_DOMAIN=...
PLATFORM_FEE_BPS=2000
```

Never commit the operator private key or CDP secrets.

Base mainnet uses chain ID `8453`; Base Sepolia uses `84532`. Network selection is environment-driven.

## Smart contract

`contracts/InboxGoaliePayments.sol` supports:

- USDC-only settlement
- receiver destination
- configurable fee per payment
- unique `bytes32` payment/message ID
- replay protection
- `PaymentSettled` event
- owner-controlled treasury/operator updates
- state-before-transfer settlement to minimize reentrancy surface

Deploy it with the correct USDC, treasury and operator addresses for the selected network. The sender never calls this contract and never needs ETH for gas; the backend settlement operator pays the settlement gas. A CDP Paymaster can be added later if operator gas sponsorship is useful, but it is not required to hide gas from senders.

## Independent verification

A redirect or frontend `payment complete` event never releases a message. The backend requires an actual successful Base transaction receipt containing a USDC `Transfer` to the configured Inbox Goalie payment contract for at least the expected amount, then submits the split transaction. Coinbase webhooks are authenticated with `X-Hook0-Signature` and are used as provider-side confirmation.

## Local development

```bash
cp .env.example .env
npm install
psql "$DATABASE_URL" -f sql/schema.sql
psql "$DATABASE_URL" -f sql/migrations/002_base_payments.sql
npm run typecheck
npm test
npm run dev
```

Health: `GET /health`

MCP: `POST /mcp`

## Connect to ChatGPT

Deploy the server to public HTTPS, register `https://YOUR-DOMAIN/mcp` in ChatGPT developer mode, and package the included plugin metadata/skill.

Suggested first conversation:

```text
Set up Inbox Goalie for me at $10 per priority request and connect my Base wallet.
```

Then:

```text
Goalie this email and give me the reply.
```

Inbox Goalie stores transaction/message metadata, not mailbox bodies. Payment buys priority, never a guaranteed read or reply.

## License

MIT
