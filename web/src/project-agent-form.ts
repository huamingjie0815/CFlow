import type { ProjectAgentConfig } from './types'

export type ProjectAgentFormValues = {
  id: string
  name: string
  description: string
  command: string
  args: string
  outputMode: ProjectAgentConfig['outputMode']
  envAllowlist: string
  timeoutSeconds: string
  maxOutputKilobytes: string
}

export const emptyProjectAgentForm = (): ProjectAgentFormValues => ({
  id: '',
  name: '',
  description: '',
  command: '',
  args: '',
  outputMode: 'json',
  envAllowlist: '',
  timeoutSeconds: '300',
  maxOutputKilobytes: '1024',
})

export const piProjectAgentExample = (): ProjectAgentFormValues => ({
  id: 'pi-agent',
  name: 'Pi Agent',
  description: '通过社区 pi-acp 适配器连接本机安装的 Pi coding agent。',
  command: 'npx',
  args: '-y\npi-acp',
  outputMode: 'json',
  envAllowlist: 'HOME\nPATH\nPI_CODING_AGENT_DIR\nANTHROPIC_API_KEY\nOPENAI_API_KEY',
  timeoutSeconds: '300',
  maxOutputKilobytes: '1024',
})

export const projectAgentToForm = (config: ProjectAgentConfig): ProjectAgentFormValues => ({
  id: config.id,
  name: config.name,
  description: config.description ?? '',
  command: config.command,
  args: config.args.join('\n'),
  outputMode: config.outputMode,
  envAllowlist: config.envAllowlist.join('\n'),
  timeoutSeconds: String(config.timeoutMs / 1000),
  maxOutputKilobytes: String(config.maxOutputBytes / 1024),
})

const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

export const projectAgentFromForm = (form: ProjectAgentFormValues): ProjectAgentConfig => ({
  id: form.id.trim(),
  name: form.name.trim(),
  description: form.description.trim() || undefined,
  command: form.command.trim(),
  args: lines(form.args),
  outputMode: form.outputMode,
  envAllowlist: lines(form.envAllowlist),
  timeoutMs: Number(form.timeoutSeconds) * 1000,
  maxOutputBytes: Number(form.maxOutputKilobytes) * 1024,
})
