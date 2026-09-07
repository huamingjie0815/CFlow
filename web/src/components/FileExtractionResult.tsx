import { Check, Copy, Download } from 'lucide-react'
import { useState } from 'react'
import type { FileExtractionResult as Result } from '../../../src/types'

export function FileExtractionResult({ result }: { result: Result }) {
  const [index, setIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [opened, setOpened] = useState(false)
  const [structureOpen, setStructureOpen] = useState(false)
  const doc = result.documents[index] ?? result.documents[0]
  if (!doc) return null
  const download = () => {
    const url = URL.createObjectURL(new Blob([doc.text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${doc.path.split('/').pop()}.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <details
      className="extraction-result"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>
        提取内容 · {result.succeeded} 个成功{result.failed ? ` · ${result.failed} 个失败` : ''}
      </summary>
      {opened && (
        <>
          <div className="extraction-result-toolbar">
            <select
              aria-label="查看文件提取结果"
              value={index}
              onChange={(event) => {
                setIndex(Number(event.target.value))
                setCopied(false)
                setCopyError(false)
                setStructureOpen(false)
              }}
            >
              {result.documents.map((item, i) => (
                <option key={item.path} value={i}>
                  {item.path}
                  {item.status === 'failed' ? ' · 失败' : item.truncated ? ' · 已截断' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              title={copied ? '已复制' : '复制正文'}
              aria-label={copied ? '已复制' : '复制正文'}
              disabled={doc.status === 'failed'}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(doc.text)
                  setCopied(true)
                  setCopyError(false)
                } catch {
                  setCopyError(true)
                }
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button
              type="button"
              className="icon-button"
              title="下载正文"
              aria-label="下载正文"
              disabled={doc.status === 'failed'}
              onClick={download}
            >
              <Download size={14} />
            </button>
          </div>
          {copyError && <p role="alert">无法访问剪贴板，请下载正文。</p>}
          {doc.error ? (
            <p className="effect-warning" role="status">
              {doc.error.message}
            </p>
          ) : (
            <>
              <p className="extraction-count">
                {doc.text.length.toLocaleString()} 字符
                {doc.truncated ? ` / 共 ${doc.originalChars.toLocaleString()} 字符 · 已截断` : ''}
              </p>
              {doc.warnings.length > 0 && (
                <div className="extraction-warnings" role="status">
                  {doc.warnings.map((warning, i) => (
                    <p key={i}>{warning}</p>
                  ))}
                </div>
              )}
              <pre className="extracted-text">{doc.text || '（空文件）'}</pre>
              <details
                className="extraction-structure"
                open={structureOpen}
                onToggle={(event) => setStructureOpen(event.currentTarget.open)}
              >
                <summary>来源与表格 · {doc.blocks.length} 个内容块</summary>
                {structureOpen &&
                  doc.blocks.map((block, i) => {
                    let occupied: { start: number; end: number; until: number }[] = []
                    return (
                      <div className="extraction-block" key={i}>
                        <small>
                          {[
                            block.page ? `第 ${block.page} 页` : '',
                            block.slide ? `第 ${block.slide} 张幻灯片` : '',
                            block.sheet ? `工作表 ${block.sheet}` : '',
                            block.kind === 'note' ? '备注' : '',
                            `字符 ${block.start + 1}–${block.end}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                        {block.rows ? (
                          <div className="extraction-table-scroll">
                            <table>
                              <tbody>
                                {block.rows.map((row, r) => {
                                  const rowNumber = row[0]?.row ?? r
                                  occupied = occupied.filter((span) => span.until > rowNumber)
                                  const inheritedSpans = [...occupied]
                                  for (const cell of row) {
                                    if ((cell.rowSpan ?? 1) > 1)
                                      occupied.push({
                                        start: cell.column,
                                        end: cell.column + (cell.colSpan ?? 1),
                                        until: cell.row + cell.rowSpan!,
                                      })
                                  }
                                  return (
                                    <tr key={r}>
                                      <th scope="row">{(row[0]?.row ?? r) + 1}</th>
                                      {row.flatMap((cell, c) => {
                                        const previous = row[c - 1]
                                        const gapStart = previous
                                          ? previous.column + (previous.colSpan ?? 1)
                                          : 0
                                        const gap =
                                          cell.column -
                                          gapStart -
                                          inheritedSpans.reduce(
                                            (count, span) =>
                                              count +
                                              Math.max(
                                                0,
                                                Math.min(cell.column, span.end) -
                                                  Math.max(gapStart, span.start),
                                              ),
                                            0,
                                          )
                                        return [
                                          gap > 0 ? <td key={`gap-${c}`} colSpan={gap} /> : null,
                                          <td
                                            key={c}
                                            title={`行 ${cell.row + 1}，列 ${cell.column + 1}`}
                                            colSpan={cell.colSpan}
                                            rowSpan={cell.rowSpan}
                                          >
                                            {doc.text.slice(cell.start, cell.end)}
                                          </td>,
                                        ]
                                      })}
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p>{doc.text.slice(block.start, block.end)}</p>
                        )}
                      </div>
                    )
                  })}
              </details>
            </>
          )}
        </>
      )}
    </details>
  )
}
