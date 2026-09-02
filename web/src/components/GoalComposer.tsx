import { FileText, LoaderCircle, RotateCcw, Send, Split, Wrench, X } from 'lucide-react'
import { useRef } from 'react'
import {
  attachmentName,
  attachmentSize,
  mergeAttachments,
  runtimeStatus,
  snapshotFileList,
} from '../workbench-ui'
import type { AgentChatMessage, RuntimeWithHealth } from '../types'
import { AgentTracePopover } from './AgentTracePopover'

const TEXT_ACCEPT = '.md,.mdx,.txt,.json,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.sh'

type GoalComposerProps = {
  /** Shown above the composer so the goal turn reads as the start of the chat. */
  messages: AgentChatMessage[]
  isPending: boolean
  goal: string
  attachments: File[]
  runtimes: RuntimeWithHealth[]
  runtimeId: string
  canSubmit: boolean
  onGoalChange: (goal: string) => void
  onAttachmentsChange: (files: File[]) => void
  onRuntimeChange: (id: string) => void
  onSubmit: () => void
  retryMessageId?: string
  pendingInvocationId?: string
  onRetry: () => void
}

/**
 * The empty-state centre column: say what you want done, optionally attach a
 * skill document, pick which local agent reads it. Once a flow exists this
 * conversation continues in the right-hand assistant panel.
 */
export function GoalComposer(props: GoalComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selected = props.runtimes.find((runtime) => runtime.id === props.runtimeId)
  const take = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = snapshotFileList(event.currentTarget.files)
    event.currentTarget.value = ''
    props.onAttachmentsChange(mergeAttachments(props.attachments, picked))
  }

  return (
    <section className="goal-view" aria-label="描述目标">
      <div className="goal-scroll">
        {!props.messages.length && (
          <div className="goal-intro">
            <div className="signal-emblem">
              <Split size={24} />
            </div>
            <span className="view-kicker">从一句话开始</span>
            <h2>先说你想完成什么</h2>
            <p>助手会把目标拆成一串可以调整的步骤。你确认无误后，依次检查、试运行，最后发布。</p>
          </div>
        )}
        <div className="messages">
          {props.messages.map((message) => (
            <article className={`message is-${message.role}`} key={message.id}>
              <span className="message-avatar">
                {message.role === 'user' ? (
                  '你'
                ) : (
                  <img src="/cflow-mark.svg" alt="" aria-hidden="true" />
                )}
              </span>
              <div>
                <span className="agent-message-heading">
                  <strong>{message.role === 'user' ? '你' : '流程助手'}</strong>
                  {message.invocationId && (
                    <AgentTracePopover invocationId={message.invocationId} />
                  )}
                </span>
                <p>{message.body}</p>
                {message.meta && <small>{message.meta}</small>}
                {message.id === props.retryMessageId && (
                  <button type="button" className="retry-button" onClick={props.onRetry}>
                    <RotateCcw size={13} />
                    重试
                  </button>
                )}
              </div>
            </article>
          ))}
          {props.isPending && (
            <article className="message is-assistant">
              <span className="message-avatar">
                <img src="/cflow-mark.svg" alt="" aria-hidden="true" />
              </span>
              <div>
                <span className="agent-message-heading">
                  <strong>流程助手</strong>
                  <AgentTracePopover invocationId={props.pendingInvocationId} />
                </span>
                <p className="thinking">
                  <LoaderCircle className="spin" size={14} />
                  正在根据你的目标挑选步骤…
                </p>
              </div>
            </article>
          )}
        </div>
      </div>

      <form
        className="goal-composer"
        onSubmit={(event) => {
          event.preventDefault()
          props.onSubmit()
        }}
      >
        <textarea
          value={props.goal}
          onChange={(event) => props.onGoalChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="例如：收到报销单后核对发票，金额超过 2000 元的先请主管确认，再录入台账并回复申请人"
          aria-label="你想完成的目标"
        />
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept={TEXT_ACCEPT}
          onChange={take}
        />
        {!!props.attachments.length && (
          <div className="skill-attachments" aria-label="已选择的 Skill">
            <div className="attachment-summary" role="status" aria-live="polite">
              <div>
                <strong>
                  {props.isPending
                    ? `正在提交 ${props.attachments.length} 个 Skill 文件`
                    : `已选择 ${props.attachments.length} 个 Skill 文件`}
                </strong>
                <span>{props.isPending ? '正在上传并分析' : '发送目标时上传'}</span>
              </div>
              <button
                type="button"
                className="attachment-clear"
                onClick={() => props.onAttachmentsChange([])}
                disabled={props.isPending}
              >
                清空
              </button>
            </div>
            <ul className="attachment-list">
              {props.attachments.slice(0, 4).map((file) => (
                <li key={attachmentName(file)} className="skill-attachment">
                  <FileText size={15} aria-hidden="true" />
                  <span title={attachmentName(file)}>{attachmentName(file)}</span>
                  <small>{attachmentSize(file)}</small>
                  <button
                    type="button"
                    aria-label={`移除 ${attachmentName(file)}`}
                    title={`移除 ${attachmentName(file)}`}
                    onClick={() =>
                      props.onAttachmentsChange(
                        props.attachments.filter(
                          (item) => attachmentName(item) !== attachmentName(file),
                        ),
                      )
                    }
                    disabled={props.isPending}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {props.attachments.length > 4 && (
              <p className="attachment-overflow">
                另有 {props.attachments.length - 4} 个文件已选择
              </p>
            )}
          </div>
        )}
        <div className="composer-footer">
          <button
            className="attachment-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={props.isPending}
            title="选择 Skill 文件"
          >
            <Wrench size={14} /> 选择 Skill
          </button>
          <label className={`runtime-select is-${selected ? runtimeStatus(selected) : 'checking'}`}>
            <span className="status-lamp" />
            <select
              value={props.runtimeId}
              onChange={(event) => props.onRuntimeChange(event.target.value)}
              aria-label="用哪个助手生成"
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
          <span>
            {selected?.health?.status === 'available'
              ? `${selected.name} 可以使用`
              : '请选择一个可用的助手'}
          </span>
          <button
            className="send-button"
            type="submit"
            disabled={!props.canSubmit || props.isPending}
            aria-label="根据目标生成流程"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </section>
  )
}
