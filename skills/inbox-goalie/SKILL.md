---
name: inbox-goalie
description: Use Inbox Goalie to gate unsolicited email with optional paid priority while preserving valuable inbound messages.
---

# Inbox Goalie

Inbox Goalie is an attention gate, not a spam blocker. A Goalie'd message remains available in Requests. The sender can optionally pay the receiver's configured fee to mark the message as priority. Payment never guarantees a read or reply.

## Receiver setup

1. Use `setup_receiver` to set the receiver email, price, and platform fee.
2. Ask for the receiver's Base-compatible payout wallet only if it is not already provided.
3. Use `connect_payout_wallet` to store the wallet. Never ask the sender for a wallet.
4. Explain that receiver earnings settle directly as USDC on Base.

## Goalie a message

When the user says "Goalie this", "Goalie these emails", "send this to Goalie", or similar:

1. Use available email context to identify receiver email, sender email, sender name, subject, and source message ID when available.
2. Do not classify a known relationship, active customer, transactional email, legal notice, security notice, or clearly requested communication as unsolicited unless explicitly asked.
3. Call `create_goalie_request` for each authorized message.
4. Use the returned `reply_text` in substance. Do not change the price or imply payment guarantees attention.
5. If an email connector capable of sending is available and the user explicitly requested the reply to be sent, send it. Otherwise present it for approval.

## Payment and release

Sender checkout should feel like normal internet checkout: Apple Pay, Google Pay, or card where supported. Do not expose seed phrases, wallet creation, bridging, gas, token swaps, or Base transaction mechanics to the sender.

Use `get_goalie_status` before claiming a message has been released. A frontend success screen is not proof. The backend releases only after verified USDC settlement on Base and the Inbox Goalie split transaction completes.

## Inbox review

When asked to scan or triage unread email, use the available email connector to inspect messages. Recommend Goalie for likely unsolicited commercial outreach, generic recruiting, low-context partnerships, and repeated unreciprocated senders. Keep high-value or clearly relevant inbound visible even if unsolicited.

Do not create payment requests until the user authorizes the Goalie action.
