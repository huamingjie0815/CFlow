import type { FileExtractionInput, FlowDraft, FlowNode } from '../../../src/types'
import { useLocale } from '../locale-context'
import { FileReferencePicker } from './FileReferencePicker'

export function FileExtractionSettings({
  node,
  draft,
  onChange,
}: {
  node: Extract<FlowNode, { kind: 'cf-call' }>
  draft: FlowDraft
  onChange: (node: FlowNode) => void
}) {
  const { m } = useLocale()
  const config = node.toolInput ?? { source: { kind: 'files' as const, paths: [] } }
  const source = config.source
  const upstream = draft.nodes.filter((item) =>
    draft.edges.some((edge) => edge.from === item.id && edge.to === node.id),
  )
  const update = (patch: Partial<FileExtractionInput>) =>
    onChange({ ...node, toolInput: { ...config, ...patch } })
  return (
    <div className="extraction-settings">
      <div className="property-list">
        <div>
          <span>{m.extraction.executor}</span>
          <strong>{m.extraction.local}</strong>
        </div>
        <div>
          <span>{m.extraction.permission}</span>
          <strong>{m.extraction.readOnly}</strong>
        </div>
      </div>
      <label className="field">
        <span>{m.extraction.stepName}</span>
        <input
          value={node.name ?? m.extraction.defaultName}
          onChange={(event) => onChange({ ...node, name: event.target.value })}
        />
      </label>
      <div className="field">
        <span>{m.extraction.source}</span>
        <div className="extraction-source-modes" role="group" aria-label={m.extraction.source}>
          {(
            [
              ['files', m.extraction.files],
              ['flow-input', m.extraction.flowInput],
              ['upstream', m.extraction.upstream],
            ] as const
          ).map(([kind, label]) => (
            <button
              type="button"
              key={kind}
              aria-pressed={source.kind === kind}
              onClick={() => {
                if (source.kind === kind) return
                update({
                  source:
                    kind === 'files'
                      ? { kind, paths: [] }
                      : kind === 'flow-input'
                        ? { kind, pointer: '/files' }
                        : { kind, nodeId: upstream[0]?.id ?? '', pointer: '/files' },
                })
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {source.kind === 'files' ? (
        <FileReferencePicker
          active
          mode="extract"
          references={source.paths}
          onChange={(paths) => update({ source: { kind: 'files', paths } })}
        />
      ) : (
        <>
          {source.kind === 'upstream' && (
            <label className="field">
              <span>{m.extraction.sourceStep}</span>
              <select
                value={source.nodeId}
                onChange={(event) => update({ source: { ...source, nodeId: event.target.value } })}
              >
                <option value="">{m.extraction.pickUpstream}</option>
                {upstream.map((item) => (
                  <option key={item.id} value={item.id}>
                    {'name' in item && item.name
                      ? item.name
                      : item.kind === 'cf-call'
                        ? m.extraction.capabilityStep
                        : item.kind === 'join'
                          ? m.extraction.join
                          : m.extraction.branch}{' '}
                    ({draft.nodes.indexOf(item) + 1})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>{m.extraction.pathField}</span>
            <input
              value={source.pointer}
              placeholder="/files"
              onChange={(event) => update({ source: { ...source, pointer: event.target.value } })}
            />
          </label>
        </>
      )}
      <label className="field">
        <span>{m.extraction.encoding}</span>
        <select
          value={config.encoding ?? 'utf-8'}
          onChange={(event) =>
            update({ encoding: event.target.value as FileExtractionInput['encoding'] })
          }
        >
          <option value="utf-8">{m.extraction.encodingUtf8}</option>
          <option value="gb18030">{m.extraction.encodingGb}</option>
        </select>
      </label>
      <label className="field">
        <span>{m.extraction.maxChars}</span>
        <input
          type="number"
          min={1}
          step={1}
          placeholder={m.extraction.noLimit}
          value={config.maxChars ?? ''}
          onChange={(event) =>
            update({ maxChars: event.target.value === '' ? undefined : Number(event.target.value) })
          }
        />
      </label>
    </div>
  )
}
