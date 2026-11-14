# Changelog

## 0.1.7 (2026-11-14)

- README: "Why Groundmail" now covers agent mailboxes and how each kind of mail sends from its own IPs.

## 0.1.6 (2026-11-14)

- The package description now says what the plugin is: an agent mailbox, your agent's own email inbox.

## 0.1.5 (2026-11-14)

- Only allowed senders start a conversation with the agent. New settings `dmPolicy` (`allowlist` by default, `open` or `disabled`) and `allowFrom` (addresses or `@domain`). `--owner-email` adds you automatically; add others with `--allow-from`. Mail from anyone else still reaches the main chat as the short note, so sign-up codes keep working.
- **Upgrading:** with no `allowFrom` set, the agent stops answering email from people. Run `openclaw channels add --channel groundmail --allow-from you@example.com` to let yourself back in.

## 0.1.4 (2026-11-14)

- When a reply can't be sent, the note in the agent's main chat is now fixed wording too: that the reply wasn't sent, why (can't send yet, or sending limit), and how to fix it. The reply the agent drafted stays out of the main session, since it was written in answer to an outside email.

## 0.1.3 (2026-11-13)

- Notes in the agent's main chat are now fixed wording: that a new email arrived, the one-time code if there is one (digits only), and how to read it. Nothing the sender wrote, not even the subject or their address, reaches the main session. The "reply not sent" note no longer names the sender either.

## 0.1.2 (2026-11-13)

- Automated mail (sign-up codes, notifications) now reaches the agent's main chat as a short note: the sender's address, a one-line subject and the code. The body, links and display name stay out of the main session, where the agent has its full context and tools; the agent can read the full email with `openclaw groundmail -- mailboxes read` when you ask.

## 0.1.1 (2026-11-13)

- First release: an email channel for OpenClaw.
- `openclaw channels add --channel groundmail` creates an address with no account, or uses your mailbox with a key that reaches only that mailbox.
- Mail from people wakes the agent and its answer goes back in the same thread. Sign-up codes and other automated mail reach the agent in its main chat. Modes: `channel`, `notify` and `tool`.
- Only mail that passed DMARC gets a reply. The agent sees the visible text, fenced off as written by an outsider, with the code, links and a prompt-injection warning pulled out.
- When a reply is refused (an address made with no account can't send until you confirm your email), the agent is told in its main chat with the reason and the steps, so it can ask you instead of the reply vanishing.
- `openclaw groundmail -- …` runs the Groundmail CLI with the channel's key, and a bundled skill teaches the agent to read threads, wait for codes and send.
