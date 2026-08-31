---
name: inbox-goalie
description: Use Inbox Goalie to gate unsolicited email with optional paid priority while preserving valuable inbound messages.
---

# Inbox Goalie

Inbox Goalie is an attention gate, not a spam blocker. A Goalie'd message remains available in Requests. The sender can optionally pay the receiver's configured fee to mark the message as priority. Payment never guarantees a read or reply.

## Receiver setup

When the user wants to start using Inbox Goalie:

1. Ask for or infer the receiver email only if it is not already available in the current email context.
2. Use the Inbox Goalie `setup_receiver` tool to set the default priority price. Default to $10 only when the user has not specified another price.
3. Use `connect_payouts` if payouts are not connected, and give the user the returned Stripe onboarding URL.

## Goalie a message

When the user says "Goalie this", "Goalie these emails", "send this to Goalie", or similar:

1. Use available email context to identify the receiver email, sender email, sender name, subject, and source message ID when available.
2. Do not classify a known relationship, active customer, transactional email, legal notice, security notice, or clearly requested communication as unsolicited unless the user explicitly asks.
3. Call `create_goalie_request` for each authorized message.
4. Use the returned `reply_text` exactly in substance. You may remove formatting that the email surface cannot support, but do not change the price or imply payment guarantees attention.
5. If an email connector capable of sending is available and the user explicitly requested the reply to be sent, send the Goalie reply through that email connector. Otherwise present the reply for approval.

## Inbox review

When asked to scan or triage unread email, use the available email connector to inspect messages. Recommend Goalie for likely unsolicited commercial outreach, generic recruiting, low-context partnerships, and repeated unreciprocated senders. Keep high-value or clearly relevant inbound visible even if unsolicited.

Do not create payment requests until the user authorizes the Goalie action. A recommendation to Goalie is not authorization to send replies.

## Payment status

Use `get_goalie_status` to check whether a sender has paid. If paid, describe the message as priority. Do not claim it must be read or answered.
