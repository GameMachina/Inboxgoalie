import crypto from "node:crypto";
import express from "express";
import { isAddress } from "viem";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { query } from "./db.js";
import { paymentProvider } from "./payments/index.js";
import type { PaymentMethod } from "./payments/provider.js";
import { platformFeeUsdc, settlePayment, verifyUsdcDeposit } from "./payments/settlement.js";
import type { Receiver, GoalieRequest } from "./types.js";

const port = Number(process.env.PORT ?? 3000);
const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:${port}`;
const app = express();

app.post("/coinbase/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const raw = req.body.toString();
  const signature = String(req.headers["x-hook0-signature"] ?? "");
  if (!verifyHook0(raw, signature, process.env.COINBASE_WEBHOOK_SECRET ?? "")) return res.status(400).send("Invalid Coinbase webhook signature");
  try {
    const event = JSON.parse(raw);
    const flattened = JSON.stringify(event);
    const providerId = event?.data?.order?.orderId ?? event?.data?.orderId ?? event?.data?.id;
    const txHash = event?.data?.order?.txHash ?? event?.data?.txHash ?? event?.data?.transactionHash;
    const status = String(event?.data?.order?.status ?? event?.data?.status ?? "");
    const partnerRef = event?.data?.order?.partnerOrderRef ?? event?.data?.partnerOrderRef ?? event?.data?.partnerUserRef;
    let payment = providerId ? (await query<any>(`SELECT p.*, g.receiver_id FROM payments p JOIN goalie_requests g ON g.id=p.goalie_request_id WHERE p.provider_payment_id=$1`, [providerId])).rows[0] : undefined;
    if (!payment && partnerRef) {
      const requestId = String(partnerRef).replace(/^sandbox-/, "");
      payment = (await query<any>(`SELECT p.*, g.receiver_id FROM payments p JOIN goalie_requests g ON g.id=p.goalie_request_id WHERE p.goalie_request_id=$1`, [requestId])).rows[0];
    }
    if (payment) {
      await query(`UPDATE payments SET provider_payload=$2::jsonb, provider_payment_id=COALESCE(provider_payment_id,$3), updated_at=now() WHERE id=$1`, [payment.id, flattened, providerId ?? null]);
      if ((status.includes("COMPLETED") || txHash) && txHash) await finalizePayment(payment.goalie_request_id, txHash);
    }
    res.json({ received: true });
  } catch (e: any) { res.status(500).send(e.message); }
});

app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true, service: "inbox-goalie", payments: process.env.PAYMENT_PROVIDER ?? "coinbase", chainId: Number(process.env.BASE_CHAIN_ID ?? 84532) }));

app.get("/g/:token", async (req, res) => {
  const r = await query<any>(`SELECT g.*, r.email receiver_email, r.display_name receiver_name, r.payout_wallet_address, r.platform_fee_bps FROM goalie_requests g JOIN receivers r ON r.id=g.receiver_id WHERE g.token=$1`, [req.params.token]);
  const item = r.rows[0];
  if (!item) return res.status(404).send("Goalie request not found");
  if (["paid","released"].includes(item.status)) return res.send(page("🥅 Shot accepted", `<p>This message has been paid and released to priority.</p>`));
  const name = item.receiver_name || item.receiver_email;
  res.send(page("🥅 Inbox Goalie", `<p><strong>${escapeHtml(name)}</strong> charges <strong>$${Number(item.amount_usdc).toFixed(2)}</strong> to receive unsolicited messages.</p><p>Payment settles as USDC on Base. No crypto wallet is required for the sender.</p>${payForm(item.token,"apple_pay","Pay with Apple Pay")}${payForm(item.token,"google_pay","Pay with Google Pay")}${payForm(item.token,"card","Pay with Card")}<p class="fine">Priority does not guarantee a read or reply.</p>`));
});

app.post("/g/:token/pay/:method", async (req, res) => {
  const method = req.params.method as PaymentMethod;
  if (!["apple_pay","google_pay","card"].includes(method)) return res.status(400).send("Unsupported payment method");
  const r = await query<any>(`SELECT g.*, r.payout_wallet_address, r.platform_fee_bps FROM goalie_requests g JOIN receivers r ON r.id=g.receiver_id WHERE g.token=$1`, [req.params.token]);
  const item = r.rows[0];
  if (!item?.payout_wallet_address) return res.status(400).send("Receiver payout wallet is not connected");
  const destination = process.env.INBOX_GOALIE_PAYMENT_CONTRACT_ADDRESS as `0x${string}`;
  if (!isAddress(destination)) return res.status(500).send("Payment contract is not configured");
  const provider = paymentProvider();
  const created = await provider.createPayment({ goalieRequestId: item.id, senderEmail: item.sender_email, amountUsdc: String(item.amount_usdc), destinationAddress: destination, method, clientIp: req.ip });
  const fee = platformFeeUsdc(String(item.amount_usdc), item.platform_fee_bps);
  await query(`INSERT INTO payments(goalie_request_id,provider,provider_payment_id,sender_email,receiver_wallet,amount_usdc,platform_fee_usdc,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(goalie_request_id) DO UPDATE SET provider=EXCLUDED.provider,provider_payment_id=EXCLUDED.provider_payment_id,status=EXCLUDED.status,updated_at=now()`, [item.id, created.provider, created.providerPaymentId ?? null, item.sender_email, item.payout_wallet_address, item.amount_usdc, fee, created.status]);
  await query(`UPDATE goalie_requests SET status='payment_pending' WHERE id=$1 AND status='pending'`, [item.id]);
  res.redirect(303, created.checkoutUrl);
});

app.post("/payments/verify/:requestId", async (req, res) => {
  const txHash = String(req.body?.transaction_hash ?? "") as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return res.status(400).json({ error: "Valid transaction_hash required" });
  try { await finalizePayment(req.params.requestId, txHash); res.json({ verified: true, status: "released" }); }
  catch (e: any) { res.status(400).json({ verified: false, error: e.message }); }
});

app.get("/payments/return/:requestId", (_req, res) => res.send(page("Payment submitted", `<p>Payment is being independently verified on Base. The message is not released until settlement is confirmed.</p>`)));

async function finalizePayment(requestId: string, txHash: string) {
  const r = await query<any>(`SELECT g.*, r.payout_wallet_address, r.platform_fee_bps FROM goalie_requests g JOIN receivers r ON r.id=g.receiver_id WHERE g.id=$1`, [requestId]);
  const item = r.rows[0];
  if (!item?.payout_wallet_address) throw new Error("Receiver wallet missing");
  if (["paid","released"].includes(item.status)) return;
  const verified = await verifyUsdcDeposit(txHash as `0x${string}`, String(item.amount_usdc));
  if (!verified) throw new Error("No matching USDC transfer to Inbox Goalie contract found on Base");
  await query(`UPDATE payments SET transaction_hash=$2,status='verified',verified_at=now(),updated_at=now() WHERE goalie_request_id=$1`, [requestId, txHash]);
  const settlementHash = await settlePayment(requestId, item.payout_wallet_address, String(item.amount_usdc), item.platform_fee_bps);
  await query(`UPDATE payments SET settlement_transaction_hash=$2,status='settled',settled_at=now(),updated_at=now() WHERE goalie_request_id=$1`, [requestId, settlementHash]);
  await query(`UPDATE goalie_requests SET status='released',paid_at=COALESCE(paid_at,now()),released_at=now() WHERE id=$1`, [requestId]);
}

function createMcpServer() {
  const mcp = new McpServer({ name: "inbox-goalie", version: "0.2.0" });
  mcp.registerTool("setup_receiver", { title: "Set up Inbox Goalie receiver", description: "Set receiver email, Base payout wallet, message price and platform fee.", inputSchema: { email: z.string().email(), display_name: z.string().max(120).optional(), payout_wallet_address: z.string().optional(), price_usdc: z.number().min(1).max(100000).default(10), platform_fee_bps: z.number().int().min(0).max(10000).default(Number(process.env.PLATFORM_FEE_BPS ?? 2000)) } }, async ({ email, display_name, payout_wallet_address, price_usdc, platform_fee_bps }) => {
    if (payout_wallet_address && !isAddress(payout_wallet_address)) return errorResult("Invalid Base-compatible wallet address.");
    const r = await query<Receiver>(`INSERT INTO receivers(email,display_name,payout_wallet_address,payout_chain,message_price_usdc,platform_fee_bps) VALUES($1,$2,$3,'base',$4,$5) ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name,payout_wallet_address=COALESCE(EXCLUDED.payout_wallet_address,receivers.payout_wallet_address),message_price_usdc=EXCLUDED.message_price_usdc,platform_fee_bps=EXCLUDED.platform_fee_bps,updated_at=now() RETURNING *`, [email.toLowerCase(), display_name ?? null, payout_wallet_address ?? null, price_usdc.toFixed(6), platform_fee_bps]);
    return result({ receiver: r.rows[0], estimated_receiver_share_usdc: (price_usdc * (10000-platform_fee_bps)/10000).toFixed(2) }, `Inbox Goalie is set to $${price_usdc.toFixed(2)} with ${(platform_fee_bps/100).toFixed(2)}% platform fee.`);
  });
  mcp.registerTool("connect_payout_wallet", { title: "Connect Base payout wallet", description: "Store the receiver's Base-compatible USDC payout address.", inputSchema: { receiver_email: z.string().email(), wallet_address: z.string() } }, async ({ receiver_email, wallet_address }) => {
    if (!isAddress(wallet_address)) return errorResult("Invalid EVM/Base wallet address.");
    const r = await query<Receiver>(`UPDATE receivers SET payout_wallet_address=$2,payout_chain='base',updated_at=now() WHERE email=$1 RETURNING *`, [receiver_email.toLowerCase(), wallet_address]);
    if (!r.rows[0]) return errorResult("Receiver not found. Run setup_receiver first.");
    return result({ wallet_address, chain: "base" }, "Base payout wallet connected.");
  });
  mcp.registerTool("create_goalie_request", { title: "Goalie an email", description: "Create a paid-priority request and sender checkout link.", inputSchema: { receiver_email: z.string().email(), sender_email: z.string().email(), sender_name: z.string().max(120).optional(), subject: z.string().max(500).optional(), source_message_id: z.string().max(500).optional(), price_usdc: z.number().min(1).optional() } }, async ({ receiver_email, sender_email, sender_name, subject, source_message_id, price_usdc }) => {
    const rr = await query<Receiver>(`SELECT * FROM receivers WHERE email=$1`, [receiver_email.toLowerCase()]); const receiver = rr.rows[0];
    if (!receiver) return errorResult("Receiver not found. Run setup_receiver first."); if (!receiver.payout_wallet_address) return errorResult("Connect a Base payout wallet first.");
    const amount = (price_usdc ?? Number(receiver.message_price_usdc)).toFixed(6); const token = crypto.randomBytes(18).toString("base64url");
    const c = await query<GoalieRequest>(`INSERT INTO goalie_requests(token,receiver_id,sender_email,sender_name,subject,source_message_id,amount_cents,currency,amount_usdc,chain,status) VALUES($1,$2,$3,$4,$5,$6,$7,'USDC',$8,'base','pending') RETURNING *`, [token, receiver.id, sender_email.toLowerCase(), sender_name ?? null, subject ?? null, source_message_id ?? null, Math.round(Number(amount)*100), amount]);
    const paymentUrl = `${baseUrl}/g/${token}`; const label = receiver.display_name || receiver.email;
    const replyText = `🥅 Blocked by Inbox Goalie.\n\n${label} uses Inbox Goalie to manage unsolicited email. Your message is still available in Requests.\n\nPriority access is $${Number(amount).toFixed(2)} and settles on Base:\n${paymentUrl}\n\nNo crypto wallet is required. Priority does not guarantee a read or reply.`;
    return result({ request_id: c.rows[0].id, payment_url: paymentUrl, amount_usdc: amount, chain: "base", reply_text: replyText }, replyText);
  });
  mcp.registerTool("get_goalie_status", { title: "Check Goalie payment status", description: "Check payment verification and message release status.", inputSchema: { request_id: z.string().uuid() } }, async ({ request_id }) => { const r = await query<any>(`SELECT g.status,g.paid_at,g.released_at,p.transaction_hash,p.settlement_transaction_hash,p.status payment_status FROM goalie_requests g LEFT JOIN payments p ON p.goalie_request_id=g.id WHERE g.id=$1`, [request_id]); return r.rows[0] ? result(r.rows[0], `Goalie request is ${r.rows[0].status}.`) : errorResult("Goalie request not found."); });
  mcp.registerTool("list_goalie_requests", { title: "List recent Goalie requests", description: "List recent requests and Base payment statuses.", inputSchema: { receiver_email: z.string().email(), limit: z.number().int().min(1).max(50).default(20) } }, async ({ receiver_email, limit }) => { const r=await query<any>(`SELECT g.*,p.transaction_hash,p.settlement_transaction_hash,p.status payment_status FROM goalie_requests g JOIN receivers r ON r.id=g.receiver_id LEFT JOIN payments p ON p.goalie_request_id=g.id WHERE r.email=$1 ORDER BY g.created_at DESC LIMIT $2`,[receiver_email.toLowerCase(),limit]); return result({requests:r.rows},`${r.rows.length} recent Goalie requests.`); });
  return mcp;
}

app.options("/mcp", (_req,res)=>{res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","POST, GET, DELETE, OPTIONS");res.setHeader("Access-Control-Allow-Headers","content-type, mcp-session-id");res.setHeader("Access-Control-Expose-Headers","Mcp-Session-Id");res.status(204).end();});
app.all("/mcp", async (req,res)=>{res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Expose-Headers","Mcp-Session-Id");const mcp=createMcpServer();const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});res.on("close",()=>{transport.close();mcp.close();});try{await mcp.connect(transport);await transport.handleRequest(req,res,req.body);}catch(e){console.error(e);if(!res.headersSent)res.status(500).send("Internal server error");}});
app.listen(port,()=>console.log(`Inbox Goalie listening on ${baseUrl}`));

function verifyHook0(body:string, header:string, secret:string){try{if(!header||!secret)return false;const parts=Object.fromEntries(header.split(",").map((p)=>{const i=p.indexOf("=");return [p.slice(0,i),p.slice(i+1)];}));const t=parts.t,v0=parts.v0;if(!t||!v0||Math.abs(Date.now()/1000-Number(t))>300)return false;const expected=crypto.createHmac("sha256",secret).update(`${t}.${body}`).digest("hex");return crypto.timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(v0,"hex"));}catch{return false;}}
function payForm(token:string,method:string,label:string){return `<form method="POST" action="/g/${encodeURIComponent(token)}/pay/${method}"><button type="submit">${escapeHtml(label)}</button></form>`;}
function result(structuredContent:Record<string,unknown>,text:string){return {structuredContent,content:[{type:"text" as const,text}]};}
function errorResult(text:string){return {isError:true,content:[{type:"text" as const,text}]};}
function escapeHtml(input:string){return input.replace(/[&<>'\"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[c]!));}
function page(title:string,body:string){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:620px;margin:80px auto;padding:0 24px;color:#111;line-height:1.5}h1{font-size:40px}form{margin:10px 0}button{width:100%;font:inherit;font-weight:700;padding:14px 18px;border:0;border-radius:10px;background:#111;color:#fff;cursor:pointer}.fine{font-size:13px;color:#666}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;}
