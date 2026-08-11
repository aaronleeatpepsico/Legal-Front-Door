import React from 'react'
import { Handle, Position } from '@xyflow/react'

function initials(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase()
}

export default function OrgNode({ id, data, selected }) {
  const { name, role, department, location, photo_url, team_color, email, description, isAdmin, onEdit, onAddReport, onDelete } = data

  return (
    <div
      className={`oc2-card${selected ? ' oc2-card-selected' : ''}`}
      style={{ '--oc2-accent': team_color || undefined }}
    >
      <Handle type="target" position={Position.Left} className="oc2-handle" />

      <div className="oc2-card-body">
        {photo_url
          ? <img className="oc2-avatar" src={photo_url} alt="" />
          : <div className="oc2-avatar">{initials(name)}</div>
        }
        <div className="oc2-info">
          <div className="oc2-name" title={name}>{name}</div>
          {role       && <div className="oc2-role" title={role}>{role}</div>}
          {department && <div className="oc2-dept" title={department}>{department}</div>}
          {location   && <div className="oc2-loc"  title={location}>📍 {location}</div>}
        </div>
      </div>

      {selected && (
        <div className="oc2-actions">
          {email && (
            <>
              <a className="oc2-action-btn" href={`mailto:${email}`} title="Email" onClick={e => e.stopPropagation()}>✉</a>
              <a className="oc2-action-btn" href={`https://teams.microsoft.com/l/chat/0/0?users=${email}`} target="_blank" rel="noopener noreferrer" title="Teams" onClick={e => e.stopPropagation()}>💬</a>
            </>
          )}
          {description && !isAdmin && (
            <span style={{ fontSize: 10, color: '#7a9ab8', alignSelf: 'center', marginLeft: 2 }}>{description}</span>
          )}
          {isAdmin && (
            <>
              <button className="oc2-action-btn" title="Edit" onClick={e => { e.stopPropagation(); onEdit(id) }}>✎</button>
              <button className="oc2-action-btn" title="Add report" onClick={e => { e.stopPropagation(); onAddReport(id) }}>+</button>
              <button className="oc2-action-btn oc2-action-danger" title="Delete" onClick={e => { e.stopPropagation(); onDelete(id) }}>✕</button>
            </>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="oc2-handle" />
    </div>
  )
}
