#!/usr/bin/env node
import open from 'open'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { startCFlow, type StartCFlowOptions } from './server.js'

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
      `CFlow 无法自动打开浏览器，请手动访问 ${url}：${error instanceof Error ? error.message : String(error)}`,
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
  ;(options.log ?? console.log)(`CFlow 已启动：${url}`)
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
    console.error(`CFlow 启动失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
