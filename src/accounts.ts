// One OpenClaw channel account = one Groundmail mailbox and a key that reaches it.
import { createAccountListHelpers } from 'openclaw/plugin-sdk/account-helpers'
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from 'openclaw/plugin-sdk/account-id'
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core'
import { hasConfiguredSecretInput, normalizeResolvedSecretInputString } from 'openclaw/plugin-sdk/secret-input'
import { normalizeOptionalString } from 'openclaw/plugin-sdk/string-coerce-runtime'
import { DEFAULT_BASE_URL } from './api.js'

export const CHANNEL_ID = 'groundmail'

/**
 *  channel  mail from people wakes the agent and its answer goes back in the thread (default)
 *  notify   new mail is announced to the agent's main chat; nothing is sent by itself
 *  tool     nothing inbound; the agent uses email only when asked
 */
export const MODES = ['channel', 'notify', 'tool'] as const
export type Mode = (typeof MODES)[number]

export type ResolvedAccount = {
  accountId: string
  name?: string
  enabled: boolean
  configured: boolean
  apiKey: string | null
  mailbox: string | null
  baseUrl: string
  mode: Mode
}

type AccountConfig = {
  name?: string
  enabled?: boolean
  apiKey?: unknown
  mailbox?: string
  baseUrl?: string
  mode?: string
}

type ChannelSection = AccountConfig & { accounts?: Record<string, AccountConfig>; defaultAccount?: string }

export function normalizeMode(value: unknown): Mode | undefined {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value) ? (value as Mode) : undefined
}

const helpers = createAccountListHelpers(CHANNEL_ID, {
  normalizeAccountId,
  omitKeys: ['defaultAccount'],
  implicitDefaultAccount: { channelKeys: ['apiKey', 'mailbox'] },
})

export const listAccountIds = helpers.listAccountIds
export const resolveDefaultAccountId = helpers.resolveDefaultAccountId

function channelSection(cfg: OpenClawConfig): ChannelSection | undefined {
  return (cfg.channels as Record<string, ChannelSection> | undefined)?.[CHANNEL_ID]
}

/**
 * A literal key, or a SecretRef the host has already resolved. A ref still
 * unresolved throws with its config path: a clear "secret not available" at
 * start beats a silent 401 later.
 */
function resolveApiKey(value: unknown, path: string): string | null {
  const present = value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')
  return present ? (normalizeResolvedSecretInputString({ value, path }) ?? null) : null
}

export function resolveAccount(params: { cfg: OpenClawConfig; accountId?: string | null }): ResolvedAccount {
  const accountId = normalizeAccountId(params.accountId ?? resolveDefaultAccountId(params.cfg))
  const section = channelSection(params.cfg)
  const merged = helpers.resolveAccountConfig(params.cfg, accountId) as AccountConfig
  const isDefault = accountId === DEFAULT_ACCOUNT_ID
  const apiKeyPath =
    isDefault && !section?.accounts?.[accountId]
      ? `channels.${CHANNEL_ID}.apiKey`
      : `channels.${CHANNEL_ID}.accounts.${accountId}.apiKey`
  const apiKey = resolveApiKey(merged.apiKey, apiKeyPath)
  const mailbox = normalizeOptionalString(merged.mailbox) ?? null
  return {
    accountId,
    name: normalizeOptionalString(merged.name),
    enabled: section?.enabled !== false && merged.enabled !== false,
    // A SecretRef counts as configured before the host resolves it.
    configured: Boolean((apiKey || hasConfiguredSecretInput(merged.apiKey)) && mailbox),
    apiKey,
    mailbox,
    baseUrl: (normalizeOptionalString(merged.baseUrl) ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    mode: normalizeMode(merged.mode) ?? 'channel',
  }
}
