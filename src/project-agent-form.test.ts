import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyProjectAgentForm,
  piProjectAgentExample,
  projectAgentFromForm,
  projectAgentToForm,
} from '../web/src/project-agent-form.js'

test('converts project agent fields, line lists and display units', () => {
  const form = {
    ...emptyProjectAgentForm(),
    id: 'team-coder',
    name: ' Team Coder ',
    description: ' Project assistant ',
    command: ' team-agent ',
    args: ' --mode\n\n acp ',
    outputMode: 'text' as const,
    envAllowlist: ' API_KEY\nHTTP_PROXY ',
    timeoutSeconds: '45',
    maxOutputKilobytes: '2048',
  }
  const config = projectAgentFromForm(form)
  assert.deepEqual(config, {
    id: 'team-coder',
    name: 'Team Coder',
    description: 'Project assistant',
    command: 'team-agent',
    args: ['--mode', 'acp'],
    outputMode: 'text',
    envAllowlist: ['API_KEY', 'HTTP_PROXY'],
    timeoutMs: 45_000,
    maxOutputBytes: 2_097_152,
  })
  assert.deepEqual(projectAgentFromForm(projectAgentToForm(config)), config)
})

test('provides a usable Pi ACP adapter example without storing secret values', () => {
  const config = projectAgentFromForm(piProjectAgentExample())
  assert.equal(config.command, 'npx')
  assert.deepEqual(config.args, ['-y', 'pi-acp'])
  assert.ok(config.envAllowlist.includes('ANTHROPIC_API_KEY'))
  assert.equal(JSON.stringify(config).includes('sk-'), false)
})
