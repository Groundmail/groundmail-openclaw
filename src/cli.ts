// `openclaw groundmail -- <args>`: run the Groundmail CLI with this channel's key.
// The bundled skill tells the agent to call it, so the agent never sees the key and
// the CLI needs no sign-in of its own. Arguments can't swap the key or the endpoint,
// and proxy settings are dropped so a changed environment can't redirect requests.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { normalizeAccountId } from 'openclaw/plugin-sdk/account-id'
import { resolveCommandSecretRefsViaGateway } from 'openclaw/plugin-sdk/runtime'
import { CHANNEL_ID, resolveAccount, resolveDefaultAccountId } from './accounts.js'
import { DEFAULT_BASE_URL } from './api.js'
import { secretTargetRegistryEntries } from './secret-contract.js'

const BLOCKED_FLAGS = ['--api-key', '--base-url']
const STRIPPED_ENV = /^(https?_proxy|all_proxy|no_proxy)$/i
const SECRET_TARGET_IDS = new Set(secretTargetRegistryEntries.map((entry: { id: string }) => entry.id))

export function findBlockedFlag(args: string[]): string | undefined {
  return args.find((a) => BLOCKED_FLAGS.some((f) => a === f || a.startsWith(`${f}=`)))
}

export function buildCliEnv(base: NodeJS.ProcessEnv, apiKey: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (!STRIPPED_ENV.test(key) && !key.startsWith('GROUNDMAIL_')) env[key] = value
  }
  env.GROUNDMAIL_API_KEY = apiKey
  return env
}

export function buildCliArgs(args: string[], baseUrl: string): string[] {
  return baseUrl === DEFAULT_BASE_URL ? args : [...args, '--base-url', baseUrl]
}

function resolveBundledCliPath(): string {
  const require = createRequire(import.meta.url)
  const pkg = require.resolve('groundmail-cli/package.json')
  return path.join(path.dirname(pkg), 'dist', 'cli.js')
}

/** The CLI context passes the raw config file, so ask the gateway to resolve a SecretRef key. */
async function resolveCliConfig(config: any, accountId: string): Promise<any> {
  const { resolvedConfig, diagnostics } = await resolveCommandSecretRefsViaGateway({
    config,
    commandName: CHANNEL_ID,
    targetIds: SECRET_TARGET_IDS,
    allowedPaths: new Set([
      `channels.${CHANNEL_ID}.apiKey`,
      `channels.${CHANNEL_ID}.accounts.${normalizeAccountId(accountId)}.apiKey`,
    ]),
  } as any)
  for (const entry of diagnostics ?? []) console.error(`[secrets] ${entry}`)
  return resolvedConfig
}

export function registerGroundmailCli(api: any): void {
  api.registerCli(
    ({ program, config }: any) => {
      program
        .command(CHANNEL_ID)
        .description("Run the Groundmail CLI with this channel's mailbox key")
        .option('--account <id>', 'Groundmail channel account to use')
        .allowUnknownOption(true)
        .allowExcessArguments(true)
        .argument('[args...]', 'arguments for the groundmail CLI (after --)')
        .action(async (args: string[], opts: { account?: string }) => {
          const accountId = opts.account ?? resolveDefaultAccountId(config)
          let account
          try {
            account = resolveAccount({ cfg: await resolveCliConfig(config, accountId), accountId })
          } catch (error) {
            console.error(`Could not read Groundmail account "${accountId}": ${String(error)}`)
            process.exitCode = 1
            return
          }
          if (!account.apiKey || !account.mailbox) {
            console.error(`Groundmail account "${accountId}" is not set up. Run: openclaw channels add --channel groundmail`)
            process.exitCode = 1
            return
          }
          const blocked = findBlockedFlag(args)
          if (blocked) {
            console.error(`${blocked} comes from the channel config and can't be passed here.`)
            process.exitCode = 1
            return
          }
          const child = spawn(process.execPath, [resolveBundledCliPath(), ...buildCliArgs(args, account.baseUrl)], {
            stdio: 'inherit',
            env: buildCliEnv(process.env, account.apiKey),
          })
          await new Promise<void>((resolve) => {
            child.on('exit', (code) => {
              process.exitCode = code ?? 1
              resolve()
            })
            child.on('error', (error) => {
              console.error(`Could not start the Groundmail CLI: ${String(error)}`)
              process.exitCode = 1
              resolve()
            })
          })
        })
    },
    {
      commands: [CHANNEL_ID],
      descriptors: [{ name: CHANNEL_ID, description: "Groundmail CLI with this channel's mailbox key", hasSubcommands: false }],
    },
  )
}
