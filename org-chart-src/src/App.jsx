import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ReactFlow, ReactFlowProvider,
  useNodesState,
  applyEdgeChanges,
  Background, Controls, MiniMap, Panel,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { createClient } from '@supabase/supabase-js'
import OrgNode from './OrgNode.jsx'
import OrgEdge from './OrgEdge.jsx'
import PersonModal from './PersonModal.jsx'
import CardDetailModal from './CardDetailModal.jsx'
import Toolbar from './Toolbar.jsx'
import './styles.css'

const TABLE = 'org_chart_people'
const nodeTypes = { orgPerson: OrgNode }
const edgeTypes = { orgEdge: OrgEdge }

// ── helpers ──────────────────────────────────────────────────────────────────

function peopleToNodes(people, isAdmin, handlers, connectionSourceId) {
  return people.map(p => ({
    id: p.id,
    type: 'orgPerson',
    position: {
      x: p.position_x != null ? p.position_x : 0,
      y: p.position_y != null ? p.position_y : 0,
    },
    style: { width: 180 },
    data: { ...p, isAdmin, isConnectionSource: p.id === connectionSourceId, ...handlers },
  }))
}

function peopleToEdges(people, isAdmin, edgeHandlers) {
  const edges = []
  people.forEach(p => {
    if (p.manager_id) {
      edges.push({
        id: `solid-${p.id}`,
        source: p.manager_id,
        target: p.id,
        sourceHandle: p.manager_source_handle || 'bottom',
        targetHandle: p.manager_target_handle || 'left',
        type: 'orgEdge',
        data: { lineType: 'solid', isAdmin, ...edgeHandlers },
      })
    }
    if (p.dotted_manager_id) {
      edges.push({
        id: `dotted-${p.id}`,
        source: p.dotted_manager_id,
        target: p.id,
        sourceHandle: p.dotted_manager_source_handle || 'bottom',
        targetHandle: p.dotted_manager_target_handle || 'left',
        type: 'orgEdge',
        data: { lineType: 'dotted', isAdmin, ...edgeHandlers },
      })
    }
  })
  return edges
}

// ── inner component (needs ReactFlowProvider context) ─────────────────────────

