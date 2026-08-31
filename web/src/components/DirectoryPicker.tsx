import { ChevronLeft, Folder, FolderCheck, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, readableError } from '../api'
import type { DirectoryListing } from '../types'

export function DirectoryPicker(props: { onConfirm: (path: string) => void }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [pathOpen, setPathOpen] = useState(false)

  const open = async (path?: string) => {
    setLoading(true)
    setError('')
    try {
      const next = await api.listDirectories(path)
      setListing(next)
      setPathInput(next.path)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void open()
  }, [])

  const confirm = async () => {
    if (!listing) return
    setConfirming(true)
    setError('')
    try {
      const result = await api.validateDirectory(listing.path)
      props.onConfirm(result.path)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setConfirming(false)
    }
  }

  const isHidden = (directory: { name: string; hidden?: boolean }) =>
    directory.hidden ?? directory.name.startsWith('.')
  const all = listing?.directories ?? []
  const visible = useMemo(
    () => (showHidden ? all : all.filter((directory) => !isHidden(directory))),
    [all, showHidden],
  )
  const hiddenCount = all.length - all.filter((directory) => !isHidden(directory)).length
  const crumbs = listing?.path.split('/').filter(Boolean) ?? []

  return (
    <section className="directory-picker" aria-labelledby="directory-picker-title">
      <div className="directory-picker-heading">
        <span className="directory-picker-mark">
          <FolderCheck size={20} />
        </span>
        <div>
          <h2 id="directory-picker-title">这条流程在哪个文件夹里工作？</h2>
          <p>流程读取的资料、上传的附件和运行结果都会放在这里。选定后不能再改。</p>
        </div>
      </div>

      {listing && (
        <nav className="directory-breadcrumbs" aria-label="当前位置">
          <button type="button" onClick={() => void open('/')} aria-label="根目录">
            /
          </button>
          {crumbs.map((crumb, index) => (
            <button
              type="button"
              key={`${crumb}-${index}`}
              onClick={() => void open(`/${crumbs.slice(0, index + 1).join('/')}`)}
            >
              {crumb}
            </button>
          ))}
        </nav>
      )}

      <div className="directory-list" aria-busy={loading}>
        {loading ? (
          <div className="directory-empty">
            <LoaderCircle className="spin" size={18} /> 正在读取…
          </div>
        ) : (
          <>
            {listing?.parentPath && (
              <button type="button" onClick={() => void open(listing.parentPath!)}>
                <ChevronLeft size={16} />
                <span>
                  <strong>返回上一层</strong>
                </span>
              </button>
            )}
            {visible.map((directory) => (
              <button
                type="button"
                key={`${directory.name}-${directory.path}`}
                onClick={() => void open(directory.path)}
              >
                <Folder size={16} />
                <span>
                  <strong>{directory.name}</strong>
                  {/* Only surface a path when the folder resolves somewhere else. */}
                  {listing && directory.path !== `${listing.path}/${directory.name}` && (
                    <small>实际位置 {directory.path}</small>
                  )}
                </span>
              </button>
            ))}
            {!visible.length && !listing?.parentPath && (
              <div className="directory-empty">这里没有可进入的文件夹。</div>
            )}
            {!visible.length && listing?.parentPath && (
              <div className="directory-empty">这里没有其他文件夹，可以直接选用当前位置。</div>
            )}
          </>
        )}
      </div>

      <div className="directory-options">
        {hiddenCount > 0 && (
          <label className="quiet-toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
            />
            显示系统文件夹（{hiddenCount} 个）
          </label>
        )}
        <button
          type="button"
          className="link-button"
          onClick={() => setPathOpen((value) => !value)}
        >
          {pathOpen ? '收起路径输入' : '直接输入完整路径'}
        </button>
      </div>

      {pathOpen && (
        <form
          className="directory-jump"
          onSubmit={(event) => {
            event.preventDefault()
            void open(pathInput)
          }}
        >
          <label className="field">
            <span>完整路径</span>
            <div className="directory-jump-row">
              <input
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                placeholder="/Users/你的名字/文件夹"
              />
              <button className="button" type="submit" disabled={loading}>
                前往
              </button>
            </div>
          </label>
        </form>
      )}

      {error && (
        <p className="directory-error" role="alert">
          {error}
        </p>
      )}

      <div className="directory-picker-footer">
        <span>{listing?.path ?? '尚未选择'}</span>
        <button
          className="button signal"
          type="button"
          disabled={!listing || loading || confirming}
          onClick={() => void confirm()}
        >
          {confirming && <LoaderCircle className="spin" size={14} />}
          就用这个文件夹
        </button>
      </div>
    </section>
  )
}
