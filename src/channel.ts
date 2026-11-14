// The full channel: setup, status, the gateway loop and proactive sends.
import { describeAccountSnapshot } from 'openclaw/plugin-sdk/account-helpers'
import { createChatChannelPlugin } from 'openclaw/plugin-sdk/channel-core'
import {
  buildBaseChannelStatusSummary,
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from 'openclaw/plugin-sdk/status-helpers'
import { CHANNEL_ID, listAccountIds, resolveAccount, resolveDefaultAccountId, type ResolvedAccount } from './accounts.js'
import { GroundmailApi } from './api.js'
import { channelConfigSchema } from './config-schema.js'
import { startGatewayAccount } from './gateway.js'
import { collectRuntimeConfigAssignments, secretTargetRegistryEntries } from './secret-contract.js'
import { META, setupPlugin } from './setup.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function stripPrefix(to: string): string {
  return to.replace(/^(groundmail|email|mail):/i, '').trim()
}

export function subjectFrom(text: string): string {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? 'Message from your agent'
  return line.length > 78 ? `${line.slice(0, 75)}...` : line
}

/**
 * A proactive send: in a thread it answers the latest email from that person;
 * with no thread it starts a new one, which only a mailbox on your own domain can do.
 */
export async function sendText(params: {
  account: ResolvedAccount
  to: string
  text: string
  threadId?: string | number | null
  api?: GroundmailApi
}): Promise<{ messageId: string }> {
  const { account } = params
  if (!account.apiKey || !account.mailbox) throw new Error('Groundmail account is not configured')
  const api = params.api ?? new GroundmailApi(account.baseUrl, account.apiKey)
  const to = stripPrefix(params.to).toLowerCase()
  const key = `openclaw-send-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  if (params.threadId) {
    const messages = await api.getThreadMessages(account.mailbox, String(params.threadId))
    const latest = [...messages]
      .reverse()
      .find((m) => m.direction === 'inbound' && (m.from ?? '').toLowerCase() === to)
    if (latest) {
      const result = await api.reply(account.mailbox, latest.id, { text: params.text, idempotencyKey: key })
      return { messageId: result.message_id }
    }
  }
  const result = await api.send(account.mailbox, { to, subject: subjectFrom(params.text), text: params.text, idempotencyKey: key })
  return { messageId: result.message_id }
}

export const groundmailPlugin = createChatChannelPlugin({
  base: {
    id: CHANNEL_ID,
    meta: META,
    capabilities: { chatTypes: ['direct'], threads: true },
    setupContract: setupPlugin.setupContract,
    setupWizard: setupPlugin.setupWizard,
    reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
    configSchema: channelConfigSchema,
    config: {
      listAccountIds,
      resolveAccount: (cfg: any, accountId?: string | null) => resolveAccount({ cfg, accountId }),
      defaultAccountId: resolveDefaultAccountId,
      isConfigured: (account: ResolvedAccount) => account.configured,
      isEnabled: (account: ResolvedAccount) => account.enabled,
      describeAccount: (account: ResolvedAccount) =>
        describeAccountSnapshot({
          account,
          configured: account.configured,
          extra: { mailbox: account.mailbox, mode: account.mode, baseUrl: account.baseUrl },
        }),
    },
    status: createComputedAccountStatusAdapter({
      defaultRuntime: createDefaultChannelRuntimeState('default'),
      buildChannelSummary: ({ snapshot }: any) => buildBaseChannelStatusSummary(snapshot),
      probeAccount: async ({ account }: { account: ResolvedAccount }) => {
        if (!account.apiKey || !account.mailbox) return { ok: false, address: null, error: 'missing apiKey or mailbox' }
        try {
          const mailbox = await new GroundmailApi(account.baseUrl, account.apiKey).getMailbox(account.mailbox)
          return { ok: true, address: mailbox.address, error: null }
        } catch (error) {
          return { ok: false, address: null, error: String(error) }
        }
      },
      formatCapabilitiesProbe: ({ probe }: any) => [
        probe.ok ? { text: `Groundmail: ${probe.address}` } : { text: `Groundmail: unreachable (${probe.error})`, tone: 'error' },
      ],
      collectStatusIssues: (accounts: ResolvedAccount[]) =>
        accounts.flatMap((account) =>
          account.configured
            ? []
            : [
                {
                  channel: CHANNEL_ID,
                  accountId: account.accountId,
                  kind: 'config',
                  message: 'Groundmail account has no mailbox or key',
                  fix: 'Run `openclaw channels add --channel groundmail` (no key needed for a new address).',
                },
              ],
        ),
      resolveAccountSnapshot: ({ account }: { account: ResolvedAccount }) => ({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        extra: { mailbox: account.mailbox, mode: account.mode },
      }),
    } as any),
    gateway: {
      startAccount: async (ctx: any) => await startGatewayAccount(ctx),
    },
    secrets: { secretTargetRegistryEntries, collectRuntimeConfigAssignments },
    messaging: {
      targetPrefixes: ['groundmail', 'email', 'mail'],
      targetIdComparison: 'lowercase',
      // A target is an email address, optionally prefixed.
      normalizeTarget: (raw: string) => {
        const address = stripPrefix(raw).toLowerCase()
        return EMAIL.test(address) ? address : undefined
      },
      inferTargetChatType: () => 'direct',
      targetResolver: {
        looksLikeId: (raw: string) => EMAIL.test(stripPrefix(raw)),
        hint: 'an email address, e.g. person@example.com',
      },
    },
  },
  // Agent-started and scheduled sends. Replies to received mail go through the
  // turn's own delivery instead (see inbound.ts).
  outbound: {
    base: { deliveryMode: 'direct', textChunkLimit: 100_000 },
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: async ({ cfg, to, text, accountId, threadId }: any) =>
        sendText({ account: resolveAccount({ cfg, accountId }), to, text, threadId }),
    },
  },
} as any)
