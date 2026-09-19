import { FileText, LoaderCircle, RotateCcw, Send, Split, Workflow, Wrench, X } from 'lucide-react'
import { useRef } from 'react'
import {
  attachmentName,
  attachmentSize,
  mergeAttachments,
  runtimeStatus,
  snapshotFileList,
} from '../workbench-ui'
import { format } from '../i18n'
import { useLocale } from '../locale-context'
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
  onAddDemo?: () => void
  onCreateBlank?: () => void
  isAddingDemo?: boolean
}

/**
 * The empty-state centre column: say what you want done, optionally attach a
 * skill document, pick which local agent reads it. Once a flow exists this
 * conversation continues in the right-hand assistant panel.
 */
export function GoalComposer(props: GoalComposerProps) {
  const { m } = useLocale()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selected = props.runtimes.find((runtime) => runtime.id === props.runtimeId)
  const take = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = snapshotFileList(event.currentTarget.files)
    event.currentTarget.value = ''
    props.onAttachmentsChange(mergeAttachments(props.attachments, picked))
  }

  return (
    <section className="goal-view" aria-label={m.goal.aria}>
      <div className="goal-scroll">
        {!props.messages.length && (
          <div className="goal-intro">
            <div className="signal-emblem">
              <Split size={24} />
            </div>
            <span className="view-kicker">{m.goal.kicker}</span>
            <h2>{m.goal.title}</h2>
            <p>{m.goal.body}</p>
            {props.onAddDemo && (
              <div className="goal-demo">
                <button
                  type="button"
                  className="goal-demo-button"
                  onClick={props.onAddDemo}
                  disabled={props.isPending || props.isAddingDemo}
                >
                  {props.isAddingDemo ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Workflow size={14} />
                  )}
                  {m.goal.addDemo}
                </button>
                <span>{m.goal.addDemoHint}</span>
                {props.onCreateBlank && (
                  <button
                    type="button"
                    className="goal-demo-button"
                    onClick={props.onCreateBlank}
                    disabled={props.isPending}
                  >
                    <FileText size={14} />
                    {m.goal.blank}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <div className="messages">
          {props.messages.map((message) => (
            <article className={`message is-${message.role}`} key={message.id}>
              <span className="message-avatar">
                {message.role === 'user' ? (
                  m.goal.you
                ) : (
                  <img src="/cflow-mark.svg" alt="" aria-hidden="true" />
                )}
              </span>
              <div>
                <span className="agent-message-heading">
                  <strong>{message.role === 'user' ? m.goal.you : m.goal.assistant}</strong>
                  {message.invocationId && (
                    <AgentTracePopover invocationId={message.invocationId} />
                  )}
                </span>
                <p>{message.body}</p>
                {message.meta && <small>{message.meta}</small>}
                {message.id === props.retryMessageId && (
                  <button type="button" className="retry-button" onClick={props.onRetry}>
                    <RotateCcw size={13} />
                    {m.goal.retry}
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
                  <strong>{m.goal.assistant}</strong>
                  <AgentTracePopover invocationId={props.pendingInvocationId} />
                </span>
                <p className="thinking">
                  <LoaderCircle className="spin" size={14} />
                  {m.goal.thinking}
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
          placeholder={m.goal.placeholder}
          aria-label={m.goal.goalAria}
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
          <div className="skill-attachments" aria-label={m.goal.attachmentsAria}>
            <div className="attachment-summary" role="status" aria-live="polite">
              <div>
                <strong>
                  {props.isPending
                    ? format(m.goal.submittingFiles, { count: props.attachments.length })
                    : format(m.goal.selectedFiles, { count: props.attachments.length })}
                </strong>
                <span>{props.isPending ? m.goal.uploading : m.goal.uploadOnSend}</span>
              </div>
              <button
                type="button"
                className="attachment-clear"
                onClick={() => props.onAttachmentsChange([])}
                disabled={props.isPending}
              >
                {m.goal.clear}
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
                    aria-label={format(m.goal.remove, { name: attachmentName(file) })}
                    title={format(m.goal.remove, { name: attachmentName(file) })}
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
                {format(m.goal.moreFiles, { count: props.attachments.length - 4 })}
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
            title={m.goal.pickSkill}
          >
            <Wrench size={14} /> {m.goal.pickSkillLabel}
          </button>
          <label className={`runtime-select is-${selected ? runtimeStatus(selected) : 'checking'}`}>
            <span className="status-lamp" />
            <select
              value={props.runtimeId}
              onChange={(event) => props.onRuntimeChange(event.target.value)}
              aria-label={m.goal.runtimeAria}
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
              ? format(m.goal.runtimeReady, { name: selected.name })
              : m.goal.pickRuntime}
          </span>
          <button
            className="send-button"
            type="submit"
            disabled={!props.canSubmit || props.isPending}
            aria-label={m.goal.sendAria}
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </section>
  )
}
