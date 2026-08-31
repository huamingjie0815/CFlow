import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnReconnect,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeKindLabel } from '../copy'
import { describeNode, edgeLabel, nodeConfigNote } from '../flow-labels'
import { nodeRunStateLabel, nodeRunStateTone, type NodeRunState } from '../run'
import type { CanvasPosition, CFDraft, CFVersion, FlowDraft, FlowNode } from '../types'

type FlowCanvasProps = {
  draft: FlowDraft
  positions: Record<string, CanvasPosition>
  cfs: CFVersion[]
  candidateCfs: CFDraft[]
  flowState: 'draft' | 'published'
  nodeRunStates?: Record<string, NodeRunState>
  selectedNodeId: string | null
  selectedEdgeId: string | null
  /** Hide the minimap when the canvas is short (drawer open). */
  compact?: boolean
  onDraftChange: (next: FlowDraft) => void
  onPositionsChange: (next: Record<string, CanvasPosition>) => void
  onSelectNode: (id: string | null) => void
  onSelectEdge: (id: string | null) => void
}

type CardData = {
  kind: string
  label: string
  subtitle: string
  state: NodeRunState
  index?: number
  configNote?: string
}

function FlowCard({ data, selected }: NodeProps<Node<CardData>>) {
  return (
    <article
      className={`flow-card flow-card-${data.kind} is-${data.state}${selected ? ' is-selected' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="flow-card-head">
        <span className="node-kind">{nodeKindLabel(data.kind)}</span>
        {data.index != null && (
          <span className="node-index">{String(data.index).padStart(2, '0')}</span>
        )}
      </div>
      <strong>{data.label}</strong>
      <p>{data.subtitle}</p>
      {data.configNote && <div className="flow-card-config">{data.configNote}</div>}
      <div className="flow-card-foot">
        <span className={`status-lamp is-${nodeRunStateTone(data.state)}`} />
        <span>{nodeRunStateLabel(data.state)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </article>
  )
}

function EntryCard() {
  return (
    <div className="entry-card">
      <span className="entry-signal" />
      <span>开始</span>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  )
}

const nodeTypes = { flowCard: FlowCard, entry: EntryCard }

function defaultPosition(index: number, total: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)))
  return { x: 180 + (index % columns) * 270, y: 150 + Math.floor(index / columns) * 190 }
}

function FlowCanvasInner(props: FlowCanvasProps) {
  const {
    draft,
    positions,
    cfs,
    candidateCfs,
    flowState,
    nodeRunStates = {},
    selectedNodeId,
    selectedEdgeId,
    onDraftChange,
    onPositionsChange,
    onSelectNode,
    onSelectEdge,
  } = props
  const [viewportZoom, setViewportZoom] = useState(1)
  const mappedNodes = useMemo<Node<CardData>[]>(() => {
    const cards: Node<CardData>[] = draft.nodes.map((node, index) => {
      const copy = describeNode(node, cfs, candidateCfs)
      return {
        id: node.id,
        type: 'flowCard',
        position: positions[node.id] ?? defaultPosition(index, draft.nodes.length),
        selected: selectedNodeId === node.id,
        data: {
          kind: node.kind,
          label: copy.label,
          subtitle: copy.subtitle,
          state: nodeRunStates[node.id] ?? flowState,
          index: index + 1,
          configNote: nodeConfigNote(node),
        },
      }
    })
    return [
      {
        id: '$entry',
        type: 'entry',
        position: positions.$entry ?? { x: 24, y: 210 },
        data: { kind: 'entry', label: '开始', subtitle: '', state: flowState },
        draggable: true,
        deletable: false,
        selectable: false,
      },
      ...cards,
    ]
  }, [candidateCfs, cfs, draft.nodes, flowState, nodeRunStates, positions, selectedNodeId])
  const mappedEdges = useMemo<Edge[]>(
    () =>
      draft.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'smoothstep',
        label: edgeLabel(edge, draft.nodes),
        selected: selectedEdgeId === edge.id,
        reconnectable: edge.from !== '$entry',
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className: 'route-edge',
      })),
    [draft.edges, draft.nodes, selectedEdgeId],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(mappedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(mappedEdges)

  useEffect(() => setNodes(mappedNodes), [mappedNodes, setNodes])
  useEffect(() => setEdges(mappedEdges), [mappedEdges, setEdges])

  const connect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target)
        return
      if (
        draft.edges.some((edge) => edge.from === connection.source && edge.to === connection.target)
      )
        return
      const nextEdge = {
        id: `edge-${Date.now().toString(36)}`,
        from: connection.source,
        to: connection.target,
      }
      onDraftChange({ ...draft, revision: draft.revision + 1, edges: [...draft.edges, nextEdge] })
      onSelectNode(null)
      onSelectEdge(nextEdge.id)
    },
    [draft, onDraftChange, onSelectEdge, onSelectNode],
  )

  const reconnect: OnReconnect = useCallback(
    (oldEdge, connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target)
        return
      setEdges((current) => reconnectEdge(oldEdge, connection, current))
      onDraftChange({
        ...draft,
        revision: draft.revision + 1,
        edges: draft.edges.map((edge) =>
          edge.id === oldEdge.id
            ? { ...edge, from: connection.source, to: connection.target }
            : edge,
        ),
      })
      onSelectEdge(oldEdge.id)
    },
    [draft, onDraftChange, onSelectEdge, setEdges],
  )

  return (
    <div className="flow-canvas-shell" data-testid="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={connect}
        onReconnect={reconnect}
        onNodeClick={(_, node) => {
          if (node.id === '$entry') return
          onSelectEdge(null)
          onSelectNode(node.id)
        }}
        onEdgeClick={(_, edge) => {
          onSelectNode(null)
          onSelectEdge(edge.id)
        }}
        onPaneClick={() => {
          onSelectNode(null)
          onSelectEdge(null)
        }}
        onNodeDragStop={(_, node) =>
          onPositionsChange({ ...positions, [node.id]: { x: node.position.x, y: node.position.y } })
        }
        onEdgesDelete={(deleted) => {
          const ids = new Set(deleted.map((edge) => edge.id))
          onDraftChange({
            ...draft,
            revision: draft.revision + 1,
            edges: draft.edges.filter((edge) => !ids.has(edge.id)),
          })
          onSelectEdge(null)
        }}
        onNodesDelete={(deleted) => {
          const ids = new Set(deleted.filter((node) => node.id !== '$entry').map((node) => node.id))
          if (!ids.size) return
          onDraftChange({
            ...draft,
            revision: draft.revision + 1,
            nodes: draft.nodes.filter((node) => !ids.has(node.id)),
            edges: draft.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
          })
          onSelectNode(null)
        }}
        onViewportChange={(viewport) => setViewportZoom(viewport.zoom)}
        connectionMode={ConnectionMode.Strict}
        minZoom={0.6}
        maxZoom={1.4}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        selectionOnDrag
        panOnScroll
        zoomOnScroll
        zoomOnPinch
        nodesConnectable
        edgesReconnectable
        proOptions={{ hideAttribution: true }}
        aria-label="流程画布"
      >
        <Background color="#d8d3c5" gap={28} size={1} variant={BackgroundVariant.Dots} />
        <Controls position="bottom-left" showInteractive={false} />
        {!props.compact && (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node) => (node.id === '$entry' ? '#35569e' : '#d2d7de')}
            maskColor="rgba(246, 247, 249, .78)"
          />
        )}
        <Panel position="top-right" className="canvas-readout">
          <strong>{Math.round(viewportZoom * 100)}%</strong>
          <span>滚轮缩放，拖空白处移动画布，Delete 删除</span>
        </Panel>
      </ReactFlow>
    </div>
  )
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
