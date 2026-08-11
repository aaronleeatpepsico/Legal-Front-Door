// Recursive top-down org chart layout.
// Each node is centred above its children; siblings spread horizontally.
// Returns { [id]: { x, y } } using React Flow's top-left coordinate system.

const NODE_W = 180
const NODE_H = 80
const H_GAP  = 24   // horizontal gap between sibling subtrees
const V_GAP  = 60   // vertical gap between levels
const PAD    = 40   // canvas padding

function subtreeW(node) {
  if (!node.children.length) return NODE_W
  const inner = node.children.reduce((s, c) => s + subtreeW(c), 0)
    + H_GAP * (node.children.length - 1)
  return Math.max(NODE_W, inner)
}

function place(node, left, y, pos) {
  const sw = subtreeW(node)
  pos[node.id] = { x: left + (sw - NODE_W) / 2, y }
  if (!node.children.length) return
  let cx = left
  node.children.forEach(child => {
    const csw = subtreeW(child)
    place(child, cx, y + NODE_H + V_GAP, pos)
    cx += csw + H_GAP
  })
}

function treeSize(node) {
  return 1 + node.children.reduce((s, c) => s + treeSize(c), 0)
}

export function layoutTree(people) {
  const byId = {}
  people.forEach(p => { byId[p.id] = { ...p, children: [] } })
  people.forEach(p => {
    if (p.manager_id && byId[p.manager_id]) byId[p.manager_id].children.push(byId[p.id])
  })

  // Sort children by sort_order so the visual order matches the data order
  Object.values(byId).forEach(n => n.children.sort((a, b) => a.sort_order - b.sort_order))

  const roots = people
    .filter(p => !p.manager_id || !byId[p.manager_id])
    .map(p => byId[p.id])
    .sort((a, b) => treeSize(b) - treeSize(a))

  if (!roots.length) return {}

  const pos = {}
  let cx = PAD
  roots.forEach(root => {
    const sw = subtreeW(root)
    place(root, cx, PAD, pos)
    cx += sw + H_GAP * 4
  })
  return pos
}
