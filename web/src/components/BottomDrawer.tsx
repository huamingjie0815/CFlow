import { ListChecks, ScrollText, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { DrawerTab } from '../workbench-ui'

type BottomDrawerProps = {
  tab: DrawerTab
  onTabChange: (tab: DrawerTab) => void
  onClose: () => void
  children: ReactNode
}

const tabs: { id: DrawerTab; label: string; icon: ReactNode }[] = [
  { id: 'log', label: '日志', icon: <ScrollText size={14} /> },
  { id: 'check', label: '检查', icon: <ListChecks size={14} /> },
]

/**
 * Sits under the canvas as a real flex sibling, so opening it resizes the
 * canvas rather than covering the zoom controls or the minimap. Never opens on
 * its own — the toolbar is the only way in.
 */
export function BottomDrawer(props: BottomDrawerProps) {
  return (
    <section className="bottom-drawer" aria-label="运行日志与检查">
      <div className="drawer-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={props.tab === tab.id}
            onClick={() => props.onTabChange(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          className="icon-button drawer-close"
          onClick={props.onClose}
          title="收起"
          aria-label="收起日志"
        >
          <X size={15} />
        </button>
      </div>
      <div className="drawer-body">{props.children}</div>
    </section>
  )
}
