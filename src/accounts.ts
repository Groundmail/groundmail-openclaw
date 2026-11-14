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

/**
 * Who may start an agent turn by email (OpenClaw's usual DM policy).
 *  allowlist  only senders in allowFrom (default; an empty list lets nobody in)
 *  open       anyone, and only when allowFrom includes "*"
 *  disabled   nobody
 * Everyone else's mail still reaches the main chat as the fixed-wording note.
 */
export const DM_POLICIES = ['allowlist', 'open', 'disabled'] as const
export type DmPolicy = (typeof DM_POLICIES)[number]

export function normalizeDmPolicy(value: unknown): DmPolicy | undefined {
  return typeof value === 'string' && (DM_POLICIES as readonly string[]).includes(value) ? (value as DmPolicy) : undefined
}

/** Lowercased addresses, "@domain" entries and "*"; anything else is dropped. */
export function normalizeAllowFrom(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const out: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') continue
    const entry = item.trim().toLowerCase()
    if (entry === '*' || /^@[a-z0-9.-]+\.[a-z]{2,}$/.test(entry) || /^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(entry)) {
      if (!out.includes(entry)) out.push(entry)
    }
  }
  return out
}

/** Whether this sender may start an agent turn. */
export function senderAllowed(from: string | null | undefined, policy: DmPolicy, allowFrom: string[]): boolean {
  if (policy === 'disabled') return false
  if (policy === 'open') return allowFrom.includes('*')
  const address = (from ?? '').trim().toLowerCase()
  if (!address.includes('@')) return false
  const domain = address.slice(address.lastIndexOf('@'))
  return allowFrom.includes(address) || allowFrom.includes(domain)
}

export type ResolvedAccount = {
  accountId: string
  name?: string
  enabled: boolean
  configured: boolean
  apiKey: string | null
  mailbox: string | null
  baseUrl: string
  mode: Mode
  dmPolicy: DmPolicy
  allowFrom: string[]
}

type AccountConfig = {
  name?: string
  enabled?: boolean
  apiKey?: unknown
  mailbox?: string
  baseUrl?: string
  mode?: string
  dmPolicy?: string
  allowFrom?: unknown
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
    dmPolicy: normalizeDmPolicy(merged.dmPolicy) ?? 'allowlist',
    allowFrom: normalizeAllowFrom(merged.allowFrom),
  }
}
