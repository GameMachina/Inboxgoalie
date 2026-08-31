# 🥅 Inbox Goalie

**Your AI already knows what matters. Let it guard your inbox.**

Inbox Goalie is a receiver-side ChatGPT/MCP plugin for turning unsolicited email into paid priority requests.

V0.1 deliberately does one thing:

1. Receiver installs the MCP plugin.
2. Receiver sets a priority price, e.g. $10.
3. Receiver connects Stripe payouts.
4. In ChatGPT, the receiver says: **“Goalie this email.”**
5. Inbox Goalie creates a unique payment link and standardized reply.
6. ChatGPT can use the reply with the user's email connector when the user authorizes sending.
7. Sender pays.
8. Stripe routes the receiver share to the receiver and the application fee to Inbox Goalie.

Payment buys **priority**, never a guaranteed read or reply.

## Why this version

No Gmail OAuth. No sender credits. No giant dashboard. No autonomous classifier.

ChatGPT is the intelligence layer. Gmail/Outlook remain the mailbox. Inbox Goalie is the gate + payment rail.

## MCP tools

- `setup_receiver` — set receiver email and default price
- `connect_payouts` — create/reuse a Stripe Express connected account and return onboarding URL
- `create_goalie_request` — create a unique Goalie request and return the exact reply text + payment URL
- `get_goalie_status` — check whether a sender paid
- `list_goalie_requests` — inspect recent requests

## Local setup

```bash
cp .env.example .env
npm install
psql "$DATABASE_URL" -f sql/schema.sql
npm run dev
```

Health: `GET /health`

MCP: `POST /mcp`

## Stripe

Create a Stripe account with Connect enabled.

Set:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PLATFORM_FEE_BPS=3000
```

`PLATFORM_FEE_BPS=3000` means Inbox Goalie keeps 30% of the priority price before Stripe's applicable fees/Connect economics.

Forward Stripe events locally:

```bash
stripe listen --forward-to localhost:3000/stripe/webhook
```

The webhook handles `checkout.session.completed` and marks the Goalie request paid.

## Connect to ChatGPT

Deploy this server to a public HTTPS URL. Then add the MCP endpoint:

```text
https://YOUR-DOMAIN/mcp
```

OpenAI's plugin system uses MCP servers as the server-backed capability layer. This repo is intentionally tool-first with no custom ChatGPT UI yet.

Suggested first conversation:

```text
Set up Inbox Goalie for me at $10 per priority request.
```

Then:

```text
Goalie this email and give me the reply.
```

When a Gmail/Outlook connector is available in the same ChatGPT conversation, the model can combine the mailbox context with the Inbox Goalie tools. Sending the email remains a separate email action and should require the user's authorization.

## Receiver economics

With a $10 Goalie fee and 30% platform fee:

```text
Sender pays:          $10.00
Inbox Goalie fee:      $3.00
Receiver allocation:   $7.00
```

Stripe fees and Connect pricing still apply according to your Stripe account and country.

## Data model

Only the minimum transaction metadata is stored:

- receiver email/config
- Stripe connected account ID
- sender email/name
- message subject/reference ID if supplied
- request token
- amount/status
- Stripe session/payment IDs

The repo does **not** copy or store mailbox bodies.

## Next layer, only after validation

If people actually install this and senders actually pay:

- sender accounts
- prepaid Goalie Credits
- domain verification
- agency wallets
- receiver earnings dashboard
- sender reputation graph
- automatic Goalie policies
- lower-cost micro-priority fees

Do not build those until the core behavior is proven.

## License

MIT

## Plugin package

This repository also contains the current OpenAI plugin package structure:

```text
.codex-plugin/plugin.json
skills/inbox-goalie/SKILL.md
.app.json.template
```

After the MCP server is deployed, register its `/mcp` URL in ChatGPT developer mode. ChatGPT will assign a `plugin_asdk_app...` technical ID. Copy `.app.json.template` to `.app.json`, replace the placeholder with that ID, and add `"apps": "./.app.json"` to `.codex-plugin/plugin.json` before packaging/publishing the complete plugin.
