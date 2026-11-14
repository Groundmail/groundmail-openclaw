// The slice of the Groundmail API this plugin uses: mailboxes, their mail,
// keys limited to one mailbox, and instant (no-account) mailboxes.

export const DEFAULT_BASE_URL = 'https://api.groundmail.dev'
const USER_AGENT = 'groundmail-openclaw'

export type Mailbox = {
  id: string
  address: string
  hosted: boolean
  status: string
  send_policy?: string | null
  display_name?: string | null
}

export type MailboxAttachment = {
  id: string
  filename: string | null
  content_type: string | null
  size: number
}

export type MailboxMessage = {
  id: string
  mailbox_id: string
  thread_id: string
  direction: 'inbound' | 'outbound'
  from: string | null
  from_name: string | null
  to: string[]
  reply_to: string | null
  subject: string | null
  code: string | null
  links: string[]
  held: boolean
  sender_verified: boolean
  authentication?: { spf?: string | null; dkim?: string | null; dmarc?: string | null } | null
  hidden_text_removed?: boolean
  prompt_injection?: { flagged: boolean; signals: string[] } | null
  auto_submitted: boolean
  attachments: MailboxAttachment[]
  received_at: string
  visible_text?: string | null
  reply_text?: string | null
}

export type InstantMailbox = {
  mailbox: Mailbox
  api_key: string
  level: 'none' | 'attached' | string
}

export class GroundmailApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'GroundmailApiError'
  }

  /** The key is bad or can't reach this mailbox: retrying won't help. */
  get fatal(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 404
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  idempotencyKey?: string
  signal?: AbortSignal
  auth?: boolean
}

export class GroundmailApi {
  readonly baseUrl: string

  constructor(
    baseUrl: string | undefined,
    private readonly apiKey: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' }
    if (options.auth !== false) {
      if (!this.apiKey) throw new Error('Groundmail API key is missing')
      headers.Authorization = `Bearer ${this.apiKey}`
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
    const response = await this.fetchImpl(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
    const text = await response.text()
    const json = text ? (safeParse(text) as Record<string, unknown> | null) : null
    if (!response.ok) {
      const error = (json?.error ?? null) as { code?: string; message?: string; details?: Record<string, unknown> } | null
      throw new GroundmailApiError(
        response.status,
        error?.code,
        error?.message ?? `Groundmail API ${response.status} on ${path}`,
        error?.details,
      )
    }
    return (json ?? {}) as T
  }

  async getMailbox(mailbox: string): Promise<Mailbox> {
    const { mailbox: found } = await this.request<{ mailbox: Mailbox }>(`/mailboxes/${encodeURIComponent(mailbox)}`)
    return found
  }

  async listMailboxes(): Promise<Mailbox[]> {
    const { data } = await this.request<{ data: Mailbox[] }>('/mailboxes', { query: { limit: 100 } })
    return data ?? []
  }

  async createMailbox(params: { local_part?: string; display_name?: string }): Promise<Mailbox> {
    const { mailbox } = await this.request<{ mailbox: Mailbox }>('/mailboxes', { method: 'POST', body: params })
    return mailbox
  }

  /**
   * A key that can reach this one mailbox and nothing else. Returns null when the
   * key we hold can't create keys (it is already limited), so it is safe to keep.
   */
  async createMailboxKey(mailboxId: string, name: string): Promise<{ id: string; token: string } | null> {
    try {
      return await this.request<{ id: string; token: string }>('/api-keys', {
        method: 'POST',
        body: { name, scopes: ['mailboxes:read', 'mailboxes:write', 'mailboxes:send'], mailbox_ids: [mailboxId] },
      })
    } catch (error) {
      if (error instanceof GroundmailApiError && error.status === 403) return null
      throw error
    }
  }

  async createInstantMailbox(params: { local_part?: string; owner_email?: string }): Promise<InstantMailbox> {
    return this.request<InstantMailbox>('/mailboxes/instant', {
      method: 'POST',
      auth: false,
      body: { ...params, source: 'openclaw' },
    })
  }

  /**
   * Long-poll for the next message stored after `since`. Resolves to the message,
   * or to `{ timeout, since }` when none came; pass that `since` to the next call.
   */
  async waitForMessage(
    mailbox: string,
    params: { since: string; timeoutSeconds: number; signal?: AbortSignal },
  ): Promise<{ message: MailboxMessage | null } | { timeout: true; since: string }> {
    try {
      const { message } = await this.request<{ message: MailboxMessage | null }>(
        `/mailboxes/${encodeURIComponent(mailbox)}/wait`,
        { query: { since: params.since, timeout: params.timeoutSeconds }, signal: params.signal },
      )
      return { message }
    } catch (error) {
      if (error instanceof GroundmailApiError && error.status === 408) {
        const since = typeof error.details?.since === 'string' ? error.details.since : params.since
        return { timeout: true, since }
      }
      throw error
    }
  }

  /** Received messages stored at or after `since`, oldest first, without bodies. */
  async listInboundSince(mailbox: string, since: string): Promise<MailboxMessage[]> {
    const { data } = await this.request<{ data: MailboxMessage[] }>(
      `/mailboxes/${encodeURIComponent(mailbox)}/messages`,
      { query: { since, limit: 100 } },
    )
    return (data ?? [])
      .filter((m) => m.direction === 'inbound' && !m.held)
      .sort((a, b) => a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id))
  }

  async getMessage(mailbox: string, messageId: string): Promise<MailboxMessage> {
    const { message } = await this.request<{ message: MailboxMessage }>(
      `/mailboxes/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}`,
    )
    return message
  }

  async getThreadMessages(mailbox: string, threadId: string): Promise<MailboxMessage[]> {
    const { thread } = await this.request<{ thread: { messages: MailboxMessage[] } }>(
      `/mailboxes/${encodeURIComponent(mailbox)}/threads/${encodeURIComponent(threadId)}`,
    )
    return thread?.messages ?? []
  }

  async reply(
    mailbox: string,
    messageId: string,
    params: { text: string; idempotencyKey: string },
  ): Promise<{ message_id: string; thread_id: string }> {
    return this.request(`/mailboxes/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/reply`, {
      method: 'POST',
      body: { text: params.text },
      idempotencyKey: params.idempotencyKey,
    })
  }

  async send(
    mailbox: string,
    params: { to: string; subject: string; text: string; idempotencyKey: string },
  ): Promise<{ message_id: string; thread_id: string }> {
    return this.request(`/mailboxes/${encodeURIComponent(mailbox)}/messages`, {
      method: 'POST',
      body: { to: params.to, subject: params.subject, text: params.text },
      idempotencyKey: params.idempotencyKey,
    })
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
