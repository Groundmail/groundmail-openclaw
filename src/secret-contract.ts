// Tells OpenClaw which config paths may hold a SecretRef (env, file, exec or
// store), so `apiKey` can live outside openclaw.json.
import {
  collectConditionalChannelFieldAssignments,
  createChannelSecretTargetRegistryEntries,
  getChannelSurface,
  hasOwnProperty,
} from 'openclaw/plugin-sdk/channel-secret-basic-runtime'
import { CHANNEL_ID } from './accounts.js'

export const secretTargetRegistryEntries = createChannelSecretTargetRegistryEntries({
  channelKey: CHANNEL_ID,
  account: ['apiKey'],
  channel: ['apiKey'],
})

type CollectParams = Parameters<typeof collectConditionalChannelFieldAssignments>[0]

export function collectRuntimeConfigAssignments(params: {
  config: Parameters<typeof getChannelSurface>[0]
  defaults: CollectParams['defaults']
  context: CollectParams['context']
}): void {
  const resolved = getChannelSurface(params.config, CHANNEL_ID)
  if (!resolved) return
  collectConditionalChannelFieldAssignments({
    channelKey: CHANNEL_ID,
    field: 'apiKey',
    channel: resolved.channel,
    surface: resolved.surface,
    defaults: params.defaults,
    context: params.context,
    topLevelActiveWithoutAccounts: true,
    topLevelInheritedAccountActive: ({ account, enabled }) => enabled && !hasOwnProperty(account, 'apiKey'),
    accountActive: ({ enabled }) => enabled,
    topInactiveReason: 'no enabled Groundmail account uses this top-level apiKey.',
    accountInactiveReason: 'Groundmail account is disabled.',
  })
}
