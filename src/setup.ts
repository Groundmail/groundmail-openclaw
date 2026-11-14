// `openclaw channels add --channel groundmail [...]` and the onboarding wizard.
// Kept light so setup never loads the gateway loop.
import { defineChannelSetupContract } from 'openclaw/plugin-sdk/channel-setup'
import { createPatchedAccountSetupAdapter, setSetupChannelEnabled } from 'openclaw/plugin-sdk/setup'
import { normalizeOptionalString } from 'openclaw/plugin-sdk/string-coerce-runtime'
import { CHANNEL_ID, MODES, normalizeAllowFrom, normalizeMode, listAccountIds, resolveAccount, resolveDefaultAccountId } from './accounts.js'
import { GroundmailApi, type Mailbox } from './api.js'

export const DOCS_URL = 'https://docs.groundmail.dev/ai/openclaw'

export const META = {
  id: CHANNEL_ID,
  label: 'Groundmail',
  selectionLabel: 'Groundmail (email)',
  docsPath: '/channels/groundmail',
  docsLabel: 'groundmail',
  blurb:
    'An agent mailbox: your agent gets its own email inbox. People you allow email it and it answers in the same thread; sign-up codes and other automated mail come to you in chat. No account needed to start.',
  order: 80,
}

type SetupInput = {
  apiKey?: string
  mailbox?: string
  localPart?: string
  ownerEmail?: string
  mode?: string
  baseUrl?: string
  allowFrom?: string
}

function describeMode(mode: string, address: string): string {
  if (mode === 'notify') return `Mode: notify. New mail at ${address} is passed to the agent to tell you about; it sends nothing by itself.`
  if (mode === 'tool') return `Mode: tool. Nothing wakes the agent; it uses ${address} only when you ask.`
  return `Mode: channel. Mail from people to ${address} wakes the agent and it answers in the same thread. Sign-up codes and other automated mail go to the agent in its main chat.`
}

export type ProvisionResult = { mailbox: string; apiKey?: string; lines: string[] }

/**
 * Turn what the user gave us into a mailbox and the narrowest key that reaches it.
 *
 *   no key            -> a new address with no account; the key it comes with
 *                        reaches only that mailbox
 *   account key       -> pick or create the mailbox, mint a key limited to it and
 *                        store THAT; the account key is never written to config
 *   mailbox-only key  -> stored as it is (it can't mint, so the API refuses with 403)
 */
export async function provisionMailbox(params: {
  baseUrl: string
  accountId: string
  apiKey: string | null
  mailbox?: string
  localPart?: string
  ownerEmail?: string
  fetchImpl?: typeof fetch
}): Promise<ProvisionResult> {
  const lines: string[] = []
  if (!params.apiKey) {
    const created = await new GroundmailApi(params.baseUrl, null, params.fetchImpl).createInstantMailbox({
      local_part: params.localPart,
      owner_email: params.ownerEmail,
    })
    lines.push(`Created ${created.mailbox.address} with no account. Its key reaches only this mailbox.`)
    lines.push(
      created.level === 'attached'
        ? `It can email ${params.ownerEmail} now. Once they give the agent the code we emailed them, it can email anyone: openclaw groundmail -- mailboxes verify ${created.mailbox.address} --code <code>`
        : `It can receive mail now. To let it send, name a person: openclaw groundmail -- mailboxes owner ${created.mailbox.address} --owner-email you@example.com`,
    )
    lines.push('Addresses that are never verified are deleted after 30 days, or after 7 with no mail.')
    return { mailbox: created.mailbox.address, apiKey: created.api_key, lines }
  }

  const api = new GroundmailApi(params.baseUrl, params.apiKey, params.fetchImpl)
  let mailbox: Mailbox
  if (params.mailbox) {
    mailbox = await api.getMailbox(params.mailbox)
    lines.push(`Using ${mailbox.address}.`)
  } else if (params.localPart) {
    mailbox = await api.createMailbox({ local_part: params.localPart })
    lines.push(`Created ${mailbox.address}.`)
  } else {
    const existing = await api.listMailboxes()
    if (existing.length === 1) {
      mailbox = existing[0]!
      lines.push(`Using ${mailbox.address}.`)
    } else if (existing.length === 0) {
      mailbox = await api.createMailbox({})
      lines.push(`Created ${mailbox.address}.`)
    } else {
      throw new Error(
        `This key can see ${existing.length} mailboxes. Pick one with --mailbox <address>, or make a new one with --local-part <name>:\n${existing
          .map((m) => `  ${m.address}`)
          .join('\n')}`,
      )
    }
  }

  const minted = await api.createMailboxKey(mailbox.id, `openclaw:${params.accountId}`)
  if (minted) lines.push(`Made a key that reaches only ${mailbox.address}; the key you passed is not stored.`)
  if (mailbox.hosted) {
    lines.push(`${mailbox.address} is on the shared agent domain, so it can reply but not email people first. Use a mailbox on your own domain for that.`)
  }
  return { mailbox: mailbox.address, apiKey: minted?.token, lines }
}

