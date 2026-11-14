# Changelog

## 0.1.1 (2026-11-13)

- First release: an email channel for OpenClaw.
- `openclaw channels add --channel groundmail` creates an address with no account, or uses your mailbox with a key that reaches only that mailbox.
- Mail from people wakes the agent and its answer goes back in the same thread. Sign-up codes and other automated mail reach the agent in its main chat. Modes: `channel`, `notify` and `tool`.
- Only mail that passed DMARC gets a reply. The agent sees the visible text, fenced off as written by an outsider, with the code, links and a prompt-injection warning pulled out.
- When a reply is refused (an address made with no account can't send until you confirm your email), the agent is told in its main chat with the reason and the steps, so it can ask you instead of the reply vanishing.
- `openclaw groundmail -- …` runs the Groundmail CLI with the channel's key, and a bundled skill teaches the agent to read threads, wait for codes and send.
