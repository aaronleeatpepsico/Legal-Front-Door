import React from 'react'
import { useReactFlow } from '@xyflow/react'

export default function Toolbar({ connectType, setConnectType, connectionSource, setConnectionSource, selectMode, setSelectMode, people, sb, onAddPerson, onDeleteSelected, selectedCount, loadData, showToast }) {
  const { fitView } = useReactFlow()

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