const baseAdapter = createPatchedAccountSetupAdapter({
  channelKey: CHANNEL_ID,
  buildPatch: (input: unknown) => {
    const i = input as SetupInput
    const patch: Record<string, unknown> = {}
    const apiKey = normalizeOptionalString(i.apiKey)
    const mailbox = normalizeOptionalString(i.mailbox)
    const baseUrl = normalizeOptionalString(i.baseUrl)
    if (apiKey) patch.apiKey = apiKey
    if (mailbox) patch.mailbox = mailbox
    if (baseUrl) patch.baseUrl = baseUrl
    const mode = normalizeMode(i.mode)
    if (mode) patch.mode = mode
    // The owner is always allowed to write to their agent.
    const allowFrom = normalizeAllowFrom([...normalizeAllowFrom(i.allowFrom), ...normalizeAllowFrom(i.ownerEmail)])
    if (allowFrom.length > 0) patch.allowFrom = allowFrom
    return patch
  },
})

export const setupAdapter = {
  ...baseAdapter,
  // Runs before the config is written, so openclaw.json only ever holds the
  // mailbox and a key limited to it.
  prepareAccountConfigInput: async ({ cfg, accountId, input, runtime }: any) => {
    const i = input as SetupInput
    const current = resolveAccount({ cfg, accountId })
    const apiKey = normalizeOptionalString(i.apiKey) ?? current.apiKey
    const baseUrl = normalizeOptionalString(i.baseUrl) ?? current.baseUrl
    const mode = normalizeMode(i.mode) ?? current.mode
    // New senders are added to the list, never swapped for it.
    const allowFrom = normalizeAllowFrom([...current.allowFrom, ...normalizeAllowFrom(i.allowFrom), ...normalizeAllowFrom(i.ownerEmail)])
    const withAllow = allowFrom.length > 0 ? { allowFrom: allowFrom.join(',') } : {}
    // Already set up and nothing new asked for: keep it.
    if (current.configured && !i.apiKey && !i.mailbox && !i.localPart) return { ...i, ...withAllow }
    const result = await provisionMailbox({
      baseUrl,
      accountId,
      apiKey,
      mailbox: normalizeOptionalString(i.mailbox),
      localPart: normalizeOptionalString(i.localPart),
      ownerEmail: normalizeOptionalString(i.ownerEmail),
    })
    for (const line of result.lines) runtime?.log?.(line)
    runtime?.log?.(describeMode(mode, result.mailbox))
    runtime?.log?.(
      allowFrom.length > 0
        ? `Only ${allowFrom.join(', ')} can start a conversation with the agent. Mail from anyone else, like sign-up codes, reaches its main chat as a short note.`
        : 'Nobody can start a conversation with the agent by email yet. Add yourself: --allow-from you@example.com. Mail from anyone, like sign-up codes, still reaches its main chat as a short note.',
    )
    return {
      ...i,
      mailbox: result.mailbox,
      ...(result.apiKey ? { apiKey: result.apiKey } : {}),
      ...withAllow,
    }
  },
  validateInput: () => null,
}

