import { buildChannelConfigSchema, buildMultiAccountChannelSchema } from 'openclaw/plugin-sdk/channel-config-schema'
import { buildSecretInputSchema } from 'openclaw/plugin-sdk/secret-input'
import { z } from 'zod'
import { MODES } from './accounts.js'

const AccountSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    configWrites: z.boolean().optional(),
    // A literal key or a SecretRef; the host resolves refs before we read them.
    apiKey: buildSecretInputSchema().optional(),
    mailbox: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    mode: z.enum(MODES).optional(),
  })
  .strict()

export const channelConfigSchema = buildChannelConfigSchema(buildMultiAccountChannelSchema(AccountSchema), {
  uiHints: {
    apiKey: { label: 'API key', sensitive: true },
    mailbox: { label: 'Mailbox', help: "The agent's address, or its mbx_ id" },
    baseUrl: { label: 'API base URL', advanced: true },
    mode: {
      label: 'Mode',
      help: 'channel (default): mail from people wakes the agent and it replies in the thread; automated mail such as sign-up codes is passed to the agent in its main chat. notify: the agent tells you about new mail and sends nothing by itself. tool: nothing inbound; email only when you ask.',
    },
  },
})
