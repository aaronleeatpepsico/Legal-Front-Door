import React, { useState, useCallback } from 'react'

const BUCKET = 'org-photos'

function initials(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase()
}

function resizeImage(file, maxDim = 240) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) { reject(new Error('Please choose an image file')); return }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not load that image'))
      img.onload = () => {
        let w = img.width, h = img.height
        if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim }
        else if (h >= w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85)
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export default function PersonModal({ mode, seed, people, sb, onClose, onSaved, showToast }) {
  const isEdit = mode === 'edit'
  const [form, setForm] = useState({
    name:              seed.name              || '',
    role:              seed.role              || '',
    email:             seed.email             || '',
    department:        seed.department        || '',
    location:          seed.location          || '',
    description:       seed.description       || '',
    manager_id:        seed.manager_id        || '',
    dotted_manager_id: seed.dotted_manager_id || '',
    team_color:        seed.team_color        || '',
    photo_url:         seed.photo_url         || '',
  })
  const [pendingPhoto, setPendingPhoto] = useState(null) // Blob | 'REMOVE' | null
  const [photoPreview, setPhotoPreview] = useState(seed.photo_url || '')
  const [photoError, setPhotoError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const handlePhotoChange = useCallback(async e => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    try {
      const blob = await resizeImage(file)
      setPendingPhoto(blob)
      setPhotoPreview(URL.createObjectURL(blob))
      setPhotoError('')
    } catch (err) { setPhotoError(err.message) }
  }, [])

  const handleRemovePhoto = () => {
    setPendingPhoto('REMOVE')
    setPhotoPreview('')
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (form.manager_id && form.manager_id === form.dotted_manager_id) {
      setSaveError('Direct manager and matrix manager must be different people.')
      return
    }
    setSaving(true)
    setSaveError('')

    const payload = {
      name:              form.name.trim(),
      role:              form.role.trim() || 'Team Member',
      email:             form.email.trim(),
      department:        form.department.trim() || null,
      location:          form.location.trim()   || null,
      description:       form.description.trim() || null,
      manager_id:        form.manager_id        || null,
      dotted_manager_id: form.dotted_manager_id || null,
      team_color:        form.team_color        || null,
      updated_at:        new Date().toISOString(),
    }

    try {
      if (pendingPhoto === 'REMOVE') {
        payload.photo_url = null
      } else if (pendingPhoto) {
        const path = `${isEdit ? seed.id : 'new_' + Date.now()}_${Date.now()}.jpg`
        const { error: upErr } = await sb.storage.from(BUCKET).upload(path, pendingPhoto, { upsert: true, contentType: 'image/jpeg' })
        if (upErr) throw upErr
        payload.photo_url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
      }

      if (isEdit) {
        const { error } = await sb.from('org_chart_people').update(payload).eq('id', seed.id)
        if (error) throw error
        showToast(`Updated ${payload.name}`)
      } else {
        const { error } = await sb.from('org_chart_people').insert(payload)
        if (error) throw error
        showToast(`Added ${payload.name}`)
      }
      onSaved()
      onClose()
    } catch (err) {
      const denied = err?.code === '42501' || /permission denied/i.test(err?.message || '')
      setSaveError(denied ? 'Your account is not in the admin list.' : (err?.message || 'Something went wrong.'))
      setSaving(false)
    }
  }

  // Build manager dropdown options, excluding self and descendants for direct manager
  const excludeSelf = new Set(isEdit ? [seed.id] : [])
  function managerOpts(excluded, emptyLabel) {
    return [
      <option key="" value="">{emptyLabel}</option>,
      ...people
        .filter(p => !excluded.has(p.id))
        .map(p => (
          <option key={p.id} value={p.id}>
            {p.name}{p.role ? ` — ${p.role}` : ''}
          </option>
        ))
    ]
  }

  return (
    <div className="oc2-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="oc2-modal" onSubmit={handleSubmit} onClick={e => e.stopPropagation()}>
        <div className="oc2-modal-title">{isEdit ? `Edit ${seed.name}` : 'Add person'}</div>
        <div className="oc2-modal-sub">{isEdit ? 'Update their details or reporting line.' : 'New person added to the chart.'}</div>

        {/* Photo */}
        <div className="oc2-field">
          <label className="oc2-label">Headshot</label>
          <div className="oc2-photo-row">
            {photoPreview
              ? <img className="oc2-avatar" style={{ width: 48, height: 48, fontSize: 15 }} src={photoPreview} alt="" />
              : <div className="oc2-avatar" style={{ width: 48, height: 48, fontSize: 15 }}>{initials(form.name)}</div>
            }
            <div className="oc2-photo-btns">
              <label className="oc2-file-btn">
                📷 {photoPreview ? 'Replace' : 'Upload photo'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
              </label>
              {photoPreview && (
                <button type="button" className="oc2-btn oc2-btn-sm" onClick={handleRemovePhoto}>Remove</button>
              )}
            </div>
          </div>
          {photoError && <div className="oc2-error">{photoError}</div>}
        </div>

        {/* Name */}
        <div className="oc2-field">
          <label className="oc2-label">Name</label>
          <input className="oc2-input" value={form.name} onChange={set('name')} placeholder="Full name" required />
        </div>

        {/* Role */}
        <div className="oc2-field">
          <label className="oc2-label">Role / Title</label>
          <input className="oc2-input" value={form.role} onChange={set('role')} placeholder="Job title" />
        </div>

        {/* Direct manager */}
        <div className="oc2-field">
          <label className="oc2-label">Direct manager <span>(solid line)</span></label>
          <select className="oc2-select" value={form.manager_id} onChange={set('manager_id')}>
            {managerOpts(excludeSelf, 'No direct manager — top level')}
          </select>
        </div>

        {/* Matrix manager */}
        <div className="oc2-field">
          <label className="oc2-label">Matrix manager <span>(dotted line)</span></label>
          <select className="oc2-select" value={form.dotted_manager_id} onChange={set('dotted_manager_id')}>
            {managerOpts(excludeSelf, 'None')}
          </select>
        </div>

        {/* Email */}
        <div className="oc2-field">
          <label className="oc2-label">Email</label>
          <input className="oc2-input" type="email" value={form.email} onChange={set('email')} placeholder="name@pepsico.com" />
        </div>

        {/* Department */}
        <div className="oc2-field">
          <label className="oc2-label">Department</label>
          <textarea className="oc2-textarea" value={form.department} onChange={set('department')} placeholder="e.g. China Foods Marketing" rows={2} style={{ resize: 'vertical' }} />
        </div>

        {/* Location */}
        <div className="oc2-field">
          <label className="oc2-label">Location</label>
          <input className="oc2-input" value={form.location} onChange={set('location')} placeholder="e.g. Sydney" />
        </div>

        {/* Accent colour */}
        <div className="oc2-field">
          <label className="oc2-label">Accent colour <span>(optional — colours the card top)</span></label>
          <div className="oc2-color-row">
            <input
              type="color"
              value={form.team_color || '#3680CE'}
              onChange={e => setForm(f => ({ ...f, team_color: e.target.value }))}
            />
            <button type="button" className="oc2-btn oc2-btn-sm" onClick={() => setForm(f => ({ ...f, team_color: '' }))}>
              No colour
            </button>
            <span className="oc2-color-note">{form.team_color ? 'Colour set' : 'No colour'}</span>
          </div>
        </div>

        {/* Description */}
        <div className="oc2-field">
          <label className="oc2-label">Description</label>
          <textarea className="oc2-textarea" value={form.description} onChange={set('description')} placeholder="Responsibilities or team notes" />
        </div>

        <div className="oc2-error" style={{ marginTop: 12 }}>{saveError}</div>

        <div className="oc2-modal-actions">
          <button type="button" className="oc2-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="oc2-btn oc2-btn-primary" disabled={saving}>
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add person')}
          </button>
        </div>
      </form>
    </div>
  )
}
