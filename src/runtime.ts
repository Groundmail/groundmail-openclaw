// The PluginRuntime OpenClaw hands us at registration, for the system-event
// queue used to tell the agent about mail it shouldn't answer.
import { createPluginRuntimeStore, type PluginRuntime } from 'openclaw/plugin-sdk/runtime-store'

const store = createPluginRuntimeStore<PluginRuntime>({
  pluginId: 'groundmail',
  errorMessage: 'Groundmail plugin runtime is not ready; the gateway must load the plugin first.',
})

export const setGroundmailRuntime = store.setRuntime
export const getGroundmailRuntime = store.getRuntime
