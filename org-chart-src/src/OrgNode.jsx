import React from 'react'
import { Handle, Position } from '@xyflow/react'

function initials(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase()
}

const SIDES = [
  { id: 'top',    position: Position.Top    },
  { id: 'right',  position: Position.Right  },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left',   position: Position.Left   },
]

export default function OrgNode({ id, data, selected }) {
  const { name, role, department, location, photo_url, team_color, isAdmin } = data

  return (
    <div
      className={`oc2-card${selected ? ' oc2-card-selected' : ''}`}
      style={{ '--oc2-accent': team_color || undefined }}
    >
      {SIDES.map(({ id: hid, position }) => (
        <React.Fragment key={hid}>
          <Handle
            type="source"
            id={`s-${hid}`}
            position={position}
            className={`oc2-handle oc2-handle-${hid}${isAdmin ? '' : ' oc2-handle-hidden'}`}
            isConnectable={!!isAdmin}
          />
          <Handle
            type="target"
            id={`t-${hid}`}
            position={position}
            className={`oc2-handle oc2-handle-${hid}${isAdmin ? '' : ' oc2-handle-hidden'}`}
            isConnectable={!!isAdmin}
          />
        </React.Fragment>
      ))}

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
    </div>
  )
}
