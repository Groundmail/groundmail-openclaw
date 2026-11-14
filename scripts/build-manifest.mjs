// Writes openclaw.plugin.json from the built config schema, so the manifest and
// the runtime schema can't drift. `--check` fails if the file is out of date.
// Run after `npm run build`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const { channelConfigSchema } = await import(path.join(root, 'dist', 'config-schema.js'))

const manifest = {
  id: 'groundmail',
  name: 'Groundmail',
  description: pkg.description,
  version: pkg.version,
  categories: ['channels'],
  activation: { onStartup: false },
  channels: ['groundmail'],
  channelConfigs: {
    groundmail: {
      label: 'Groundmail',
      description: 'An agent mailbox: your agent gets its own email inbox and answers mail in the same thread.',
      schema: channelConfigSchema.schema,
      uiHints: channelConfigSchema.uiHints,
    },
  },
  configSchema: { type: 'object', additionalProperties: false, properties: {} },
  configContracts: {
    secretInputs: {
      paths: [
        { path: 'channels.groundmail.apiKey', expected: 'string' },
        { path: 'channels.groundmail.accounts.*.apiKey', expected: 'string' },
      ],
    },
  },
  skills: ['skills'],
  cliCommands: [{ name: 'groundmail', description: "Groundmail CLI with this channel's mailbox key", hasSubcommands: false }],
}

const file = path.join(root, 'openclaw.plugin.json')
const next = `${JSON.stringify(manifest, null, 2)}\n`
if (process.argv.includes('--check')) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (current !== next) {
    console.error('openclaw.plugin.json is out of date. Run: npm run build && npm run manifest')
    process.exit(1)
  }
  console.log('openclaw.plugin.json is up to date')
} else {
  fs.writeFileSync(file, next)
  console.log('wrote openclaw.plugin.json')
}
