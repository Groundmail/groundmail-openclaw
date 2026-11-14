import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/channel-core'
import { groundmailPlugin } from './channel.js'
import { registerGroundmailCli } from './cli.js'
import { setGroundmailRuntime } from './runtime.js'

export default defineChannelPluginEntry({
  id: 'groundmail',
  name: 'Groundmail',
  description: 'Groundmail email channel: your agent gets its own email address.',
  plugin: groundmailPlugin,
  setRuntime: setGroundmailRuntime,
  // `openclaw groundmail -- ...` is what the bundled skill tells the agent to run.
  registerCliMetadata: (api: any) => registerGroundmailCli(api),
} as any)
