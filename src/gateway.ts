// Gateway lifecycle for one account: long-poll the mailbox for new mail and hand
// each message to the agent, in order, once. No webhook or open port needed, so
// it works on a laptop or behind NAT.
import fs from 'node:fs/promises'
import path from 'node:path'
import { waitUntilAbort } from 'openclaw/plugin-sdk/channel-outbound'
import { channelReadyPatch } from 'openclaw/plugin-sdk/gateway-runtime'
import { resolveStateDir } from 'openclaw/plugin-sdk/state-paths'
import type { ResolvedAccount } from './accounts.js'
import { GroundmailApi, GroundmailApiError, type MailboxMessage } from './api.js'
import { dispatchMessage, type DispatchOutcome } from './inbound.js'

const WAIT_SECONDS = 55
const MAX_BACKOFF_MS = 60_000
const RETRY_DELAYS_MS = [2_000, 10_000, 30_000]

/** Where we are in the mailbox: everything stored before `since`, plus `seen`, is handled. */
export type Cursor = { since: string; seen: string[] }

type Ctx = {
  cfg: unknown
  accountId: string
  account: ResolvedAccount
  abortSignal?: AbortSignal
  channelRuntime?: unknown
  log?: { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void }
  setStatus: (status: any) => void
  getStatus: () => any
}

