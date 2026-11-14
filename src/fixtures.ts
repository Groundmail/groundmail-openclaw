import type { MailboxMessage } from './api.js'

/** A received email as the API returns it. Test-only. */
export function message(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  return {
    id: 'mbm_1',
    mailbox_id: 'mbx_1',
    thread_id: 'thd_1',
    direction: 'inbound',
    from: 'ana@example.com',
    from_name: 'Ana',
    to: ['bot@agents.groundmailbox.com'],
    reply_to: null,
    subject: 'Hello',
    code: null,
    links: [],
    held: false,
    sender_verified: true,
    authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    prompt_injection: { flagged: false, signals: [] },
    auto_submitted: false,
    attachments: [],
    received_at: '2026-11-13T10:00:00.000Z',
    visible_text: 'Hi there\n\n> old quote',
    reply_text: 'Hi there',
    ...overrides,
  }
}
