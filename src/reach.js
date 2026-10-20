// How far you can walk, and who lives there. All lengths in metres, positions as [x, y] from geo.js.
import ClipperLib from 'clipper-lib'

export const SPEED_M_PER_MIN = 80 // 4.8 km/h
export const MINUTES = [5, 10, 15]
export const BAND_M = 25 // band on each side of a reached street
export const MAX_SNAP_M = 100 // no walkable street within this distance: no walk

const SCALE = 100 // Clipper works on whole numbers: 1 unit = 1 cm

// ---------- small geometry helpers ----------

function distPointSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function segsCross(a, b, c, d) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

function distSegSeg(a, b, c, d) {
  if (segsCross(a, b, c, d)) return 0
  return Math.min(distPointSeg(a, c, d), distPointSeg(b, c, d), distPointSeg(c, a, b), distPointSeg(d, a, b))
}

function pointInRing(p, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Point at distance s (metres of the edge's `length`) along a polyline, shared out in proportion to its drawn length.
function cutLine(line, from, to, length) {
  const segLens = []
  let drawn = 0
  for (let i = 1; i < line.length; i++) {
    const l = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
    segLens.push(l)
    drawn += l
  }
  const at = (s) => {
    let d = (s / length) * drawn
    for (let i = 0; i < segLens.length; i++) {
      if (d <= segLens[i] || i === segLens.length - 1) {
        const t = segLens[i] ? Math.min(1, d / segLens[i]) : 0
        const a = line[i], b = line[i + 1]
        return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
      }
      d -= segLens[i]
    }
  }
  const out = [at(from)]
  let acc = 0
  for (let i = 0; i < segLens.length - 1; i++) {
    acc += (segLens[i] / drawn) * length
    if (acc > from && acc < to) out.push(line[i + 1])
  }
  out.push(at(to))
  return out
}

// ---------- the network ----------

export function nearestNode(kit, p) {
  let best = -1, bestD = Infinity
  for (const i of kit.walkable) {
    const d = Math.hypot(kit.nodes[i][0] - p[0], kit.nodes[i][1] - p[1])
    if (d < bestD) { bestD = d; best = i }
  }
  return { node: best, distance: bestD }
}

export function distanceToStreet(kit, p) {
  let best = Infinity
  for (const e of kit.edges) for (let i = 1; i < e.line.length; i++) best = Math.min(best, distPointSeg(p, e.line[i - 1], e.line[i]))
  return best
}

// Shortest walking distance in metres from the start node to every node (Dijkstra).
// If `prev` is given, it is filled with the node each node was reached from, to trace the path back.
// With `weights` (one factor per edge of kit.edges), the way is chosen by length × factor, so preferred streets win;
// `metres` is then filled with the real walking length along that way.
export function walkDistances(kit, start, prev, { weights, metres } = {}) {
  const n = kit.nodes.length
  const adj = Array.from({ length: n }, () => [])
  kit.edges.forEach((e, k) => {
    const w = weights ? e.length * weights[k] : e.length
    adj[e.u].push([e.v, w, e.length])
    adj[e.v].push([e.u, w, e.length])
  })
  if (metres) {
    metres.fill(Infinity)
    metres[start] = 0
  }
  const dist = new Float64Array(n).fill(Infinity)
  dist[start] = 0
  if (prev) prev.fill(-1)
  const heap = [[0, start]]
  const push = (item) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0], last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  while (heap.length) {
    const [d, u] = pop()
    if (d > dist[u]) continue
    for (const [v, w, len] of adj[u]) {
      if (d + w < dist[v]) {
        dist[v] = d + w
        if (prev) prev[v] = u
        if (metres) metres[v] = metres[u] + len
        push([dist[v], v])
      }
    }
  }
  return dist
}

// The parts of the streets you reach within `budget` metres, as polylines.
// From each end you get as far into the edge as the remaining budget allows; if the two parts meet, the whole edge.
export function reachedLines(kit, dist, budget) {
  const lines = []
  for (const e of kit.edges) {
    const L = e.length
    const a = Math.max(0, Math.min(L, budget - dist[e.u]))
    const b = Math.max(0, Math.min(L, budget - dist[e.v]))
    if (a + b >= L) lines.push(e.line)
    else {
      if (a > 0) lines.push(cutLine(e.line, 0, a, L))
      if (b > 0) lines.push(cutLine(e.line, L - b, L, L))
    }
  }
  return lines
}

// ---------- the area: reached streets with a band on each side, joined into one shape ----------

export function bandArea(lines, band = BAND_M) {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE) // round ends and corners, within 25 cm
  co.AddPaths(
    lines.map((l) => l.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etOpenRound,
  )
  const tree = new ClipperLib.PolyTree()
  co.Execute(tree, band * SCALE)
  const paths = ClipperLib.Clipper.PolyTreeToPaths(tree)

  // Outlines with their holes, in metres, for drawing.
  const toM = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE])
  const polygons = []
  const walk = (node) => {
    for (const outer of node.Childs()) {
      polygons.push({ outer: toM(outer.Contour()), holes: outer.Childs().map((h) => toM(h.Contour())) })
      for (const hole of outer.Childs()) walk(hole)
    }
  }
  walk(tree)

  const area = paths.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0) / (SCALE * SCALE)
  return { paths, polygons, area }
}

// ---------- what lies in the area ----------

