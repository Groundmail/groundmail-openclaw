import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/channel-core'
import { groundmailPlugin } from './channel.js'
import { registerGroundmailCli } from './cli.js'
import { setGroundmailRuntime } from './runtime.js'

export default defineChannelPluginEntry({
  id: 'groundmail',
  name: 'Groundmail',
  description: 'Groundmail agent mailboxes: your agent gets its own email inbox.',
  plugin: groundmailPlugin,
  setRuntime: setGroundmailRuntime,
  // `openclaw groundmail -- ...` is what the bundled skill tells the agent to run.
  registerCliMetadata: (api: any) => registerGroundmailCli(api),
} as any)