export const setupContract = defineChannelSetupContract({
  fields: {
    apiKey: {
      kind: 'string',
      sensitive: true,
      cli: {
        flags: '--api-key <key>',
        description: "Groundmail API key. Leave it out to get a new address with no account; an account key is swapped for one limited to the agent's mailbox",
      },
    },
    mailbox: {
      kind: 'string',
      cli: { flags: '--mailbox <address>', description: 'Use this existing mailbox (address or mbx_ id)' },
    },
    localPart: {
      kind: 'string',
      cli: { flags: '--local-part <name>', description: 'Name for a new address, e.g. sales -> sales@agents.groundmailbox.com' },
    },
    ownerEmail: {
      kind: 'string',
      cli: {
        flags: '--owner-email <email>',
        description: 'Your email, for a new address made with no account. You get a code; the agent can email you, and can email anyone once you give it the code',
      },
    },
    mode: {
      kind: 'choice',
      choices: [...MODES],
      cli: {
        flags: '--mode <mode>',
        description: 'channel (default): mail from people wakes the agent and it replies in the thread. notify: the agent tells you about new mail. tool: nothing inbound, email only when asked',
      },
    },
    allowFrom: {
      kind: 'string',
      cli: {
        flags: '--allow-from <emails>',
        description: 'Who can start a conversation with the agent by email: addresses or @domain, comma-separated. Your --owner-email is added for you',
      },
    },
    baseUrl: {
      kind: 'string',
      cli: { flags: '--base-url <url>', description: 'Groundmail API base URL (default https://api.groundmail.dev)' },
    },
  },
  legacyAdapter: setupAdapter,
} as any)

export const setupPlugin = {
  id: CHANNEL_ID,
  meta: META,
  capabilities: { chatTypes: ['direct'] },
  setupContract,
  config: {
    listAccountIds,
    resolveAccount: (cfg: any, accountId?: string | null) => resolveAccount({ cfg, accountId }),
    defaultAccountId: resolveDefaultAccountId,
    isConfigured: (account: { configured: boolean }) => account.configured,
    isEnabled: (account: { enabled: boolean }) => account.enabled,
  },
  setupWizard: {
    channel: CHANNEL_ID,
    resolveShouldPromptAccountIds: () => false,
    status: {
      configuredLabel: 'configured',
      unconfiguredLabel: 'no mailbox yet',
      configuredHint: 'configured',
      unconfiguredHint: 'leave the key empty to get an address with no account',
      configuredScore: 1,
      unconfiguredScore: 3,
      resolveConfigured: ({ cfg, accountId }: any) =>
        accountId
          ? resolveAccount({ cfg, accountId }).configured
          : listAccountIds(cfg).some((id: string) => resolveAccount({ cfg, accountId: id }).configured),
    },
    introNote: {
      title: 'Groundmail setup',
      lines: [
        'Leave the key empty and your agent gets a new address with no account.',
        'Or paste a Groundmail API key: OpenClaw picks your mailbox (or creates one)',
        'and stores a key that reaches only that mailbox, never your account key.',
        `Docs: ${DOCS_URL}`,
      ],
    },
    credentials: [],
    textInputs: [
      {
        inputKey: 'apiKey',
        message: 'Groundmail API key (leave empty for a new address with no account)',
        sensitive: true,
        required: false,
        applyEmptyValue: false,
        currentValue: ({ cfg, accountId }: any) => resolveAccount({ cfg, accountId }).apiKey ?? undefined,
        normalizeValue: ({ value }: any) => normalizeOptionalString(value) ?? '',
      },
      {
        inputKey: 'mailbox',
        message: 'Mailbox address (leave empty to pick or create one)',
        required: false,
        applyEmptyValue: false,
        currentValue: ({ cfg, accountId }: any) => resolveAccount({ cfg, accountId }).mailbox ?? undefined,
        normalizeValue: ({ value }: any) => normalizeOptionalString(value) ?? '',
      },
      {
        inputKey: 'allowFrom',
        message: 'Who can email the agent? Your address, or @yourcompany.com (comma-separated)',
        required: false,
        applyEmptyValue: false,
        currentValue: ({ cfg, accountId }: any) => resolveAccount({ cfg, accountId }).allowFrom.join(', ') || undefined,
        normalizeValue: ({ value }: any) => normalizeAllowFrom(value).join(','),
      },
    ],
    completionNote: {
      title: 'Groundmail next steps',
      lines: [
        'Restart the gateway, then email the address from an allowed sender. In channel mode the agent answers in the same thread.',
        "An address made with no account can't send until you confirm your email: the agent will ask you for it the first time it tries to reply.",
        `Docs: ${DOCS_URL}`,
      ],
    },
    disable: (cfg: any) => setSetupChannelEnabled(cfg, CHANNEL_ID, false),
  },
}
