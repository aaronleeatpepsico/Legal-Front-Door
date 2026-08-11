import React from 'react'

function initials(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase()
}

function PersonPill({ person, badge, dotted }) {
  return (
    <div className="oc2-detail-pill">
      <div className="oc2-detail-pill-avatar">{initials(person.name)}</div>
      <div className="oc2-detail-pill-info">
        <div className="oc2-detail-pill-name">{person.name}</div>
        {person.role && <div className="oc2-detail-pill-role">{person.role}</div>}
      </div>
      {badge && (
        <span className={`oc2-detail-pill-badge${dotted ? ' oc2-detail-pill-badge-dotted' : ''}`}>{badge}</span>
      )}
    </div>
  )
}

export default function CardDetailModal({ person, people, isAdmin, onClose, onEdit, onAddReport, onDelete }) {
  if (!person) return null

  const directManager = person.manager_id        ? people.find(p => p.id === person.manager_id)        : null
  const dottedManager  = person.dotted_manager_id ? people.find(p => p.id === person.dotted_manager_id) : null
  const directReports  = people.filter(p => p.manager_id        === person.id)
  const dottedReports  = people.filter(p => p.dotted_manager_id === person.id)

  return (
    <div className="oc2-overlay" onClick={onClose}>
      <div className="oc2-detail-modal" onClick={e => e.stopPropagation()}>
        <button className="oc2-detail-close" onClick={onClose} title="Close">✕</button>

        {/* Header */}
        <div className="oc2-detail-header" style={{ borderTop: `4px solid ${person.team_color || '#02355A'}` }}>
          {person.photo_url
            ? <img className="oc2-detail-avatar oc2-detail-avatar-img" src={person.photo_url} alt="" />
            : <div className="oc2-detail-avatar oc2-detail-avatar-initials">{initials(person.name)}</div>
          }
          <div className="oc2-detail-identity">
            <div className="oc2-detail-name">{person.name}</div>
            {person.role       && <div className="oc2-detail-role">{person.role}</div>}
            {person.department && <div className="oc2-detail-dept">{person.department}</div>}
            {person.location   && <div className="oc2-detail-loc">📍 {person.location}</div>}
          </div>
        </div>

        {/* Description */}
        {person.description && (
          <div className="oc2-detail-section">
            <div className="oc2-detail-sec-label">About / Responsibilities</div>
            <div className="oc2-detail-body">{person.description}</div>
          </div>
        )}

        {/* Reports to */}
        {(directManager || dottedManager) && (
          <div className="oc2-detail-section">
            <div className="oc2-detail-sec-label">Reports to</div>
            {directManager && <PersonPill person={directManager} badge="Direct manager" />}
            {dottedManager  && <PersonPill person={dottedManager}  badge="Indirect / matrix" dotted />}
          </div>
        )}

        {/* Direct reports */}
        {directReports.length > 0 && (
          <div className="oc2-detail-section">
            <div className="oc2-detail-sec-label">Direct reports · {directReports.length}</div>
            {directReports.map(r => <PersonPill key={r.id} person={r} />)}
          </div>
        )}

        {/* Dotted-line reports */}
        {dottedReports.length > 0 && (
          <div className="oc2-detail-section">
            <div className="oc2-detail-sec-label">Matrix / indirect reports · {dottedReports.length}</div>
            {dottedReports.map(r => <PersonPill key={r.id} person={r} badge="indirect" dotted />)}
          </div>
        )}

        {/* Contact */}
        {person.email && (
          <div className="oc2-detail-section">
            <div className="oc2-detail-sec-label">Contact</div>
            <div className="oc2-detail-contact-row">
              <a className="oc2-btn" href={`mailto:${person.email}`}>✉ Email</a>
              <a className="oc2-btn" href={`https://teams.microsoft.com/l/chat/0/0?users=${person.email}`}
                target="_blank" rel="noopener noreferrer">💬 Teams</a>
            </div>
          </div>
        )}

        {/* Admin actions */}
        {isAdmin && (
          <div className="oc2-detail-section oc2-detail-admin-row">
            <button className="oc2-btn oc2-btn-sm" onClick={() => { onClose(); onEdit(person.id) }}>✎ Edit</button>
            <button className="oc2-btn oc2-btn-sm" onClick={() => { onClose(); onAddReport(person.id) }}>+ Add report</button>
            <button className="oc2-btn oc2-btn-sm oc2-btn-danger" onClick={() => { onClose(); onDelete(person.id) }}>✕ Delete</button>
          </div>
        )}
      </div>
    </div>
  )
}
