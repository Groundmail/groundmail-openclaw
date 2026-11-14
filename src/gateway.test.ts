import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ResolvedAccount } from './accounts.js'
import { GroundmailApiError, type MailboxMessage } from './api.js'
import { advanceCursor, createFileCursorStore, pendingMessages, startGatewayAccount, type Cursor } from './gateway.js'
import { message } from './fixtures.js'

const T0 = '2026-11-13T10:00:00.000Z'
const T1 = '2026-11-13T10:00:01.000Z'

describe('cursor', () => {
  it('handles each message once, including two stored in the same millisecond', () => {
    let cursor: Cursor = { since: T0, seen: [] }
    const a = message({ id: 'mbm_a', received_at: T1 })
    const b = message({ id: 'mbm_b', received_at: T1 })
    expect(pendingMessages(cursor, [a, b]).map((m) => m.id)).toEqual(['mbm_a', 'mbm_b'])
    cursor = advanceCursor(cursor, a)
    expect(pendingMessages(cursor, [a, b]).map((m) => m.id)).toEqual(['mbm_b'])
    cursor = advanceCursor(cursor, b)
    expect(cursor).toEqual({ since: T1, seen: ['mbm_a', 'mbm_b'] })
    expect(pendingMessages(cursor, [a, b])).toEqual([])
  })

  it('survives a restart through the state folder', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gm-oc-'))
    const store = createFileCursorStore('work/1', dir)
    expect(await store.load()).toBeUndefined()
    await store.save({ since: T1, seen: ['mbm_a'] })
    expect(await createFileCursorStore('work/1', dir).load()).toEqual({ since: T1, seen: ['mbm_a'] })
  })
})

const account: ResolvedAccount = {
  accountId: 'default',
  enabled: true,
  configured: true,
  apiKey: 'gm_x',
  mailbox: 'bot@agents.groundmailbox.com',
  baseUrl: 'https://api.groundmail.dev',
  mode: 'channel',
}

function harness(waits: Array<() => Promise<any>>, listed: MailboxMessage[][]) {
  const abort = new AbortController()
  let saved: Cursor | undefined
  const api = {
    getMailbox: vi.fn(async () => ({ id: 'mbx_1', address: 'bot@agents.groundmailbox.com' })),
    waitForMessage: vi.fn(async () => {
      const next = waits.shift()
      if (!next) {
        abort.abort()
        return { timeout: true, since: T0 }
      }
      return next()
    }),
    listInboundSince: vi.fn(async () => listed.shift() ?? []),
    getMessage: vi.fn(async (_mailbox: string, id: string) => message({ id, received_at: T1 })),
  }
  const dispatch = vi.fn(async () => ({ kind: 'dispatched' as const }))
  const ctx = {
    cfg: {},
    accountId: 'default',
    account,
    abortSignal: abort.signal,
    channelRuntime: {},
    log: {},
    setStatus: vi.fn(),
    getStatus: () => ({}),
  }
  const cursorStore = { load: async () => undefined, save: async (c: Cursor) => void (saved = c) }
  return { api, dispatch, ctx, cursorStore, saved: () => saved, now: () => new Date(T0) }
}

describe('startGatewayAccount', () => {
  it('hands a burst of mail to the agent once each, in order, and keeps waiting after timeouts', async () => {
    const first = message({ id: 'mbm_a', received_at: T1 })
    const second = message({ id: 'mbm_b', received_at: T1 })
    const h = harness(
      [async () => ({ timeout: true, since: T0 }), async () => ({ message: first })],
      [[first, second]],
    )
    await startGatewayAccount(h.ctx, { api: h.api as any, dispatch: h.dispatch, cursorStore: h.cursorStore, now: h.now })
    expect(h.dispatch.mock.calls.map((c: any) => c[0].message.id)).toEqual(['mbm_a', 'mbm_b'])
    // The woken message is used as is; the other is fetched for its body.
    expect(h.api.getMessage).toHaveBeenCalledTimes(1)
    expect(h.saved()).toEqual({ since: T1, seen: ['mbm_a', 'mbm_b'] })
  })

  it('stops on a revoked key instead of retrying forever', async () => {
    const h = harness([async () => Promise.reject(new GroundmailApiError(401, 'unauthorized', 'bad key'))], [])
    await expect(
      startGatewayAccount(h.ctx, { api: h.api as any, dispatch: h.dispatch, cursorStore: h.cursorStore, now: h.now }),
    ).rejects.toThrow(/refused this account \(401/)
  })

  it('listens to nothing in tool mode', async () => {
    const abort = new AbortController()
    const setStatus = vi.fn()
    const done = startGatewayAccount({
      cfg: {},
      accountId: 'default',
      account: { ...account, mode: 'tool' },
      abortSignal: abort.signal,
      setStatus,
      getStatus: () => ({}),
    })
    abort.abort()
    await done
    expect(setStatus).toHaveBeenCalledWith(expect.objectContaining({ running: true, connected: false }))
  })
})
