#!/usr/bin/env node
import open from 'open'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { startCFlow, type StartCFlowOptions } from './server.js'
import { cliCopy, detectCliLocale, format } from './locale.js'

type Opener = (url: string) => Promise<unknown>

export const browserAddress = (listenAddress: string) => {
  const url = new URL(listenAddress)
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
  if (url.hostname === '[::]' || url.hostname === '::') url.hostname = '[::1]'
  return url.toString().replace(/\/$/, '')
}

export async function openCFlowBrowser(
  listenAddress: string,
  environment: NodeJS.ProcessEnv = process.env,
  opener: Opener = open,
  warn: (message: string) => void = console.warn,
) {
  if (environment.CFLOW_NO_OPEN === '1') return false
  const url = browserAddress(listenAddress)
  try {
    await opener(url)
    return true
  } catch (error) {
    warn(
      format(cliCopy[detectCliLocale(environment)].openFailed, {
        url,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return false
  }
}

export async function runCFlowCli(
  options: StartCFlowOptions & {
    opener?: Opener
    log?: (message: string) => void
    warn?: (message: string) => void
  } = {},
) {
  const result = await startCFlow(options)
  const url = browserAddress(result.address)
  ;(options.log ?? console.log)(
    format(cliCopy[detectCliLocale(options.environment)].started, { url }),
  )
  await openCFlowBrowser(result.address, options.environment, options.opener, options.warn)
  return result
}

const isDirectExecution = (entryPath = process.argv[1]) => {
  if (!entryPath) return false
  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  try {
    await runCFlowCli()
  } catch (error) {
    console.error(
      format(cliCopy[detectCliLocale()].startFailed, {
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    process.exitCode = 1
  }
}
