// Auto-arrange algorithm — produces { [id]: { x, y } } positions.
// Mirrors the compact executive-chart layout from the original widget.

const NODE_W = 180
const NODE_H = 80
const V_GAP  = 20
const LANE_GAP  = 12
const GROUP_GAP = 28
const MAX_LANE_ROWS = 6
const SIDE_PAD  = 32
const TOP_PAD   = 32
const ROW_STEP  = NODE_H + V_GAP

function flatten(node, out) {
  out.push(node)
  node.children.forEach(c => flatten(c, out))
  return out
}

export function layoutTree(rows) {
  const byId = {}
  rows.forEach(r => { byId[r.id] = { ...r, children: [] } })
  const roots = []
  rows.forEach(r => {
    if (r.manager_id && byId[r.manager_id]) byId[r.manager_id].children.push(byId[r.id])
    else roots.push(byId[r.id])
  })
  if (!roots.length) return {}

  const ROOT_Y   = TOP_PAD + NODE_H / 2
  const BRANCH_Y = ROOT_Y + 160

  const executive = roots.slice().sort((a, b) => b.children.length - a.children.length)[0]
  const topChildren = executive
    ? executive.children.slice().concat(roots.filter(r => r.id !== executive.id))
    : roots.slice()
  const assistants = executive
    ? topChildren.filter(n => /executive assistant/i.test(n.role || ''))
    : []
  const branches = topChildren.filter(n => !assistants.includes(n))

  const groups = branches.map(branch => {
    const directSubtrees = branch.children.map(c => flatten(c, []))
    const descendantCount = directSubtrees.reduce((s, l) => s + l.length, 0)
    const laneCount = Math.max(1, Math.ceil(descendantCount / MAX_LANE_ROWS))
    const lanes = Array.from({ length: laneCount }, () => [])
    if (laneCount > 1) directSubtrees.sort((a, b) => b.length - a.length)
    directSubtrees.forEach(subtree => {
      let li = 0
      for (let i = 1; i < lanes.length; i++) {
        if (lanes[i].length < lanes[li].length) li = i
      }
      lanes[li].push(...subtree)
    })
    return { branch, lanes, width: laneCount * NODE_W + (laneCount - 1) * LANE_GAP }
  })

  const groupsWidth = groups.reduce((s, g, i) => s + g.width + (i > 0 ? GROUP_GAP : 0), 0)
  const totalWidth  = Math.max(700, groupsWidth + SIDE_PAD * 2)
  let cursor = (totalWidth - groupsWidth) / 2
  const positions = {}

  groups.forEach(group => {
    positions[group.branch.id] = { x: cursor + group.width / 2, y: BRANCH_Y }
    group.lanes.forEach((lane, li) => {
      const lx = cursor + li * (NODE_W + LANE_GAP) + NODE_W / 2
      lane.forEach((node, ri) => {
        positions[node.id] = { x: lx, y: BRANCH_Y + (ri + 1) * ROW_STEP }
      })
    })
    cursor += group.width + GROUP_GAP
  })

  if (executive) {
    positions[executive.id] = { x: totalWidth / 2, y: ROOT_Y }
    assistants.forEach((a, i) => {
      const offset = (i - (assistants.length - 1) / 2) * (NODE_W + LANE_GAP)
      positions[a.id] = { x: totalWidth / 2 + offset, y: ROOT_Y + 100 }
    })
  }

  return positions
}
