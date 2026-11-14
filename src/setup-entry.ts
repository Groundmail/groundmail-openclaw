// Loaded during setup instead of index.ts, so collecting a key never starts the
// gateway loop.
import { defineSetupPluginEntry } from 'openclaw/plugin-sdk/channel-core'
import { setupPlugin } from './setup.js'

export default defineSetupPluginEntry(setupPlugin as any)
