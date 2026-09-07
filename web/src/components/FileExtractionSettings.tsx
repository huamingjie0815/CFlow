import type { FileExtractionInput, FlowDraft, FlowNode } from '../../../src/types'
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
          <span>由谁执行</span>
          <strong>本地解析</strong>
        </div>
        <div>
          <span>文件权限</span>
          <strong>只读</strong>
        </div>
      </div>
      <label className="field">
        <span>步骤名称</span>
        <input
          value={node.name ?? '文件内容提取'}
          onChange={(event) => onChange({ ...node, name: event.target.value })}
        />
      </label>
      <div className="field">
        <span>文件来源</span>
        <div className="extraction-source-modes" role="group" aria-label="文件来源">
          {(
            [
              ['files', '选择文件'],
              ['flow-input', '流程输入'],
              ['upstream', '上游结果'],
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
              <span>来源步骤</span>
              <select
                value={source.nodeId}
                onChange={(event) => update({ source: { ...source, nodeId: event.target.value } })}
              >
                <option value="">选择直接上游步骤</option>
                {upstream.map((item) => (
                  <option key={item.id} value={item.id}>
                    {'name' in item && item.name
                      ? item.name
                      : item.kind === 'cf-call'
                        ? '能力步骤'
                        : item.kind === 'join'
                          ? '汇合'
                          : '分支'}{' '}
                    ({draft.nodes.indexOf(item) + 1})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>文件路径字段（JSON Pointer）</span>
            <input
              value={source.pointer}
              placeholder="/files"
              onChange={(event) => update({ source: { ...source, pointer: event.target.value } })}
            />
          </label>
        </>
      )}
      <label className="field">
        <span>文本编码</span>
        <select
          value={config.encoding ?? 'utf-8'}
          onChange={(event) =>
            update({ encoding: event.target.value as FileExtractionInput['encoding'] })
          }
        >
          <option value="utf-8">UTF-8 / BOM 自动识别</option>
          <option value="gb18030">GB18030（中文文本）</option>
        </select>
      </label>
      <label className="field">
        <span>每文件字符上限</span>
        <input
          type="number"
          min={1}
          step={1}
          placeholder="不截断"
          value={config.maxChars ?? ''}
          onChange={(event) =>
            update({ maxChars: event.target.value === '' ? undefined : Number(event.target.value) })
          }
        />
      </label>
    </div>
  )
}
