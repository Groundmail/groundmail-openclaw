import { describe, expect, it, vi } from 'vitest'
import { buildCliArgs, buildCliEnv, findBlockedFlag } from './cli.js'
import { sendText, stripPrefix, subjectFrom } from './channel.js'
import { provisionMailbox } from './setup.js'
import { message } from './fixtures.js'

function fakeFetch(routes: Record<string, (body: any, headers: Record<string, string>) => [number, unknown]>) {
  const calls: Array<{ method: string; path: string; body: any; headers: Record<string, string> }> = []
  const impl = vi.fn(async (url: URL | string, init: RequestInit = {}) => {
    const u = new URL(String(url))
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    const headers = (init.headers ?? {}) as Record<string, string>
    calls.push({ method, path: u.pathname, body, headers })
    const handler = routes[`${method} ${u.pathname}`]
    if (!handler) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'no route' } }), { status: 404 })
    const [status, json] = handler(body, headers)
    return new Response(JSON.stringify(json), { status })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

const BASE = 'https://api.groundmail.dev'
const MAILBOX = { id: 'mbx_1', address: 'bot@agents.groundmailbox.com', hosted: true, status: 'active' }

describe('provisionMailbox', () => {
  it('makes an address with no account when no key is given', async () => {
    const f = fakeFetch({
      'POST /mailboxes/instant': () => [201, { mailbox: MAILBOX, api_key: 'gm_mbx', level: 'none' }],
    })
    const result = await provisionMailbox({ baseUrl: BASE, accountId: 'default', apiKey: null, localPart: 'bot', fetchImpl: f.impl })
    expect(result).toMatchObject({ mailbox: 'bot@agents.groundmailbox.com', apiKey: 'gm_mbx' })
    expect(f.calls[0]!.body).toEqual({ local_part: 'bot', source: 'openclaw' })
    expect(f.calls[0]!.headers.Authorization).toBeUndefined()
    expect(result.lines.join('\n')).toContain('mailboxes owner')
  })

  it('swaps an account key for one limited to the mailbox and never keeps the account key', async () => {
    const f = fakeFetch({
      'GET /mailboxes': () => [200, { data: [MAILBOX] }],
      'POST /api-keys': () => [201, { id: 'key_1', token: 'gm_limited' }],
    })
    const result = await provisionMailbox({ baseUrl: BASE, accountId: 'default', apiKey: 'gm_account', fetchImpl: f.impl })
    expect(result.apiKey).toBe('gm_limited')
    expect(f.calls[1]!.body).toEqual({
      name: 'openclaw:default',
      scopes: ['mailboxes:read', 'mailboxes:write', 'mailboxes:send'],
      mailbox_ids: ['mbx_1'],
    })
  })

  it('keeps a key that is already limited to the mailbox', async () => {
    const f = fakeFetch({
      'GET /mailboxes/bot%40agents.groundmailbox.com': () => [200, { mailbox: MAILBOX }],
      'POST /api-keys': () => [403, { error: { code: 'forbidden', message: 'no' } }],
    })
    const result = await provisionMailbox({
      baseUrl: BASE,
      accountId: 'default',
      apiKey: 'gm_limited',
      mailbox: 'bot@agents.groundmailbox.com',
      fetchImpl: f.impl,
    })
    expect(result).toMatchObject({ mailbox: 'bot@agents.groundmailbox.com', apiKey: undefined })
  })

  it('asks which mailbox when the key sees several', async () => {
    const f = fakeFetch({ 'GET /mailboxes': () => [200, { data: [MAILBOX, { ...MAILBOX, id: 'mbx_2', address: 'two@x.dev' }] }] })
    await expect(provisionMailbox({ baseUrl: BASE, accountId: 'default', apiKey: 'gm_account', fetchImpl: f.impl })).rejects.toThrow(
      /Pick one with --mailbox/,
    )
  })
})

describe('sendText', () => {
  const account = {
    accountId: 'default',
    enabled: true,
    configured: true,
    apiKey: 'gm_x',
    mailbox: 'bot@x.dev',
    baseUrl: BASE,
    mode: 'channel' as const,
  }

  it('answers the latest email from that person when given a thread', async () => {
    const api = {
      getThreadMessages: vi.fn(async () => [message({ id: 'mbm_old' }), message({ id: 'mbm_new' }), message({ id: 'mbm_mine', direction: 'outbound' })]),
      reply: vi.fn(async () => ({ message_id: 'mbm_r', thread_id: 'thd_1' })),
      send: vi.fn(),
    }
    const result = await sendText({ account, to: 'email:Ana@Example.com', text: 'Done', threadId: 'thd_1', api: api as any })
    expect(result).toEqual({ messageId: 'mbm_r' })
    expect(api.reply).toHaveBeenCalledWith('bot@x.dev', 'mbm_new', expect.objectContaining({ text: 'Done' }))
    expect(api.send).not.toHaveBeenCalled()
  })

  it('starts a new thread with the first line as the subject', async () => {
    const api = { getThreadMessages: vi.fn(), reply: vi.fn(), send: vi.fn(async () => ({ message_id: 'mbm_s', thread_id: 'thd_2' })) }
    await sendText({ account, to: 'ana@example.com', text: 'Quote ready\n\nDetails below', api: api as any })
    expect(api.send).toHaveBeenCalledWith('bot@x.dev', expect.objectContaining({ to: 'ana@example.com', subject: 'Quote ready' }))
  })

  it('normalizes targets and subjects', () => {
    expect(stripPrefix('groundmail:a@b.co')).toBe('a@b.co')
    expect(subjectFrom('x'.repeat(100))).toHaveLength(78)
  })
})

describe('CLI wrapper', () => {
  it('passes only the channel key and drops proxies and other Groundmail settings', () => {
    const env = buildCliEnv({ PATH: '/bin', HTTPS_PROXY: 'http://evil', GROUNDMAIL_API_KEY: 'gm_other', HOME: '/h' }, 'gm_channel')
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', GROUNDMAIL_API_KEY: 'gm_channel' })
  })

  it("won't let arguments swap the key or the endpoint", () => {
    expect(findBlockedFlag(['mailboxes', 'list', '--api-key', 'x'])).toBe('--api-key')
    expect(findBlockedFlag(['--base-url=https://evil'])).toBe('--base-url=https://evil')
    expect(findBlockedFlag(['mailboxes', 'read', 'a@b.co'])).toBeUndefined()
  })

  it('adds the base URL only when it is not the default', () => {
    expect(buildCliArgs(['x'], BASE)).toEqual(['x'])
    expect(buildCliArgs(['x'], 'http://localhost:3003')).toEqual(['x', '--base-url', 'http://localhost:3003'])
  })
})
