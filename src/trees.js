// Schematic trees for the parks and cemeteries. The kit has no tree data, so these are not real trees: they are
// scattered on a jittered grid inside the green plots, kept off the footpaths and out of buildings, with a fixed
// random seed so they stand in the same places every time.
import { streetSamples } from './climate.js'

const SPACING = { recreation: 13, cemetery: 17 } // metres between trees
const PATH_CLEAR_M = 5 // no tree this close to a footpath

// A small seeded random number generator (mulberry32).
function random(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pointInRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// [{ x, y, height, crown, shade }]: position in metres, total height, crown radius, and a shade from 0 to 1.
export function plantTrees(kit) {
  const S = streetSamples(kit)
  // The street sample points on a 10 m grid, to keep trees off the paths.
  const near = new Map()
  for (let i = 0; i < S.xs.length; i++) {
    const key = Math.floor(S.xs[i] / 10) + ',' + Math.floor(S.ys[i] / 10)
    if (!near.has(key)) near.set(key, [])
    near.get(key).push(i)
  }
  const onPath = (x, y) => {
    const gx = Math.floor(x / 10), gy = Math.floor(y / 10)
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const i of near.get(gx + a + ',' + (gy + b)) ?? []) if (Math.hypot(S.xs[i] - x, S.ys[i] - y) < PATH_CLEAR_M) return true
    return false
  }
  const inBuilding = (x, y) =>
    S.buildingsAt(x, y).some((b) => {
      const [x0, y0, x1, y1] = kit.buildings[b].bbox
      return x >= x0 && x <= x1 && y >= y0 && y <= y1 && pointInRing(x, y, kit.buildings[b].rings[0])
    })

  const trees = []
  kit.green.forEach((g, k) => {
    const rnd = random(1000 + k)
    const step = SPACING[g.landuse] ?? 15
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of g.outer) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
    for (let gx = x0 + step / 2; gx < x1; gx += step)
      for (let gy = y0 + step / 2; gy < y1; gy += step) {
        const x = gx + (rnd() - 0.5) * step * 0.7
        const y = gy + (rnd() - 0.5) * step * 0.7
        const size = rnd(), tint = rnd()
        if (!pointInRing(x, y, g.outer) || g.holes.some((h) => pointInRing(x, y, h))) continue
        if (onPath(x, y) || inBuilding(x, y)) continue
        const crown = 3.2 + size * 2.6
        trees.push({ x, y, crown, height: crown * 2 + 2 + size * 3, shade: tint })
      }
  })
  return trees
}
