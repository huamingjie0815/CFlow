import { useMemo, useRef, useState } from 'react'
import { Bot, CircleAlert, FileText, LoaderCircle, Send, Undo2, Wrench, X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { api, readableError } from '../api'
import { runStatusLabel } from '../copy'
import {
  attachmentName,
  canApplyAgentRevision,
  mergeAttachments,
  snapshotFileList,
} from '../workbench-ui'
import type { AgentChatMessage, CFDraft, FlowDraft, RunDetail, RuntimeWithHealth } from '../types'

type MessageUpdate = AgentChatMessage[] | ((current: AgentChatMessage[]) => AgentChatMessage[])

type AgentSnapshot = {
  runtimeId?: string
  flowDraft: FlowDraft
  cfDrafts: CFDraft[]
  conversation: { role: 'user' | 'assistant'; body: string }[]
  runDetail: RunDetail | null
  selection: { nodeId: string | null; edgeId: string | null }
  check: { error: string | null }
  attachments: File[]
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

const starterPrompts = [
  { label: '优化当前流程', value: '请直接优化当前流程，保留合理步骤并修正最明显的问题。' },
  { label: '解释最近错误', value: '请定位最近一次运行失败的原因，只解释，不修改流程。' },
  { label: '检查数据交接', value: '请检查步骤之间的输入输出交接，只指出可能的问题。' },
]

function idOf(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function failureContext(runDetail: RunDetail | null, draft: FlowDraft) {
  if (!runDetail) return null
  const event = [...runDetail.events]
    .reverse()
    .find((item) => item.type === 'node.failed' || item.type === 'run.failed')
  if (!event) return null
  const node = event.node == null ? null : draft.nodes[event.node]
  const error =
    event.data && typeof event.data === 'object' && 'error' in event.data
      ? String(event.data.error)
      : '运行没有完成。'
  return { node, error }
}

export function FlowAgentChat(props: FlowAgentChatProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState('')
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
    () => failureContext(props.runDetail, props.draft),
    [props.draft, props.runDetail],
  )
  const selectedRuntime = props.runtimes.find((runtime) => runtime.id === props.runtimeId)
  const mutation = useMutation({
    mutationFn: ({ message, snapshot }: { message: string; snapshot: AgentSnapshot }) =>
      api.flowAgentChat({ message, ...snapshot }),
    onSuccess: (response, variables) => {
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
            ? `${response.message} 请求期间画布已被手工修改，因此没有覆盖当前草稿。`
            : response.message,
          meta: response.fallback
            ? '本地流程分析'
            : response.runtimeId
              ? `${props.runtimes.find((item) => item.id === response.runtimeId)?.name ?? response.runtimeId} · 当前草稿`
              : '当前草稿',
        },
      ])
      props.onAttachmentsChange([])
    },
    onError: (error) => {
      props.onMessagesChange((current) => [
        ...current,
        {
          id: idOf('agent-error'),
          role: 'assistant',
          body: `暂时无法处理：${readableError(error)}`,
          meta: '当前草稿未修改',
        },
      ])
    },
  })

  const sendMessage = (rawMessage: string) => {
    const message = rawMessage.trim()
    if (!message || mutation.isPending || props.disabled) return
    const current = latestRef.current
    const snapshot: AgentSnapshot = {
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
    setInput('')
    mutation.mutate({ message, snapshot })
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
            <strong>流程助手</strong>
            <span>{selectedRuntime?.name ?? '本地流程分析'} · 会直接更新当前草稿</span>
          </div>
          <span className="agent-live-mark" title="发送时读取当前工作台快照" />
        </div>
        <div className="agent-context-facts">
          <span>测试 {props.testCount} 次</span>
          <span>{props.draft.nodes.length} 步骤</span>
          <span>{props.runDetail ? runStatusLabel(props.runDetail.run.status) : '暂无运行'}</span>
        </div>
      </div>

      {failure && (
        <div className="agent-fault-context">
          <CircleAlert size={15} />
          <div>
            <strong>{failure.node ? '最近一次运行失败' : '流程运行失败'}</strong>
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
            <strong>从当前草稿开始</strong>
            <p>可以询问当前步骤和运行结果，也可以直接描述要怎么调整。</p>
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
                '你'
              ) : (
                <img src="/cflow-mark.svg" alt="" aria-hidden="true" />
              )}
            </span>
            <div className="agent-message-body">
              <strong>{message.role === 'user' ? '你' : '流程助手'}</strong>
              <p>{message.body}</p>
              {message.meta && <small>{message.meta}</small>}
              {message.id === props.undoMessageId && (
                <button type="button" className="agent-action" onClick={props.onUndoRevision}>
                  <Undo2 size={13} />
                  <span>
                    <strong>撤销上次助手修改</strong>
                  </span>
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
              <strong>流程助手</strong>
              <p className="thinking">
                <LoaderCircle className="spin" size={13} /> 正在读取当前草稿并处理…
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
        {props.disabled && (
          <p className="agent-disabled-note">工作目录不可用。恢复原路径后才能继续使用流程助手。</p>
        )}
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="询问当前流程，或直接描述要怎么改…"
          aria-label="询问流程助手"
          disabled={props.disabled || mutation.isPending}
        />
        {!!props.attachments.length && (
          <div className="agent-attachments" aria-label="已选择的 Skill">
            <ul className="attachment-list">
              {props.attachments.slice(0, 3).map((file) => (
                <li key={attachmentName(file)} className="skill-attachment">
                  <FileText size={14} aria-hidden="true" />
                  <span title={attachmentName(file)}>{attachmentName(file)}</span>
                  <button
                    type="button"
                    aria-label={`移除 ${attachmentName(file)}`}
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
                另有 {props.attachments.length - 3} 个文件已选择
              </p>
            )}
            <button
              className="button signal full"
              type="button"
              disabled={mutation.isPending || props.disabled}
              onClick={() => sendMessage(input || '请依据这些 skill 附件调整当前流程。')}
            >
              {mutation.isPending ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Wrench size={14} />
              )}
              调整当前流程
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
            title="选择 Skill 文件以调整当前流程"
          >
            <Wrench size={13} /> 选择 Skill
          </button>
          <span className="toolbar-spacer" />
          <button
            className="send-button"
            type="submit"
            disabled={!input.trim() || mutation.isPending || props.disabled}
            aria-label="发送消息"
          >
            <Send size={15} />
          </button>
        </div>
      </form>
    </div>
  )
}
