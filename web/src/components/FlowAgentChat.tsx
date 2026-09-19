import { useMemo, useRef, useState } from 'react'
import {
  Bot,
  CircleAlert,
  FileText,
  LoaderCircle,
  RotateCcw,
  Send,
  Undo2,
  Wrench,
  X,
} from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { api, readableError } from '../api'
import { runStatusLabel } from '../copy'
import { format } from '../i18n'
import { useLocale } from '../locale-context'
import { AgentTracePopover } from './AgentTracePopover'
import {
  applyCurrentRuntime,
  attachmentName,
  canApplyAgentRevision,
  mergeAttachments,
  runtimeStatus,
  snapshotFileList,
} from '../workbench-ui'
import type { AgentChatMessage, CFDraft, FlowDraft, RunDetail, RuntimeWithHealth } from '../types'

type MessageUpdate = AgentChatMessage[] | ((current: AgentChatMessage[]) => AgentChatMessage[])

type AgentSnapshot = {
  invocationId?: string
  messageId?: string
  runtimeId?: string
  flowDraft: FlowDraft
  cfDrafts: CFDraft[]
  conversation: { role: 'user' | 'assistant'; body: string }[]
  runDetail: RunDetail | null
  selection: { nodeId: string | null; edgeId: string | null }
  check: { error: string | null }
  attachments: File[]
}

type FailedRequest = {
  message: string
  snapshot: AgentSnapshot
  errorMessageId: string
}

type FlowAgentChatProps = {
  draft: FlowDraft
  cfDrafts: CFDraft[]
  runDetail: RunDetail | null
  messages: AgentChatMessage[]
  runtimes: RuntimeWithHealth[]
  runtimeId?: string
  testCount: number
  selectedNodeId: string | null
  selectedEdgeId: string | null
  checkError: string | null
  attachments: File[]
  undoMessageId?: string
  disabled?: boolean
  onMessagesChange: (update: MessageUpdate) => void
  onAttachmentsChange: (files: File[]) => void
  onRuntimeChange: (id: string) => void
  onRevision: (result: {
    flowDraft: FlowDraft
    cfDrafts: CFDraft[]
    previousDraft: FlowDraft
    previousCfDrafts: CFDraft[]
    messageId: string
  }) => void
  onUndoRevision: () => void
}

const TEXT_ACCEPT = '.md,.mdx,.txt,.json,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.sh'