// A building touches the area when some part of it is within the band of a reached street.
export function buildingsTouching(buildings, lines, band = BAND_M) {
  const G = 50
  const grid = new Map()
  const segs = []
  for (const l of lines) for (let i = 1; i < l.length; i++) segs.push([l[i - 1], l[i]])
  segs.forEach(([a, b], k) => {
    const gx0 = Math.floor((Math.min(a[0], b[0]) - band) / G), gx1 = Math.floor((Math.max(a[0], b[0]) + band) / G)
    const gy0 = Math.floor((Math.min(a[1], b[1]) - band) / G), gy1 = Math.floor((Math.max(a[1], b[1]) + band) / G)
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
      const key = gx + ',' + gy
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key).push(k)
    }
  })

  const hit = new Set()
  buildings.forEach((bld, idx) => {
    const [x0, y0, x1, y1] = bld.bbox
    const seen = new Set()
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gy = Math.floor(y0 / G); gy <= Math.floor(y1 / G); gy++) {
      for (const k of grid.get(gx + ',' + gy) ?? []) {
        if (seen.has(k)) continue
        seen.add(k)
        const [a, b] = segs[k]
        if (pointInRing(a, bld.rings[0])) { hit.add(idx); return }
        for (const ring of bld.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          if (distSegSeg(a, b, ring[j], ring[i]) <= band) { hit.add(idx); return }
        }
      }
    }
  })
  return hit
}

// Residents: each overlapping cell's population times the share of the cell inside the area.
// Cells without a published figure are left out and counted separately.
export function residentsIn(cells, area) {
  const [ax0, ay0, ax1, ay1] = area.paths.flat().reduce(
    (b, p) => [Math.min(b[0], p.X), Math.min(b[1], p.Y), Math.max(b[2], p.X), Math.max(b[3], p.Y)],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
  const intersect = (subject, clip) => {
    const c = new ClipperLib.Clipper()
    c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true)
    c.AddPaths(clip, ClipperLib.PolyType.ptClip, true)
    const out = new ClipperLib.Paths()
    c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
    return out
  }
  const toInt = (ring) => ring.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))

  // For speed, first cut the area into strips, one per row of cells; then each cell is cut from its strip only.
  const rows = new Map()
  for (const cell of cells) {
    const [x0, y0, x1, y1] = cell.bbox.map((v) => v * SCALE)
    if (x1 < ax0 || x0 > ax1 || y1 < ay0 || y0 > ay1) continue
    const key = Math.round((cell.bbox[1] + cell.bbox[3]) / 200)
    if (!rows.has(key)) rows.set(key, [])
    rows.get(key).push(cell)
  }

  let sum = 0, withoutFigure = 0, overlapping = 0
  for (const row of rows.values()) {
    const y0 = Math.min(...row.map((c) => c.bbox[1])) - 1, y1 = Math.max(...row.map((c) => c.bbox[3])) + 1
    const x0 = Math.min(...row.map((c) => c.bbox[0])) - 1, x1 = Math.max(...row.map((c) => c.bbox[2])) + 1
    const strip = intersect(area.paths, [toInt([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])])
    if (!strip.length) continue
    for (const cell of row) {
      const out = intersect([toInt(cell.ring)], strip)
      const inside = Math.abs(out.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0)) / (SCALE * SCALE)
      if (inside <= 0) continue
      overlapping++
      if (cell.population == null) withoutFigure++
      else sum += cell.population * Math.min(1, inside / cell.area)
    }
  }
  return { residents: Math.round(sum / 10) * 10, exact: sum, withoutFigure, overlapping }
}

// About how many metres you walk to reach a building: the shortest walk to a point on a street
// that passes within the band of the building.
export function walkToBuilding(kit, dist, bld, band = BAND_M) {
  const [x0, y0, x1, y1] = bld.bbox
  let best = Infinity
  for (const e of kit.edges) {
    const [a, b] = [e.line[0], e.line[e.line.length - 1]]
    if (Math.max(a[0], b[0]) < x0 - band || Math.min(a[0], b[0]) > x1 + band) continue
    if (Math.max(a[1], b[1]) < y0 - band || Math.min(a[1], b[1]) > y1 + band) continue
    let near = false
    for (const ring of bld.rings) for (let i = 0, j = ring.length - 1; i < ring.length && !near; j = i++) {
      if (distSegSeg(a, b, ring[j], ring[i]) <= band) near = true
    }
    if (!near) continue
    // The point of the street closest to each corner of the building, reached from either end.
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy
    for (const ring of bld.rings) for (const p of ring) {
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
      best = Math.min(best, dist[e.u] + t * e.length, dist[e.v] + (1 - t) * e.length)
    }
  }
  return best
}

// Buildings with shop floor area in the 5-minute area, nearest first.
export function shopsIn(kit, dist, level) {
  const budget = level.minutes * SPEED_M_PER_MIN
  return [...level.buildings]
    .filter((i) => kit.buildings[i].retail > 0)
    .map((i) => ({ index: i, building: kit.buildings[i], metres: Math.min(budget, walkToBuilding(kit, dist, kit.buildings[i])) }))
    .sort((p, q) => p.metres - q.metres)
}

// ---------- everything for one click ----------

export function computeReach(kit, point) {
  const street = distanceToStreet(kit, point)
  if (street > MAX_SNAP_M) return { ok: false, street }
  const { node } = nearestNode(kit, point)
  const dist = walkDistances(kit, node)
  const levels = MINUTES.map((min) => {
    const lines = reachedLines(kit, dist, min * SPEED_M_PER_MIN)
    const area = bandArea(lines)
    const buildings = buildingsTouching(kit.buildings, lines)
    return { minutes: min, lines, area, buildings, ...residentsIn(kit.cells, area) }
  })
  return { ok: true, node, start: kit.nodes[node], levels, shops: shopsIn(kit, dist, levels[0]) }
}
