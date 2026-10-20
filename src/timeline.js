// The time-lapse: a shared clock, and where Fiona is on the route at any minute.
// Times are minutes after midnight, as in route.js; positions are [x east, y north] in metres.

// A tiny clock that many parts can read without re-drawing the whole page: the slider listens to it, the 3D scene
// reads it on every frame.
export function createClock(start = 0) {
  let t = start
  const listeners = new Set()
  return {
    get: () => t,
    set(v) {
      if (v === t) return
      t = v
      listeners.forEach((f) => f())
    },
    subscribe(f) {
      listeners.add(f)
      return () => listeners.delete(f)
    },
  }
}

// When the walk starts and ends.
export const spanOf = (route) => [route.stops[0].arrive, route.stops[route.stops.length - 1].arrive]

// Lengths along a line of points, worked out once per line.
const lengths = new WeakMap()
function cumulative(path) {
  if (!lengths.has(path)) {
    const acc = [0]
    for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
    lengths.set(path, acc)
  }
  return lengths.get(path)
}

function pointAt(path, d) {
  const acc = cumulative(path)
  const L = acc[acc.length - 1]
  d = Math.max(0, Math.min(L, d))
  let i = 1
  while (i < acc.length - 1 && acc[i] < d) i++
  const seg = acc[i] - acc[i - 1] || 1
  const f = (d - acc[i - 1]) / seg
  const [ax, ay] = path[i - 1], [bx, by] = path[i]
  return [ax + f * (bx - ax), ay + f * (by - ay)]
}

const LOOK_M = 15 // the walking direction is taken over the next 15 m, so small kinks don't jerk it

// Where on a line, at a share of its length, and which way it heads there (a unit vector).
function along(path, share) {
  const L = cumulative(path).at(-1)
  const d = share * L
  const here = pointAt(path, d)
  const a = d + LOOK_M <= L ? here : pointAt(path, Math.max(0, L - LOOK_M))
  const b = d + LOOK_M <= L ? pointAt(path, d + LOOK_M) : pointAt(path, L)
  const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy)
  return { xy: here, heading: n > 0.01 ? [dx / n, dy / n] : null }
}

// Fiona at time t: { xy, heading, walking, stop, next }.
// walking: true between stops; stop: the index of the stop she is at (visiting), or came from; next: where she goes.
export function poseAt(route, t) {
  const s = route.stops, P = route.paths
  const lastHeading = (i) => along(P[i], 1).heading
  if (t <= s[0].leave) return { xy: s[0].place.xy, heading: along(P[0], 0).heading, walking: false, stop: 0, next: 1 }
  for (let i = 1; i < s.length; i++) {
    const from = s[i - 1], to = s[i]
    if (t < to.arrive) {
      const span = to.arrive - from.leave
      const p = along(P[i - 1], span > 0 ? (t - from.leave) / span : 1)
      return { xy: p.xy, heading: p.heading ?? lastHeading(i - 1), walking: true, stop: i - 1, next: i }
    }
    if (t <= to.leave || i === s.length - 1) return { xy: to.place.xy, heading: lastHeading(i - 1), walking: false, stop: i, next: i + 1 }
  }
}

// Everything the route passes through, for framing it from above: [x0, y0, x1, y1].
export function boundsOf(route) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const path of route.paths)
    for (const [x, y] of path) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
  return [x0, y0, x1, y1]
}

// The forecast hour that minute t falls in (hours from weather.js, each with `min`, the start of the hour).
// Before the first or after the last hour: the nearest one. null without a forecast.
export function hourAt(hours, t) {
  if (!hours?.length) return null
  const k = Math.floor((t - hours[0].min) / 60)
  return hours[Math.max(0, Math.min(hours.length - 1, k))]
}

// How hard it rains, from 0 (dry: no rain at all is drawn) to 1 (a downpour of 8 mm an hour or more).
// The square root makes light rain still visible and keeps heavy rain from saturating too soon.
export function rainStrength(mm) {
  return mm > 0 ? Math.min(1, Math.sqrt(mm / 8)) : 0
}
