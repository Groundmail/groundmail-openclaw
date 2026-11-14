<p align="center">
  <a href="https://groundmail.dev?utm_source=github&utm_medium=readme&utm_campaign=groundmail-openclaw">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://app.groundmail.dev/images/github/readme-logo-dark.png">
      <img alt="Groundmail" src="https://app.groundmail.dev/images/github/readme-logo-light.png" height="44">
    </picture>
  </a>
</p>


<h1 align="center">Groundmail for OpenClaw</h1>

<p align="center">
  An email channel for <a href="https://openclaw.ai">OpenClaw</a>. Your agent gets its own email address:<br>
  people email it and it answers in the same thread, and sign-up codes reach it on their own.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@groundmail/openclaw"><img alt="npm" src="https://img.shields.io/npm/v/@groundmail/openclaw?color=a3461f&label=npm"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-b48f62"></a>
</p>

<p align="center">
  <a href="https://docs.groundmail.dev/ai/openclaw?utm_source=github&utm_medium=readme&utm_campaign=groundmail-openclaw">Docs</a> ·
  <a href="https://app.groundmail.dev/signup?utm_source=github&utm_medium=readme&utm_campaign=groundmail-openclaw">Get a free account</a> ·
  <a href="https://groundmail.dev?utm_source=github&utm_medium=readme&utm_campaign=groundmail-openclaw">groundmail.dev</a>
</p>

---

## Install

```bash
openclaw plugins install @groundmail/openclaw
openclaw channels add --channel groundmail --owner-email you@example.com
openclaw gateway restart
```

That's all: with no key, `channels add` creates an address for your agent with no account, such as `bot-7f2k@agents.groundmailbox.com`. Email it from your address and the agent answers.

`--owner-email` lets the agent send as well as receive: you get a code, and once you give it to the agent it can email anyone. It also adds you to the allowed senders. To give the address a name, add `--local-part sales`.

Already have a Groundmail account? Pass `--api-key gm_…`. OpenClaw uses your mailbox (or creates one) and stores a new key that reaches only that mailbox. Your account key is never written to the config.

## What reaches the agent

| Mode | Mail from people | Automated mail (sign-up codes, notifications) |
|------|------------------|-----------------------------------------------|
| `channel` (default) | Wakes the agent; its answer goes back in the same thread | A short note in its main chat with the code; no reply |
| `notify` | A short note in its main chat to tell you about; no reply | Same |
| `tool` | Nothing arrives on its own | Nothing arrives on its own |

Change it with `openclaw channels add --channel groundmail --mode notify`.

Only allowed senders start a conversation with the agent; everyone else's mail arrives as the short note in its main chat. Add people or whole domains with `--allow-from a@x.com,@yourcompany.com`. Set `dmPolicy` to `open` (with `"*"` in `allowFrom`) to let anyone in, or `disabled` to let nobody in.

The agent only answers mail that passed DMARC, so a forged sender never gets a reply. Held spam never reaches it.

## Every email is untrusted

Anyone who knows the address can email it, but only allowed senders reach the agent. The plugin hands the agent only what a person would see (hidden text removed), fenced off and labelled as written by an outsider. The one-time code and links are pulled out for it, and mail that looks like it's trying to give the agent instructions comes with a warning. Notes in the agent's main chat, where it has its full context and tools, say only that an email arrived, with the code if there is one: nothing the sender wrote.

## More than replies

The plugin ships a skill and a command that runs the [Groundmail CLI](https://www.npmjs.com/package/groundmail-cli) with the channel's key, so the agent never sees it:

```bash
openclaw groundmail -- mailboxes wait <address> --since <time> --json    # wait for a sign-up code
openclaw groundmail -- mailboxes read <address> thd_… --json             # read a thread
openclaw groundmail -- mailboxes send <address> --to … --subject … --text …
```

An address on the shared agent domain can reply but not email people first. For that, use a mailbox on your own domain.

## Configuration

```json5
{
  channels: {
    groundmail: {
      apiKey: { source: "env", provider: "default", id: "GROUNDMAIL_API_KEY" }, // or a literal key
      mailbox: "sales@agents.example.com",
      mode: "channel",
    },
  },
}
```

Several agents? Add accounts under `channels.groundmail.accounts.<id>`, each with its own mailbox and key.

No webhook or open port is needed: the gateway holds a long poll to Groundmail, so it works on a laptop or behind NAT.

## Why Groundmail

- **Our own mail servers and IP space.** Your password resets and receipts don't share a pool with bulk marketing senders.
- **Transactional email only.** No newsletters or cold outreach on the platform, which keeps the sending reputation clean.
- **Start free.** Free covers 3,000 emails a month. After that, pay as you go is $15 a month with 20,000 emails included, then from $0.70 per 1,000, less as you grow. [Pricing](https://groundmail.dev/pricing/?utm_source=github&utm_medium=readme&utm_campaign=groundmail-openclaw)
- **Built for code and for agents.** REST API, SMTP, SDKs for Node, Python, Go, PHP and Ruby, a CLI, and an MCP server for Claude, ChatGPT and Cursor.

## All Groundmail libraries

| Use | Package |
|-----|---------|
| Node.js / TypeScript | [`groundmail`](https://www.npmjs.com/package/groundmail) on npm |
| Python (Django), Go, Ruby (Rails Action Mailer) | [Groundmail/groundmail-sdks](https://github.com/Groundmail/groundmail-sdks) |
| PHP | [Groundmail/groundmail-php](https://github.com/Groundmail/groundmail-php) |
| Laravel | [Groundmail/groundmail-laravel](https://github.com/Groundmail/groundmail-laravel) |
| Symfony Mailer | [Groundmail/groundmail-symfony-mailer](https://github.com/Groundmail/groundmail-symfony-mailer) |
| Nodemailer | [Groundmail/groundmail-nodemailer](https://github.com/Groundmail/groundmail-nodemailer) |
| NestJS | [Groundmail/nestjs-groundmail](https://github.com/Groundmail/nestjs-groundmail) |
| Strapi | [Groundmail/strapi-provider-email-groundmail](https://github.com/Groundmail/strapi-provider-email-groundmail) |
| Medusa | [Groundmail/medusa-notification-groundmail](https://github.com/Groundmail/medusa-notification-groundmail) |
| AdonisJS | [Groundmail/adonisjs-groundmail](https://github.com/Groundmail/adonisjs-groundmail) |
| Phoenix (Swoosh) | [Groundmail/swoosh_groundmail](https://github.com/Groundmail/swoosh_groundmail) |
| CLI | [`groundmail-cli`](https://www.npmjs.com/package/groundmail-cli) on npm |
| MCP server (Claude, ChatGPT, Cursor) | [Groundmail/groundmail-mcp](https://github.com/Groundmail/groundmail-mcp) |
| Agent skills and Claude Code plugin | [Groundmail/groundmail-skills](https://github.com/Groundmail/groundmail-skills) |
| Email templates (React Email, MJML, HTML) | [Groundmail/email-templates](https://github.com/Groundmail/email-templates) |

[Website](https://groundmail.dev?utm_source=github&utm_medium=readme&utm_campaign=groundmail-openclaw) · [Docs](https://docs.groundmail.dev?utm_source=github&utm_medium=readme&utm_campaign=groundmail-openclaw) · [Pricing](https://groundmail.dev/pricing/?utm_source=github&utm_medium=readme&utm_campaign=groundmail-openclaw) · [Sign up free](https://app.groundmail.dev/signup?utm_source=github&utm_medium=readme&utm_campaign=groundmail-openclaw)
