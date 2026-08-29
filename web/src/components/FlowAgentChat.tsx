import { useMemo, useState } from 'react'
import { Bot, CircleAlert, Crosshair, LoaderCircle, Send, Wrench } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { api, readableError } from '../api'
import { runStatusLabel } from '../copy'
import type {
  AgentChatAction,
  AgentChatMessage,
  CFDraft,
  FlowDraft,
  RunDetail,
  RuntimeWithHealth,
} from '../types'

type FlowAgentChatProps = {
  draft: FlowDraft | null
  cfDrafts: CFDraft[]
  runDetail: RunDetail | null
  messages: AgentChatMessage[]
  runtimes: RuntimeWithHealth[]
  runtimeId?: string
  onMessagesChange: (messages: AgentChatMessage[]) => void
  onApplyAction: (action: AgentChatAction) => void
}

const starterPrompts = [
  { label: '优化当前流程', value: '请检查当前流程，给出最值得优先做的优化建议。' },
  { label: '解释最近错误', value: '请定位最近一次运行失败的原因，并告诉我怎么修复。' },
  { label: '检查数据交接', value: '请检查步骤之间的输入输出交接，指出可能的问题。' },
]

function idOf(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function failureContext(runDetail: RunDetail | null, draft: FlowDraft | null) {
  if (!runDetail || !draft) return null
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
  const [input, setInput] = useState('')
  const failure = useMemo(
    () => failureContext(props.runDetail, props.draft),
    [props.draft, props.runDetail],
  )
  const selectedRuntime = props.runtimes.find((runtime) => runtime.id === props.runtimeId)
  const mutation = useMutation({
    mutationFn: (message: string) =>
      api.flowAgentChat({
        message,
        runtimeId: props.runtimeId,
        flowDraft: props.draft,
        cfDrafts: props.cfDrafts,
        runDetail: props.runDetail,
      }),
    onSuccess: (response) => {
      props.onMessagesChange([
        ...props.messages,
        {
          id: idOf('agent'),
          role: 'assistant',
          body: response.message,
          actions: response.actions,
          meta: response.fallback
            ? '本地流程分析'
            : response.runtimeId
              ? `${selectedRuntime?.name ?? response.runtimeId} · 流程上下文`
              : '流程上下文',
        },
      ])
    },
    onError: (error) => {
      props.onMessagesChange([
        ...props.messages,
        {
          id: idOf('agent-error'),
          role: 'assistant',
          body: `暂时无法取得分析：${readableError(error)}`,
          meta: '请检查助手连接后重试',
        },
      ])
    },
  })

  const sendMessage = (message: string) => {
    if (!message || mutation.isPending) return
    props.onMessagesChange([
      ...props.messages,
      { id: idOf('agent-user'), role: 'user', body: message },
    ])
    setInput('')
    mutation.mutate(message)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    sendMessage(input.trim())
  }

  const sendStarter = (message: string) => {
    setInput(message)
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
            <span>{selectedRuntime?.name ?? '本地流程分析'} · 建议需确认</span>
          </div>
          <span className="agent-live-mark" title="当前上下文已加载" />
        </div>
        <div className="agent-context-facts">
          <span>{props.draft ? `第 ${props.draft.revision} 稿` : '尚未创建流程'}</span>
          <span>{props.draft ? `${props.draft.nodes.length} 步骤` : '等待流程'}</span>
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
            <strong>从当前现场开始排查</strong>
            <p>助手会读取流程结构和运行证据，先给建议，再由你决定是否应用。</p>
            <div className="agent-starters">
              {starterPrompts.map((prompt) => (
                <button key={prompt.label} type="button" onClick={() => sendStarter(prompt.value)}>
                  {prompt.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {props.messages.map((message) => (
          <article className={`agent-message is-${message.role}`} key={message.id}>
            <span className="agent-message-avatar">
              {message.role === 'user' ? '你' : <Bot size={13} />}
            </span>
            <div className="agent-message-body">
              <strong>{message.role === 'user' ? '你' : '流程助手'}</strong>
              <p>{message.body}</p>
              {message.meta && <small>{message.meta}</small>}
              {!!message.actions?.length && (
                <div className="agent-actions">
                  {message.actions.map((action) => (
                    <button
                      key={`${message.id}-${action.type}-${action.nodeId ?? ''}`}
                      type="button"
                      className="agent-action"
                      onClick={() => props.onApplyAction(action)}
                    >
                      {action.type === 'select-node' ? (
                        <Crosshair size={13} />
                      ) : (
                        <Wrench size={13} />
                      )}
                      <span>
                        <strong>
                          {['retry-node', 'update-node', 'update-binding'].includes(action.type)
                            ? `应用建议：${action.label}`
                            : action.label}
                        </strong>
                        <small>{action.description}</small>
                      </span>
                    </button>
                  ))}
                  {message.role === 'assistant' &&
                    message.actions.every((action) =>
                      ['select-node', 'open-activity'].includes(action.type),
                    ) && (
                      <button
                        type="button"
                        className="agent-action agent-action-promote"
                        onClick={() =>
                          sendMessage(
                            '请把上一条诊断转换成可以直接应用的配置修复。若涉及输入输出，请返回 exact update-binding；若涉及节点策略，请返回 update-node。不要只返回检查或定位动作。',
                          )
                        }
                      >
                        <Wrench size={13} />
                        <span>
                          <strong>生成可应用修复</strong>
                          <small>让助手把当前诊断转换成可确认的流程配置变更。</small>
                        </span>
                      </button>
                    )}
                </div>
              )}
            </div>
          </article>
        ))}
        {mutation.isPending && (
          <article className="agent-message is-assistant">
            <span className="agent-message-avatar">
              <Bot size={13} />
            </span>
            <div className="agent-message-body">
              <strong>流程助手</strong>
              <p className="thinking">
                <LoaderCircle className="spin" size={13} /> 正在核对流程和运行证据…
              </p>
            </div>
          </article>
        )}
      </div>

      <form className="agent-composer" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="问问当前流程，或描述你遇到的错误…"
          aria-label="询问流程助手"
        />
        <div className="agent-composer-footer">
          <span>上下文：当前 Flow + 最近运行</span>
          <button
            className="send-button"
            type="submit"
            disabled={!input.trim() || mutation.isPending}
            aria-label="发送消息"
          >
            <Send size={15} />
          </button>
        </div>
      </form>
    </div>
  )
}