function OrgChart({ sb, editable }) {
  const [people, setPeople]           = useState([])
  const [isAdmin, setIsAdmin]         = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges] = useState([])
  // Only allow selection changes from React Flow — never removes (reconnect fires spurious removes)
  const onEdgesChange = useCallback(changes => {
    setEdges(eds => applyEdgeChanges(changes.filter(c => c.type === 'select'), eds))
  }, [])
  const [modal, setModal]             = useState(null)  // { mode, seed }
  const [cardDetail, setCardDetail]   = useState(null)  // person object for detail modal
  const [connectType, setConnectType] = useState(null)  // 'solid' | 'dotted' | null
  const [connectionSource, setConnectionSource] = useState(null) // { id, name } first card clicked when drawing
  const [selectMode, setSelectMode]   = useState(false)
  const [toast, setToast]             = useState(null)
  const [selectedCount, setSelectedCount] = useState(0)
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState(null)
  const toastTimer = useRef(null)
  const { fitView } = useReactFlow()

  const showToast = useCallback(msg => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }, [])

  // ── auth ──────────────────────────────────────────────────────────────────

  const checkAdmin = useCallback(async () => {
    if (!editable) return
    const { data } = await sb.auth.getSession()
    if (!data?.session) { setIsAdmin(false); return }
    const { data: row } = await sb.from('admins').select('email')
      .ilike('email', data.session.user.email).maybeSingle()
    setIsAdmin(!!row)
  }, [sb, editable])

  useEffect(() => {
    checkAdmin()
    const { data: { subscription } } = sb.auth.onAuthStateChange(checkAdmin)
    return () => subscription.unsubscribe()
  }, [checkAdmin, sb])

  // ── data ──────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await sb.from(TABLE).select('*').order('sort_order').order('created_at')
    if (error) {
      console.error('OrgChart load error:', error)
      setLoadError(error.message)
      setLoading(false)
      return
    }
    setPeople(data || [])
    setLoading(false)
  }, [sb])

  useEffect(() => { loadData() }, [loadData])

  // ── edge handlers (stable refs so edges don't remount needlessly) ─────────

  const edgeHandlersRef = useRef({})
  edgeHandlersRef.current = {
    onToggleType: async id => {
      const isDotted = id.startsWith('dotted-')
      const personId = id.replace(/^(solid|dotted)-/, '')
      const person = people.find(p => p.id === personId)
      // Only write handle columns if they actually have values (columns may not exist yet)
      const payload = { updated_at: new Date().toISOString() }
      if (isDotted) {
        payload.manager_id    = person?.dotted_manager_id || null
        payload.dotted_manager_id = null
        if (person?.dotted_manager_source_handle) payload.manager_source_handle = person.dotted_manager_source_handle
        if (person?.dotted_manager_target_handle) payload.manager_target_handle = person.dotted_manager_target_handle
      } else {
        payload.dotted_manager_id = person?.manager_id || null
        payload.manager_id        = null
        if (person?.manager_source_handle) payload.dotted_manager_source_handle = person.manager_source_handle
        if (person?.manager_target_handle) payload.dotted_manager_target_handle = person.manager_target_handle
      }
      const { error } = await sb.from(TABLE).update(payload).eq('id', personId)
      if (error) { showToast('Could not toggle line type: ' + error.message); return }
      showToast('Line type changed')
      await loadData()
    },
    onDeleteEdge: async id => {
      const isDotted = id.startsWith('dotted-')
      const personId = id.replace(/^(solid|dotted)-/, '')
      // Only null the manager ID — don't touch handle columns (may not exist in DB yet)
      const payload = {
        [isDotted ? 'dotted_manager_id' : 'manager_id']: null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await sb.from(TABLE).update(payload).eq('id', personId)
      if (error) { showToast('Could not remove line: ' + error.message); return }
      showToast('Line removed')
      await loadData()
    },
  }

  const stableEdgeHandlers = useMemo(() => ({
    onToggleType: id => edgeHandlersRef.current.onToggleType(id),
    onDeleteEdge: id => edgeHandlersRef.current.onDeleteEdge(id),
  }), [])

  // ── node handlers ─────────────────────────────────────────────────────────

  const nodeHandlersRef = useRef({})
  nodeHandlersRef.current = {
    onEdit:      id => setModal({ mode: 'edit', seed: people.find(p => p.id === id) || {} }),
    onAddReport: id => setModal({ mode: 'add',  seed: { manager_id: id } }),
    onDelete:    async id => {
      const node = people.find(p => p.id === id)
      if (!node) return
      const hasReports = people.some(p => p.manager_id === id)
      const note = hasReports ? (node.manager_id ? ' Reports move up to their manager.' : ' Reports become top-level.') : ''
      if (!confirm(`Delete ${node.name}?${note}`)) return
      await sb.from(TABLE).update({ manager_id: node.manager_id || null, updated_at: new Date().toISOString() }).eq('manager_id', id)
      await sb.from(TABLE).delete().eq('id', id)
      showToast(`Deleted ${node.name}`)
      await loadData()
    },
  }

  const stableNodeHandlers = useMemo(() => ({
    onEdit:      id => nodeHandlersRef.current.onEdit(id),
    onAddReport: id => nodeHandlersRef.current.onAddReport(id),
    onDelete:    id => nodeHandlersRef.current.onDelete(id),
  }), [])

  // ── sync people → nodes/edges ─────────────────────────────────────────────

  useEffect(() => {
    setNodes(peopleToNodes(people, isAdmin, stableNodeHandlers, connectionSource?.id))
  }, [people, isAdmin, stableNodeHandlers, setNodes, connectionSource])

  useEffect(() => {
    setEdges(peopleToEdges(people, isAdmin, stableEdgeHandlers))
  }, [people, isAdmin, stableEdgeHandlers, setEdges])

  // Clear connection source when line-drawing mode is turned off
  useEffect(() => { if (!connectType) setConnectionSource(null) }, [connectType])

  // fit view after first data load — wait for ReactFlow to finish measuring its container
  const fittedRef = useRef(false)
  useEffect(() => {
    if (nodes.length && !fittedRef.current) {
      fittedRef.current = true
      // 300 ms gives the browser time to reflow after display:none → block
      setTimeout(() => fitView({ duration: 400, padding: 0.1, maxZoom: 1 }), 300)
    }
  }, [nodes.length, fitView])

  // ── drag position save ────────────────────────────────────────────────────

  const onNodeDragStop = useCallback(async (_, node) => {
    await sb.from(TABLE).update({
      position_x: node.position.x,
      position_y: node.position.y,
      updated_at: new Date().toISOString(),
    }).eq('id', node.id)
  }, [sb])

  // ── click-to-connect + card detail modal ──────────────────────────────────

  const onNodeClick = useCallback(async (_, node) => {
    if (selectMode) return

    if (connectType) {
      // First click: set as connection source (stays set until user cancels)
      if (!connectionSource) {
        const person = people.find(p => p.id === node.id)
        setConnectionSource({ id: node.id, name: person?.name || node.id })
        return
      }
      // Click same card: cancel
      if (connectionSource.id === node.id) {
        setConnectionSource(null)
        return
      }
      // Click different card: draw line (source = manager, target = this card)
      const src = connectionSource.id
      const tgt = node.id
      const isD = connectType === 'dotted'
      const patch = {
        [isD ? 'dotted_manager_id' : 'manager_id']: src,
        updated_at: new Date().toISOString(),
      }
      const withHandles = {
        ...patch,
        [isD ? 'dotted_manager_source_handle' : 'manager_source_handle']: 'bottom',
        [isD ? 'dotted_manager_target_handle' : 'manager_target_handle']: 'top',
      }
      let { error } = await sb.from(TABLE).update(withHandles).eq('id', tgt)
      if (error?.message?.includes('schema cache') || error?.message?.includes('column')) {
        const res = await sb.from(TABLE).update(patch).eq('id', tgt)
        error = res.error
      }
      if (error) { showToast('Could not save line: ' + error.message); return }
      showToast(`${isD ? 'Dotted' : 'Solid'} line added — click another card or click "${connectionSource.name}" to cancel`)
      await loadData()
      // Keep connectionSource set so user can connect same manager to multiple reports
      return
    }

    // Normal mode: open detail modal
    const person = people.find(p => p.id === node.id)
    if (person) setCardDetail(person)
  }, [selectMode, connectType, connectionSource, people, sb, loadData, showToast])

  // ── connect ───────────────────────────────────────────────────────────────

  const onConnect = useCallback(async ({ source, target, sourceHandle, targetHandle }) => {
    if (!source || !target || source === target) return
    const type = connectType || 'solid'
    const isD = type === 'dotted'
    const patch = {
      [isD ? 'dotted_manager_id'            : 'manager_id']:            source,
      [isD ? 'dotted_manager_source_handle' : 'manager_source_handle']: sourceHandle || 'bottom',
      [isD ? 'dotted_manager_target_handle' : 'manager_target_handle']: targetHandle || 'left',
      updated_at: new Date().toISOString(),
    }
    let { error } = await sb.from(TABLE).update(patch).eq('id', target)
    // If handle columns don't exist yet, retry with just the manager ID
    if (error?.message?.includes('schema cache') || error?.message?.includes('column')) {
      const simple = {
        [isD ? 'dotted_manager_id' : 'manager_id']: source,
        updated_at: new Date().toISOString(),
      }
      const res = await sb.from(TABLE).update(simple).eq('id', target)
      error = res.error
    }
    if (error) { showToast('Could not save line: ' + error.message); return }
    showToast(`${isD ? 'Dotted' : 'Solid'} line added`)
    await loadData()
  }, [sb, connectType, loadData, showToast])

  // ── selection tracking (for "delete selected" count) ─────────────────────

  const onSelectionChange = useCallback(({ nodes: selNodes }) => {
    setSelectedCount(selNodes.length)
  }, [])

  const handleDeleteSelected = useCallback(async () => {
    const selNodes = nodes.filter(n => n.selected)
    if (!selNodes.length) return
    const names = selNodes.map(n => n.data.name).join(', ')
    if (!confirm(`Delete ${selNodes.length} people?\n\n${names}`)) return
    const ids = selNodes.map(n => n.id)
    const idSet = new Set(ids)
    // re-parent orphaned reports
    const affected = people.filter(p => !idSet.has(p.id) && (idSet.has(p.manager_id) || idSet.has(p.dotted_manager_id)))
    await Promise.all(affected.map(p => {
      const patch = { updated_at: new Date().toISOString() }
      if (idSet.has(p.manager_id)) patch.manager_id = null
      if (idSet.has(p.dotted_manager_id)) patch.dotted_manager_id = null
      return sb.from(TABLE).update(patch).eq('id', p.id)
    }))
    await sb.from(TABLE).delete().in('id', ids)
    showToast(`Deleted ${ids.length} ${ids.length === 1 ? 'person' : 'people'}`)
    await loadData()
  }, [nodes, people, sb, loadData, showToast])

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="oc2-root">
      {isAdmin && (
        <Toolbar
          connectType={connectType}
          setConnectType={setConnectType}
          connectionSource={connectionSource}
          setConnectionSource={setConnectionSource}
          selectMode={selectMode}
          setSelectMode={setSelectMode}
          people={people}
          sb={sb}
          onAddPerson={() => setModal({ mode: 'add', seed: {} })}
          onDeleteSelected={handleDeleteSelected}
          selectedCount={selectedCount}
          loadData={loadData}
          showToast={showToast}
        />
      )}

      <div className="oc2-flow-wrap">
        {loading && (
          <div className="oc2-status-overlay">
            <div className="oc2-status-spinner" />
            <span>Loading org chart…</span>
          </div>
        )}
        {loadError && (
          <div className="oc2-status-overlay">
            <span style={{ color: '#b3462c' }}>Could not load org chart: {loadError}</span>
          </div>
        )}
        {!loading && !loadError && people.length === 0 && (
          <div className="oc2-status-overlay">
            <span>No people in the org chart yet.</span>
            {isAdmin && <span style={{ marginTop: 6 }}>Click "Add person" in the toolbar above to get started.</span>}
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onSelectionChange={onSelectionChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode="loose"
          reconnectRadius={0}
          onNodeClick={onNodeClick}
          nodesDraggable={isAdmin && !selectMode}
          nodesConnectable={isAdmin && !selectMode}
          elementsSelectable={true}
          selectionOnDrag={isAdmin && selectMode}
          panOnDrag={editable && !selectMode}
          zoomOnScroll={editable}
          zoomOnPinch={editable}
          zoomOnDoubleClick={editable}
          panOnScroll={false}
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
          minZoom={0.15}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant="dots" gap={20} size={1} color="#c8d8e8" />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={n => n.data?.team_color || '#eaf1fb'}
            nodeStrokeWidth={2}
            zoomable pannable
          />
        </ReactFlow>
      </div>

      <div className="oc2-legend">
        {isAdmin
          ? "Drag cards to reposition · drag from a card’s bottom handle to draw a line · click a line to toggle type or delete"
          : 'Solid lines — direct management · dotted lines — matrix management'}
      </div>

      {cardDetail && (
        <CardDetailModal
          person={cardDetail}
          people={people}
          isAdmin={isAdmin}
          onClose={() => setCardDetail(null)}
          onEdit={id => { setCardDetail(null); nodeHandlersRef.current.onEdit(id) }}
          onAddReport={id => { setCardDetail(null); nodeHandlersRef.current.onAddReport(id) }}
          onDelete={id => { setCardDetail(null); nodeHandlersRef.current.onDelete(id) }}
        />
      )}

      {modal && (
        <PersonModal
          mode={modal.mode}
          seed={modal.seed}
          people={people}
          sb={sb}
          onClose={() => setModal(null)}
          onSaved={loadData}
          showToast={showToast}
        />
      )}

      {toast && <div className="oc2-toast">{toast}</div>}
    </div>
  )
}

// ── exported App (wraps in provider) ─────────────────────────────────────────

export default function App({ supabaseUrl, supabaseKey, editable = false }) {
  const sb = useMemo(() => createClient(supabaseUrl, supabaseKey), [supabaseUrl, supabaseKey])
  return (
    <ReactFlowProvider>
      <OrgChart sb={sb} editable={editable} />
    </ReactFlowProvider>
  )
}