function idOf(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function failureContext(runDetail: RunDetail | null, draft: FlowDraft, fallback: string) {
  if (!runDetail) return null
  const event = [...runDetail.events]
    .reverse()
    .find((item) => item.type === 'node.failed' || item.type === 'run.failed')
  if (!event) return null
  const node = event.node == null ? null : draft.nodes[event.node]
  const error =
    event.data && typeof event.data === 'object' && 'error' in event.data
      ? String(event.data.error)
      : fallback
  return { node, error }
}

export function FlowAgentChat(props: FlowAgentChatProps) {
  const { m, locale } = useLocale()
  const starterPrompts = [
    { label: m.agent.promptOptimize, value: m.agent.promptOptimizeValue },
    { label: m.agent.promptExplain, value: m.agent.promptExplainValue },
    { label: m.agent.promptHandoff, value: m.agent.promptHandoffValue },
  ]
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState('')
  const [failedRequest, setFailedRequest] = useState<FailedRequest | null>(null)
  const latestRef = useRef({
    draft: props.draft,
    cfDrafts: props.cfDrafts,
    messages: props.messages,
    runDetail: props.runDetail,
    runtimeId: props.runtimeId,
    selectedNodeId: props.selectedNodeId,
    selectedEdgeId: props.selectedEdgeId,
    checkError: props.checkError,
    attachments: props.attachments,
  })
  latestRef.current = {
    draft: props.draft,
    cfDrafts: props.cfDrafts,
    messages: props.messages,
    runDetail: props.runDetail,
    runtimeId: props.runtimeId,
    selectedNodeId: props.selectedNodeId,
    selectedEdgeId: props.selectedEdgeId,
    checkError: props.checkError,
    attachments: props.attachments,
  }

  const failure = useMemo(
    () => failureContext(props.runDetail, props.draft, m.agent.runIncomplete),
    [m.agent.runIncomplete, props.draft, props.runDetail],
  )
  const selectedRuntime = props.runtimes.find((runtime) => runtime.id === props.runtimeId)
  const mutation = useMutation({
    mutationFn: ({ message, snapshot }: { message: string; snapshot: AgentSnapshot }) =>
      api.flowAgentChat({ message, ...snapshot }),
    onSuccess: (response, variables) => {
      setFailedRequest(null)
      const messageId = idOf('agent')
      let conflict = false
      if (response.flowDraft) {
        const current = latestRef.current.draft
        if (!canApplyAgentRevision(variables.snapshot.flowDraft, current)) {
          conflict = true
        } else {
          props.onRevision({
            flowDraft: response.flowDraft,
            cfDrafts: response.cfDrafts ?? variables.snapshot.cfDrafts,
            previousDraft: variables.snapshot.flowDraft,
            previousCfDrafts: variables.snapshot.cfDrafts,
            messageId,
          })
        }
      }
      props.onMessagesChange((current) => [
        ...current,
        {
          id: messageId,
          role: 'assistant',
          body: conflict
            ? format(m.agent.canvasChanged, { message: response.message })
            : response.message,
          meta: response.fallback
            ? m.agent.localAnalysis
            : response.runtimeId
              ? format(m.agent.runtimeDraft, {
                  name:
                    props.runtimes.find((item) => item.id === response.runtimeId)?.name ??
                    response.runtimeId,
                })
              : m.agent.currentDraft,
          invocationId: response.invocationId,
        },
      ])
      props.onAttachmentsChange([])
    },
    onError: (error, variables) => {
      const errorMessageId = idOf('agent-error')
      setFailedRequest({ ...variables, errorMessageId })
      props.onMessagesChange((current) => [
        ...current,
        {
          id: errorMessageId,
          role: 'assistant',
          body: format(m.agent.cannotHandle, { detail: readableError(error, locale) }),
          invocationId: variables.snapshot.invocationId,
          meta: format(m.agent.unchangedMeta, {
            name:
              props.runtimes.find((item) => item.id === variables.snapshot.runtimeId)?.name ??
              variables.snapshot.runtimeId ??
              m.agent.localAnalysis,
          }),
        },
      ])
    },
  })

  const sendMessage = (rawMessage: string) => {
    const message = rawMessage.trim()
    if (!message || mutation.isPending || props.disabled) return
    const current = latestRef.current
    const invocationId = idOf('agent')
    const snapshot: AgentSnapshot = {
      invocationId,
      messageId: invocationId,
      runtimeId: current.runtimeId,
      flowDraft: structuredClone(current.draft),
      cfDrafts: structuredClone(current.cfDrafts),
      conversation: current.messages.slice(-8).map(({ role, body }) => ({ role, body })),
      runDetail: current.runDetail ? structuredClone(current.runDetail) : null,
      selection: { nodeId: current.selectedNodeId, edgeId: current.selectedEdgeId },
      check: { error: current.checkError },
      attachments: [...current.attachments],
    }
    props.onMessagesChange((messages) => [
      ...messages,
      { id: idOf('agent-user'), role: 'user', body: message },
    ])
    setFailedRequest(null)
    setInput('')
    mutation.mutate({ message, snapshot })
  }

  const retryFailedRequest = () => {
    if (!failedRequest || mutation.isPending || props.disabled) return
    mutation.mutate({
      message: failedRequest.message,
      snapshot: applyCurrentRuntime(failedRequest.snapshot, latestRef.current.runtimeId),
    })
  }

  const takeFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = snapshotFileList(event.currentTarget.files)
    event.currentTarget.value = ''
    props.onAttachmentsChange(mergeAttachments(props.attachments, picked))
  }

  return (
    <div className="agent-chat">
      <div className="agent-context">
        <div className="agent-context-heading">
          <span className="agent-icon">
            <Bot size={15} />
          </span>
          <div>
            <strong>{m.agent.title}</strong>
            <span>
              {format(m.agent.subtitle, { name: selectedRuntime?.name ?? m.agent.localAnalysis })}
            </span>
          </div>
          <span className="agent-live-mark" title={m.agent.liveMark} />
        </div>
        <div className="agent-context-facts">
          <span>{format(m.agent.tests, { count: props.testCount })}</span>
          <span>{format(m.agent.steps, { count: props.draft.nodes.length })}</span>
          <span>
            {props.runDetail ? runStatusLabel(props.runDetail.run.status, locale) : m.agent.noRun}
          </span>
        </div>
      </div>

      {failure && (
        <div className="agent-fault-context">
          <CircleAlert size={15} />
          <div>
            <strong>{failure.node ? m.agent.lastRunFailed : m.agent.flowRunFailed}</strong>
            <p>{failure.node ? `${failure.node.id} · ${failure.error}` : failure.error}</p>
          </div>
        </div>
      )}

      <div className="agent-messages" aria-live="polite">
        {!props.messages.length && (
          <div className="agent-empty">
            <span className="agent-empty-mark">
              <Wrench size={16} />
            </span>
            <strong>{m.agent.startTitle}</strong>
            <p>{m.agent.startBody}</p>
            <div className="agent-starters">
              {starterPrompts.map((prompt) => (
                <button key={prompt.label} type="button" onClick={() => setInput(prompt.value)}>
                  {prompt.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {props.messages.map((message) => (
          <article className={`agent-message is-${message.role}`} key={message.id}>
            <span className="agent-message-avatar">
              {message.role === 'user' ? (
                m.agent.you
              ) : (
                <img src="/cflow-mark.svg" alt="" aria-hidden="true" />
              )}
            </span>
            <div className="agent-message-body">
              <span className="agent-message-heading">
                <strong>{message.role === 'user' ? m.agent.you : m.agent.title}</strong>
                {message.invocationId && <AgentTracePopover invocationId={message.invocationId} />}
              </span>
              <p>{message.body}</p>
              {message.meta && <small>{message.meta}</small>}
              {message.id === props.undoMessageId && (
                <button type="button" className="agent-action" onClick={props.onUndoRevision}>
                  <Undo2 size={13} />
                  <span>
                    <strong>{m.agent.undo}</strong>
                  </span>
                </button>
              )}
              {message.id === failedRequest?.errorMessageId && (
                <button
                  type="button"
                  className="retry-button"
                  onClick={retryFailedRequest}
                  disabled={mutation.isPending || props.disabled}
                  title={m.agent.retryTitle}
                >
                  <RotateCcw size={13} />
                  {m.agent.retry}
                </button>
              )}
            </div>
          </article>
        ))}
        {mutation.isPending && (
          <article className="agent-message is-assistant">
            <span className="agent-message-avatar">
              <img src="/cflow-mark.svg" alt="" aria-hidden="true" />
            </span>
            <div className="agent-message-body">
              <span className="agent-message-heading">
                <strong>{m.agent.title}</strong>
                <AgentTracePopover
                  invocationId={(mutation.variables as any)?.snapshot?.invocationId}
                />
              </span>
              <p className="thinking">
                <LoaderCircle className="spin" size={13} /> {m.agent.thinking}
              </p>
            </div>
          </article>
        )}
      </div>

      <form
        className="agent-composer"
        onSubmit={(event) => {
          event.preventDefault()
          sendMessage(input)
        }}
      >
        {props.disabled && <p className="agent-disabled-note">{m.agent.disabled}</p>}
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder={m.agent.placeholder}
          aria-label={m.agent.inputAria}
          disabled={props.disabled || mutation.isPending}
        />
        {!!props.attachments.length && (
          <div className="agent-attachments" aria-label={m.agent.attachmentsAria}>
            <ul className="attachment-list">
              {props.attachments.slice(0, 3).map((file) => (
                <li key={attachmentName(file)} className="skill-attachment">
                  <FileText size={14} aria-hidden="true" />
                  <span title={attachmentName(file)}>{attachmentName(file)}</span>
                  <button
                    type="button"
                    aria-label={format(m.goal.remove, { name: attachmentName(file) })}
                    onClick={() =>
                      props.onAttachmentsChange(
                        props.attachments.filter(
                          (item) => attachmentName(item) !== attachmentName(file),
                        ),
                      )
                    }
                    disabled={mutation.isPending}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {props.attachments.length > 3 && (
              <p className="attachment-overflow">
                {format(m.agent.moreFiles, { count: props.attachments.length - 3 })}
              </p>
            )}
            <button
              className="button signal full"
              type="button"
              disabled={mutation.isPending || props.disabled}
              onClick={() => sendMessage(input || m.agent.defaultAdjust)}
            >
              {mutation.isPending ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Wrench size={14} />
              )}
              {m.agent.adjust}
            </button>
          </div>
        )}
        <div className="agent-composer-footer">
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            multiple
            accept={TEXT_ACCEPT}
            onChange={takeFiles}
          />
          <button
            className="attachment-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={mutation.isPending || props.disabled}
            title={m.agent.pickSkillTitle}
          >
            <Wrench size={13} /> {m.agent.pickSkill}
          </button>
          <label
            className={`runtime-select is-${selectedRuntime ? runtimeStatus(selectedRuntime) : 'checking'}`}
          >
            <span className="status-lamp" />
            <select
              value={props.runtimeId}
              onChange={(event) => props.onRuntimeChange(event.target.value)}
              aria-label={m.agent.runtimeAria}
              disabled={mutation.isPending || props.disabled}
            >
              {props.runtimes.map((runtime) => (
                <option
                  key={runtime.id}
                  value={runtime.id}
                  disabled={runtimeStatus(runtime) !== 'available'}
                >
                  {runtime.name}
                </option>
              ))}
            </select>
          </label>
          <span className="toolbar-spacer" />
          <button
            className="send-button"
            type="submit"
            disabled={!input.trim() || mutation.isPending || props.disabled}
            aria-label={m.agent.sendAria}
          >
            <Send size={15} />
          </button>
        </div>
      </form>
    </div>
  )
}
