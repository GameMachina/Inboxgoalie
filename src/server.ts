import crypto from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { query } from "./db.js";
import { stripe, platformFee } from "./stripe.js";
import type { Receiver, GoalieRequest } from "./types.js";

const port = Number(process.env.PORT ?? 3000);
const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:${port}`;

const app = express();

app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(400).send("Missing webhook signature/config");

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const requestId = session.metadata?.goalie_request_id;
      if (requestId) {
        await query(
          `UPDATE goalie_requests
           SET status='paid', stripe_payment_intent_id=$2, paid_at=now()
           WHERE id=$1`,
          [requestId, typeof session.payment_intent === "string" ? session.payment_intent : null]
        );
      }
    }
    res.json({ received: true });
  } catch (error: any) {
    res.status(400).send(`Webhook error: ${error.message}`);
  }
});

app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "inbox-goalie" }));

app.get("/g/:token", async (req, res) => {
  const result = await query<GoalieRequest & { receiver_email: string; receiver_name: string | null; stripe_account_id: string | null }>(
    `SELECT g.*, r.email AS receiver_email, r.display_name AS receiver_name, r.stripe_account_id
     FROM goalie_requests g JOIN receivers r ON r.id=g.receiver_id
     WHERE g.token=$1`,
    [req.params.token]
  );
  const item = result.rows[0];
  if (!item) return res.status(404).send("Goalie request not found");
  if (item.status === "paid") return res.send(page("Shot accepted", "This priority request has already been paid."));

  const label = `${(item.amount_cents / 100).toFixed(2)} ${item.currency.toUpperCase()}`;
  const name = item.receiver_name || item.receiver_email;
  res.send(page(
    "🥅 Inbox Goalie",
    `<p>Your email to <strong>${escapeHtml(name)}</strong> is still available in Requests.</p>
     <p>Pay <strong>${label}</strong> to mark it as priority.</p>
     <form method="POST" action="/g/${encodeURIComponent(item.token)}/checkout">
       <button type="submit">Take another shot · ${label}</button>
     </form>
     <p class="fine">Priority does not guarantee a read or reply.</p>`
  ));
});

app.post("/g/:token/checkout", async (req, res) => {
  const result = await query<GoalieRequest & { stripe_account_id: string | null }>(
    `SELECT g.*, r.stripe_account_id
     FROM goalie_requests g JOIN receivers r ON r.id=g.receiver_id
     WHERE g.token=$1`,
    [req.params.token]
  );
  const item = result.rows[0];
  if (!item) return res.status(404).send("Goalie request not found");
  if (!item.stripe_account_id) return res.status(400).send("Receiver payouts are not connected");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      price_data: {
        currency: item.currency,
        unit_amount: item.amount_cents,
        product_data: { name: "Inbox Goalie Priority" },
      },
      quantity: 1,
    }],
    success_url: `${baseUrl}/g/${item.token}?paid=1`,
    cancel_url: `${baseUrl}/g/${item.token}`,
    metadata: { goalie_request_id: item.id },
    payment_intent_data: {
      application_fee_amount: platformFee(item.amount_cents),
      transfer_data: { destination: item.stripe_account_id },
    },
  });

  await query(`UPDATE goalie_requests SET stripe_checkout_session_id=$2 WHERE id=$1`, [item.id, session.id]);
  if (!session.url) return res.status(500).send("Stripe checkout URL missing");
  res.redirect(303, session.url);
});

function createMcpServer() {
  const mcp = new McpServer({ name: "inbox-goalie", version: "0.1.0" });

  mcp.registerTool(
    "setup_receiver",
    {
      title: "Set up Inbox Goalie receiver",
      description: "Create or update a receiver profile and default priority price.",
      inputSchema: {
        email: z.string().email(),
        display_name: z.string().max(120).optional(),
        price_cents: z.number().int().min(100).max(100000).default(1000),
        currency: z.string().length(3).default("usd"),
      },
    },
    async ({ email, display_name, price_cents, currency }) => {
      const r = await query<Receiver>(
        `INSERT INTO receivers(email, display_name, price_cents, currency)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name, price_cents=EXCLUDED.price_cents, currency=EXCLUDED.currency, updated_at=now()
         RETURNING *`,
        [email.toLowerCase(), display_name ?? null, price_cents, currency.toLowerCase()]
      );
      return result({ receiver: r.rows[0] }, `Inbox Goalie is set to ${(price_cents / 100).toFixed(2)} ${currency.toUpperCase()} per priority request.`);
    }
  );

  mcp.registerTool(
    "connect_payouts",
    {
      title: "Connect receiver payouts",
      description: "Create or reuse a Stripe Express connected account and return the onboarding URL.",
      inputSchema: { receiver_email: z.string().email() },
    },
    async ({ receiver_email }) => {
      const r = await query<Receiver>(`SELECT * FROM receivers WHERE email=$1`, [receiver_email.toLowerCase()]);
      const receiver = r.rows[0];
      if (!receiver) return errorResult("Receiver not found. Run setup_receiver first.");

      let accountId = receiver.stripe_account_id;
      if (!accountId) {
        const account = await stripe.accounts.create({ type: "express", email: receiver.email });
        accountId = account.id;
        await query(`UPDATE receivers SET stripe_account_id=$2, updated_at=now() WHERE id=$1`, [receiver.id, accountId]);
      }

      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${baseUrl}/stripe/refresh`,
        return_url: `${baseUrl}/stripe/return`,
        type: "account_onboarding",
      });
      return result({ onboarding_url: link.url }, "Open the Stripe onboarding link to connect payouts.");
    }
  );

  mcp.registerTool(
    "create_goalie_request",
    {
      title: "Goalie an email",
      description: "Create a paid-priority request for an unsolicited sender and return the exact Goalie reply and payment link.",
      inputSchema: {
        receiver_email: z.string().email(),
        sender_email: z.string().email(),
        sender_name: z.string().max(120).optional(),
        subject: z.string().max(500).optional(),
        source_message_id: z.string().max(500).optional(),
        price_cents: z.number().int().min(100).max(100000).optional(),
      },
    },
    async ({ receiver_email, sender_email, sender_name, subject, source_message_id, price_cents }) => {
      const r = await query<Receiver>(`SELECT * FROM receivers WHERE email=$1`, [receiver_email.toLowerCase()]);
      const receiver = r.rows[0];
      if (!receiver) return errorResult("Receiver not found. Run setup_receiver first.");
      if (!receiver.stripe_account_id) return errorResult("Receiver payouts are not connected. Run connect_payouts first.");

      const amount = price_cents ?? receiver.price_cents;
      const token = crypto.randomBytes(18).toString("base64url");
      const created = await query<GoalieRequest>(
        `INSERT INTO goalie_requests(token, receiver_id, sender_email, sender_name, subject, source_message_id, amount_cents, currency)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [token, receiver.id, sender_email.toLowerCase(), sender_name ?? null, subject ?? null, source_message_id ?? null, amount, receiver.currency]
      );
      const request = created.rows[0];
      const paymentUrl = `${baseUrl}/g/${token}`;
      const receiverLabel = receiver.display_name || receiver.email;
      const priceLabel = `${(amount / 100).toFixed(2)} ${receiver.currency.toUpperCase()}`;
      const replyText = `🥅 Blocked by Inbox Goalie.\n\n${receiverLabel} uses Inbox Goalie to manage unsolicited email. Your message is still available in Requests.\n\nIf you want to mark it as priority, take another shot for ${priceLabel}:\n${paymentUrl}\n\nPriority does not guarantee a read or reply.`;

      return result(
        { request_id: request.id, payment_url: paymentUrl, amount_cents: amount, currency: receiver.currency, reply_text: replyText },
        replyText
      );
    }
  );

  mcp.registerTool(
    "get_goalie_status",
    {
      title: "Check Goalie payment status",
      description: "Check whether a specific Inbox Goalie priority request has been paid.",
      inputSchema: { request_id: z.string().uuid() },
    },
    async ({ request_id }) => {
      const r = await query<GoalieRequest>(`SELECT * FROM goalie_requests WHERE id=$1`, [request_id]);
      const request = r.rows[0];
      if (!request) return errorResult("Goalie request not found.");
      return result({ status: request.status, paid_at: request.paid_at, sender_email: request.sender_email }, `Goalie request is ${request.status}.`);
    }
  );

  mcp.registerTool(
    "list_goalie_requests",
    {
      title: "List recent Goalie requests",
      description: "List a receiver's recent Inbox Goalie requests and payment statuses.",
      inputSchema: {
        receiver_email: z.string().email(),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ receiver_email, limit }) => {
      const r = await query<GoalieRequest>(
        `SELECT g.* FROM goalie_requests g JOIN receivers r ON r.id=g.receiver_id
         WHERE r.email=$1 ORDER BY g.created_at DESC LIMIT $2`,
        [receiver_email.toLowerCase(), limit]
      );
      return result({ requests: r.rows }, `${r.rows.length} recent Goalie requests.`);
    }
  );

  return mcp;
}

app.options("/mcp", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.status(204).end();
});

app.all("/mcp", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  const mcp = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    mcp.close();
  });

  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) res.status(500).send("Internal server error");
  }
});

app.listen(port, () => {
  console.log(`Inbox Goalie listening on ${baseUrl}`);
  console.log(`MCP endpoint: ${baseUrl}/mcp`);
});

function result(structuredContent: Record<string, unknown>, text: string) {
  return {
    structuredContent,
    content: [{ type: "text" as const, text }],
  };
}

function errorResult(text: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text }],
  };
}

function escapeHtml(input: string) {
  return input.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]!));
}

function page(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:620px;margin:80px auto;padding:0 24px;color:#111;line-height:1.5}h1{font-size:40px;margin-bottom:24px}button{font:inherit;font-weight:700;padding:14px 18px;border:0;border-radius:10px;background:#111;color:#fff;cursor:pointer}.fine{font-size:13px;color:#666;margin-top:18px}
  </style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}
