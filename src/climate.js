// Micro-climate of the streets: how much of each street is in shade, in sun, or close to building facades.
// Shade is cast by the LoD2 buildings for the sun's real position at each hour of the walk. Parks and cemeteries
// count as shade from tree canopy: the kit has no trees, so their plots stand in for them.

const SAMPLE_M = 8 // a sample point every 8 m along every street
const CELL_M = 25 // grid cell for finding buildings and parks quickly
const STEP_M = 4 // how far apart the shadow test looks along the line towards the sun
const MAX_SHADOW_M = 200 // no building in the kit casts a longer shadow worth counting
const FACADE_M = 6 // a street point this close to a facade counts as "along facades"
const FACADE_MIN_H = 6 // ...if the building is at least this tall (about two floors)
const LAT = 50.98, LON = 11.33

// ---------- small geometry ----------

function pointInRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distToRing(x, y, ring) {
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i]
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy))
  }
  return best
}

function makeGrid(items, bboxOf) {
  const grid = new Map()
  items.forEach((it, k) => {
    const [x0, y0, x1, y1] = bboxOf(it)
    for (let gx = Math.floor(x0 / CELL_M); gx <= Math.floor(x1 / CELL_M); gx++)
      for (let gy = Math.floor(y0 / CELL_M); gy <= Math.floor(y1 / CELL_M); gy++) {
        const key = gx + ',' + gy
        if (!grid.has(key)) grid.set(key, [])
        grid.get(key).push(k)
      }
  })
  return (x, y) => grid.get(Math.floor(x / CELL_M) + ',' + Math.floor(y / CELL_M)) ?? []
}

const ringBox = (ring) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  return [x0, y0, x1, y1]
}

// ---------- the sun ----------

// Minutes after midnight in Weimar on `date` ('YYYY-MM-DD') to a JavaScript time (UTC milliseconds).
export function weimarTime(date, minutes) {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60000
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(guess))
    .find((p) => p.type === 'timeZoneName').value // "GMT+1" or "GMT+2"
  const offset = Number(name.replace('GMT', '') || 0)
  return guess - offset * 3600000
}

// The sun's direction at a moment: azimuth clockwise from north and elevation above the horizon, in radians.
// A standard low-precision formula; good to a fraction of a degree, plenty for shadows of houses.
export function sunPosition(ms, lat = LAT, lon = LON) {
  const rad = Math.PI / 180
  const d = ms / 86400000 + 2440587.5 - 2451545.0 // days since 1 January 2000, noon
  const g = (357.529 + 0.98560028 * d) * rad
  const q = 280.459 + 0.98564736 * d
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const e = (23.439 - 0.00000036 * d) * rad
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))
  const dec = Math.asin(Math.sin(e) * Math.sin(L))
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24
  const ha = (gmst * 15 + lon) * rad - ra
  const phi = lat * rad
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha))
  const azimuth = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha))
  return { azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI), elevation }
}

// ---------- the streets, sampled once per kit ----------

const cache = new WeakMap()

// Sample points along every street, with what does not change during the day: in a park, along a facade.
export function streetSamples(kit) {
  if (cache.has(kit)) return cache.get(kit)
  const buildingsAt = makeGrid(kit.buildings, (b) => b.bbox)
  const greenAt = makeGrid(kit.green, (g) => ringBox(g.outer))

  const xs = [], ys = [], edgeOf = [], park = [], facade = []
  kit.edges.forEach((e, k) => {
    const line = e.line
    let drawn = 0
    for (let i = 1; i < line.length; i++) drawn += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
    const n = Math.max(1, Math.round(drawn / SAMPLE_M))
    // Points in the middle of n equal pieces of the line.
    let seg = 0, segStart = 0
    for (let s = 0; s < n; s++) {
      const at = ((s + 0.5) / n) * drawn
      while (seg < line.length - 2) {
        const l = Math.hypot(line[seg + 1][0] - line[seg][0], line[seg + 1][1] - line[seg][1])
        if (segStart + l >= at) break
        segStart += l
        seg++
      }
      const [ax, ay] = line[seg], [bx, by] = line[seg + 1]
      const l = Math.hypot(bx - ax, by - ay) || 1
      const t = Math.min(1, (at - segStart) / l)
      const x = ax + t * (bx - ax), y = ay + t * (by - ay)
      xs.push(x); ys.push(y); edgeOf.push(k)
      park.push(greenAt(x, y).some((g) => pointInRing(x, y, kit.green[g].outer) && !kit.green[g].holes.some((h) => pointInRing(x, y, h))))
      let near = false
      for (const gx of [-1, 0, 1]) for (const gy of [-1, 0, 1]) {
        if (near) break
        for (const b of buildingsAt(x + gx * CELL_M, y + gy * CELL_M)) {
          const bl = kit.buildings[b]
          if (bl.height < FACADE_MIN_H) continue
          const [x0, y0, x1, y1] = bl.bbox
          if (x < x0 - FACADE_M || x > x1 + FACADE_M || y < y0 - FACADE_M || y > y1 + FACADE_M) continue
          if (distToRing(x, y, bl.rings[0]) <= FACADE_M) { near = true; break }
        }
      }
      facade.push(near)
    }
  })
  const out = { xs: Float64Array.from(xs), ys: Float64Array.from(ys), edgeOf: Int32Array.from(edgeOf), park, facade, buildingsAt }
  cache.set(kit, out)
  return out
}

