import { Check, Copy, Download } from 'lucide-react'
import { useState } from 'react'
import type { FileExtractionResult as Result } from '../../../src/types'
import { format } from '../i18n'
import { useLocale } from '../locale-context'

export function FileExtractionResult({ result }: { result: Result }) {
  const { m } = useLocale()
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
        {format(m.extraction.heading, { succeeded: result.succeeded })}
        {result.failed ? format(m.extraction.failedCount, { count: result.failed }) : ''}
      </summary>
      {opened && (
        <>
          <div className="extraction-result-toolbar">
            <select
              aria-label={m.extraction.view}
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
                  {item.status === 'failed'
                    ? m.extraction.failed
                    : item.truncated
                      ? m.extraction.truncated
                      : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              title={copied ? m.extraction.copied : m.extraction.copy}
              aria-label={copied ? m.extraction.copied : m.extraction.copy}
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
              title={m.extraction.download}
              aria-label={m.extraction.download}
              disabled={doc.status === 'failed'}
              onClick={download}
            >
              <Download size={14} />
            </button>
          </div>
          {copyError && <p role="alert">{m.extraction.clipboard}</p>}
          {doc.error ? (
            <p className="effect-warning" role="status">
              {doc.error.message}
            </p>
          ) : (
            <>
              <p className="extraction-count">
                {format(m.extraction.chars, { count: doc.text.length.toLocaleString() })}
                {doc.truncated
                  ? format(m.extraction.charsTruncated, {
                      total: doc.originalChars.toLocaleString(),
                    })
                  : ''}
              </p>
              {doc.warnings.length > 0 && (
                <div className="extraction-warnings" role="status">
                  {doc.warnings.map((warning, i) => (
                    <p key={i}>{warning}</p>
                  ))}
                </div>
              )}
              <pre className="extracted-text">{doc.text || m.extraction.emptyText}</pre>
              <details
                className="extraction-structure"
                open={structureOpen}
                onToggle={(event) => setStructureOpen(event.currentTarget.open)}
              >
                <summary>{format(m.extraction.blocks, { count: doc.blocks.length })}</summary>
                {structureOpen &&
                  doc.blocks.map((block, i) => {
                    let occupied: { start: number; end: number; until: number }[] = []
                    return (
                      <div className="extraction-block" key={i}>
                        <small>
                          {[
                            block.page ? format(m.extraction.page, { n: block.page }) : '',
                            block.slide ? format(m.extraction.slide, { n: block.slide }) : '',
                            block.sheet ? format(m.extraction.sheet, { name: block.sheet }) : '',
                            block.kind === 'note' ? m.extraction.note : '',
                            format(m.extraction.charsRange, {
                              start: block.start + 1,
                              end: block.end,
                            }),
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
                                            title={format(m.extraction.cell, {
                                              row: cell.row + 1,
                                              column: cell.column + 1,
                                            })}
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
