import React from 'react'
import { useReactFlow } from '@xyflow/react'
import { layoutTree } from './layout.js'

export default function Toolbar({ connectType, setConnectType, connectionSource, setConnectionSource, selectMode, setSelectMode, people, sb, onAddPerson, onDeleteSelected, selectedCount, loadData, showToast }) {
  const { fitView, setNodes } = useReactFlow()

  const handleAutoArrange = async () => {
    if (!people.length) return
    const positions = layoutTree(people)
    const updates = people
      .filter(p => positions[p.id])
      .map(p => sb.from('org_chart_people').update({
        position_x: positions[p.id].x,
        position_y: positions[p.id].y,
        updated_at: new Date().toISOString(),
      }).eq('id', p.id))

    const results = await Promise.all(updates)
    const failed = results.find(r => r.error)
    if (failed) { showToast('Could not auto arrange: ' + failed.error.message); return }
    await loadData()
    setTimeout(() => fitView({ duration: 500, padding: 0.1 }), 80)
    showToast('Chart auto arranged')
  }

  return (
    <div className="oc2-toolbar">
      <button className="oc2-btn oc2-btn-primary" onClick={() => onAddPerson(null)}>+ Add card</button>

      <div className="oc2-toolbar-sep" />

      <button
        className={`oc2-btn${connectType === 'solid' ? ' oc2-btn-active' : ''}`}
        onClick={() => setConnectType(t => t === 'solid' ? null : 'solid')}
        title="Drag between cards to draw a solid (direct) line"
      >
        <span className="oc2-line-swatch" />
        Solid line
      </button>

      <button
        className={`oc2-btn${connectType === 'dotted' ? ' oc2-btn-active' : ''}`}
        onClick={() => setConnectType(t => t === 'dotted' ? null : 'dotted')}
        title="Drag between cards to draw a dotted (matrix) line"
      >
        <span className="oc2-line-swatch oc2-line-swatch-dotted" />
        Dotted line
      </button>

      <button
        className={`oc2-btn${selectMode ? ' oc2-btn-active' : ''}`}
        onClick={() => setSelectMode(m => !m)}
        title="Drag on the canvas to select multiple cards"
      >
        ⬚ Select
      </button>

      <div className="oc2-toolbar-sep" />

      <button className="oc2-btn" onClick={handleAutoArrange}>Auto arrange</button>

      {selectedCount > 0 && (
        <button className="oc2-btn oc2-btn-danger" onClick={onDeleteSelected}>
          Delete selected ({selectedCount})
        </button>
      )}

      {connectionSource && (
        <button className="oc2-btn oc2-btn-danger oc2-btn-sm" onClick={() => setConnectionSource(null)}>
          ✕ Cancel
        </button>
      )}

      <span className="oc2-toolbar-status">
        {selectMode
          ? 'Drag on canvas to select multiple cards · Shift+click to add/remove'
          : connectionSource
            ? `Drawing from "${connectionSource.name}" — click any card to connect · click "${connectionSource.name}" to cancel`
            : connectType
              ? `Click a card to start drawing a ${connectType} line`
              : 'Drag cards to arrange · click a card for details'}
      </span>
    </div>
  )
}