// Is this street point in the shadow of a building, with the sun in this direction?
function inShadow(kit, S, x, y, sun) {
  const dx = Math.sin(sun.azimuth), dy = Math.cos(sun.azimuth), slope = Math.tan(sun.elevation)
  const reach = Math.min(MAX_SHADOW_M, 60 / slope) // the tallest buildings are under 60 m
  for (let t = STEP_M / 2; t <= reach; t += STEP_M) {
    const qx = x + dx * t, qy = y + dy * t, need = t * slope
    for (const b of S.buildingsAt(qx, qy)) {
      const bl = kit.buildings[b]
      if (bl.height <= need) continue
      const [x0, y0, x1, y1] = bl.bbox
      if (qx < x0 || qx > x1 || qy < y0 || qy > y1) continue
      if (pointInRing(qx, qy, bl.rings[0])) return true
    }
  }
  return false
}

// For every street: the share of it that is shaded, averaged over the daylight hours of the walk;
// in sun (the rest); and along facades. Arrays in the order of kit.edges, values from 0 to 1.
export function streetClimate(kit, date, startMin, durationMin) {
  const S = streetSamples(kit)
  const n = kit.edges.length
  const count = new Float64Array(n)
  for (const k of S.edgeOf) count[k]++

  const facade = new Float64Array(n)
  S.edgeOf.forEach((k, i) => S.facade[i] && (facade[k] += 1 / count[k]))

  // One sun position per hour of the walk, at the middle of the hour; only while the sun is up.
  const suns = []
  for (let m = startMin + 30; m < startMin + durationMin; m += 60) {
    const sun = sunPosition(weimarTime(date, m))
    if (sun.elevation > (3 * Math.PI) / 180) suns.push(sun)
  }
  const shade = new Float64Array(n)
  if (!suns.length) shade.fill(1) // no direct sun at all during the walk
  else
    S.edgeOf.forEach((k, i) => {
      let shaded = 0
      for (const sun of suns) if (S.park[i] || inShadow(kit, S, S.xs[i], S.ys[i], sun)) shaded++
      shade[k] += shaded / suns.length / count[k]
    })
  const sun = shade.map((s) => 1 - s)
  return { shade, sun, facade, hours: suns.length }
}

// ---------- preferences to routing ----------

export const PATHS = {
  shelter: { metric: 'facade', label: 'along building facades', icon: '☂' },
  shade: { metric: 'shade', label: 'in shade', icon: '◐' },
  sun: { metric: 'sun', label: 'in the sun', icon: '☀' },
}
export const DETOUR = 2 // a street with none of what you want counts as up to three times as long when choosing the way

// How much longer each street seems when choosing the way, so the preferred streets win unless the detour is large.
export function streetWeights(climate, path) {
  const good = climate[PATHS[path].metric]
  return Float64Array.from(good, (g) => 1 + DETOUR * (1 - g))
}

// Share of a walk (a list of edge indices) that has the quality, weighted by length.
export function shareOf(kit, edges, values) {
  let total = 0, good = 0
  for (const k of edges) {
    total += kit.edges[k].length
    good += kit.edges[k].length * values[k]
  }
  return total ? good / total : 0
}
