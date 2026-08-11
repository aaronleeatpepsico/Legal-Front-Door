export function initials(name) {
  return (name || '').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase()
}
