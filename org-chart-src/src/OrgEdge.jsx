import React from 'react'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow } from '@xyflow/react'

export default function OrgEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data = {}, selected,
}) {
  const { deleteElements } = useReactFlow()
  const isDotted = data.lineType === 'dotted'

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
    offset: 20,
  })

  const stroke      = isDotted ? '#6f8fab' : '#8ca9c1'
  const strokeWidth = isDotted ? 1.5 : 1.8
  const dashArray   = isDotted ? '5 4' : undefined

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{ stroke, strokeWidth, strokeDasharray: dashArray }}
      />

      {selected && data.isAdmin && (
        <EdgeLabelRenderer>
          <div
            className="oc2-edge-actions"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            <button
              className="oc2-edge-btn"
              title={isDotted ? 'Make solid' : 'Make dotted'}
              onClick={() => data.onToggleType(id)}
            >
              {isDotted ? '—' : '⋯'}
            </button>
            <button
              className="oc2-edge-btn oc2-edge-btn-danger"
              title="Remove line"
              onClick={() => {
                data.onDeleteEdge(id)
                deleteElements({ edges: [{ id }] })
              }}
            >
              ✕
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