export function createFileCursorStore(accountId: string, stateDir: string = resolveStateDir()) {
  const file = path.join(stateDir, 'groundmail', `cursor-${accountId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
  return {
    async load(): Promise<Cursor | undefined> {
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<Cursor>
        if (typeof raw.since !== 'string' || Number.isNaN(Date.parse(raw.since))) return undefined
        return { since: raw.since, seen: Array.isArray(raw.seen) ? raw.seen.filter((s) => typeof s === 'string') : [] }
      } catch {
        return undefined
      }
    },
    async save(cursor: Cursor): Promise<void> {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, JSON.stringify(cursor), 'utf8')
    },
  }
}

/**
 * Advance past a handled message. Ids are kept only for the newest timestamp, the
 * one the next `since` (inclusive on lists) can return again.
 */
export function advanceCursor(cursor: Cursor, message: Pick<MailboxMessage, 'id' | 'received_at'>): Cursor {
  if (message.received_at > cursor.since) return { since: message.received_at, seen: [message.id] }
  if (message.received_at === cursor.since && !cursor.seen.includes(message.id)) {
    return { since: cursor.since, seen: [...cursor.seen, message.id] }
  }
  return cursor
}

/** Messages not yet handled, oldest first. */
export function pendingMessages(cursor: Cursor, listed: MailboxMessage[]): MailboxMessage[] {
  return listed.filter((m) => m.received_at > cursor.since || (m.received_at === cursor.since && !cursor.seen.includes(m.id)))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

export async function startGatewayAccount(
  ctx: Ctx,
  deps: {
    api?: GroundmailApi
    dispatch?: typeof dispatchMessage
    cursorStore?: ReturnType<typeof createFileCursorStore>
    now?: () => Date
  } = {},
): Promise<void> {
  const { account } = ctx
  const signal = ctx.abortSignal
  if (!account.enabled) {
    await waitUntilAbort(signal)
    return
  }
  if (account.mode === 'tool') {
    ctx.log?.info?.(`[${ctx.accountId}] Groundmail in tool mode: not listening for new mail`)
    ctx.setStatus({ ...ctx.getStatus(), accountId: ctx.accountId, running: true, connected: false })
    await waitUntilAbort(signal)
    return
  }
  if (!account.apiKey || !account.mailbox) {
    throw new Error(`Groundmail account "${ctx.accountId}" needs an apiKey and a mailbox. Run: openclaw channels add --channel groundmail`)
  }
  if (!ctx.channelRuntime) throw new Error('Groundmail needs OpenClaw channel runtime support. Update OpenClaw and retry.')

  const api = deps.api ?? new GroundmailApi(account.baseUrl, account.apiKey)
  const dispatch = deps.dispatch ?? dispatchMessage
  const store = deps.cursorStore ?? createFileCursorStore(ctx.accountId)
  const now = deps.now ?? (() => new Date())

  const mailbox = await api.getMailbox(account.mailbox)
  ctx.log?.info?.(`[${ctx.accountId}] Groundmail mailbox ${mailbox.address}`)

  // First start: begin from now, so old mail doesn't wake the agent.
  let cursor: Cursor = (await store.load()) ?? { since: now().toISOString(), seen: [] }
  await store.save(cursor).catch(() => undefined)
  ctx.setStatus(channelReadyPatch({ accountId: ctx.accountId, lastStartAt: Date.now() }))

  // Lists come without bodies; the message a wait returns is already complete.
  const handle = async (summary: MailboxMessage, complete?: MailboxMessage): Promise<boolean> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const message = complete ?? (await api.getMessage(mailbox.address, summary.id))
        ctx.setStatus({ ...ctx.getStatus(), accountId: ctx.accountId, lastInboundAt: Date.now() })
        const outcome: DispatchOutcome = await dispatch({
          ctx: ctx as Parameters<typeof dispatchMessage>[0]['ctx'],
          api,
          message,
          mailboxAddress: mailbox.address,
        })
        if (outcome.kind === 'dropped') ctx.log?.info?.(`groundmail: skipped ${summary.id}: ${outcome.reason}`)
        return true
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt]
        if (delay === undefined || signal?.aborted) {
          ctx.log?.error?.(`groundmail: giving up on ${summary.id} after ${attempt} retries: ${String(error)}`)
          return false
        }
        ctx.log?.warn?.(`groundmail: handling ${summary.id} failed, retry ${attempt + 1} in ${delay}ms: ${String(error)}`)
        await sleep(delay, signal)
      }
    }
  }

  let failures = 0
  let stopError: unknown
  try {
    while (!signal?.aborted) {
      try {
        const result = await api.waitForMessage(mailbox.address, {
          since: cursor.since,
          timeoutSeconds: WAIT_SECONDS,
          signal,
        })
        failures = 0
        if ('timeout' in result) continue
        const woke = result.message
        // Mail can arrive in a burst: take everything since the cursor, in order.
        const listed = await api.listInboundSince(mailbox.address, cursor.since)
        const batch = pendingMessages(cursor, listed)
        if (woke && woke.direction === 'inbound' && !batch.some((m) => m.id === woke.id) && pendingMessages(cursor, [woke]).length) {
          batch.push(woke)
          batch.sort((a, b) => a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id))
        }
        for (const message of batch) {
          if (signal?.aborted) break
          // A message we gave up on is still skipped: holding the cursor would block
          // every email after it. The failure is in the log.
          await handle(message, woke && message.id === woke.id ? woke : undefined)
          cursor = advanceCursor(cursor, message)
          await store.save(cursor).catch((error) => ctx.log?.warn?.(`groundmail: cursor save failed: ${String(error)}`))
        }
      } catch (error) {
        if (signal?.aborted) break
        if (error instanceof GroundmailApiError && error.fatal) {
          throw new Error(`Groundmail refused this account (${error.status} ${error.code ?? ''}): ${error.message}`)
        }
        failures += 1
        const delay = Math.min(1_000 * 2 ** failures, MAX_BACKOFF_MS)
        ctx.log?.warn?.(`groundmail: waiting for mail failed (${String(error)}); retrying in ${delay}ms`)
        await sleep(delay, signal)
      }
    }
  } catch (error) {
    stopError = error
    throw error
  } finally {
    ctx.setStatus({
      accountId: ctx.accountId,
      running: false,
      connected: false,
      lastStopAt: Date.now(),
      ...(stopError ? { lastError: String(stopError) } : {}),
    })
  }
}
