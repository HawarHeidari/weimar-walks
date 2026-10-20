// The route planner: a small orienteering problem on the pedestrian network.
// Start and end at a bus stop, keep the must-sees, fill the rest of the time with the places that fit the vibe best,
// then reorder the stops so the walk doesn't double back.
import { nearestNode, walkDistances, SPEED_M_PER_MIN } from './reach.js'

export const VIBES = [
  { id: 'classic', label: 'Classic' },
  { id: 'modern', label: 'Modern' },
  { id: 'nature', label: 'Nature' },
  { id: 'surprise', label: 'Surprise me' },
]
export const VISITORS = [
  { id: 'bauhaus', label: 'Bauhaus students', note: 'free' },
  { id: 'student', label: 'Other students', note: 'discounted' },
  { id: 'adult', label: 'Adults', note: 'full price' },
]
export const LONG_STOP_WALK_MIN = 5 // a must-see further than this from its bus stop gets the bad-weather question

// ---------- where a walk can start and end ----------

// Stations and bus stops, then the landmarks. An endpoint at a landmark is only its door: the visit itself is
// a separate stop, which the planner may still add.
export function endpointsOf(poi) {
  return [
    ...poi.bus_stops.map((s) => ({
      id: `stop:${s.id}`,
      name: s.id === 'hbf' ? s.name : `${s.name} bus stop`,
      group: 'Stations and bus stops',
      xy: s.xy,
    })),
    ...poi.places
      .filter((p) => p.landmark)
      .map((p) => ({ id: `at:${p.id}`, name: p.name, group: 'Landmarks', xy: p.xy })),
  ]
}

// ---------- once per kit: walking minutes between every pair of points, and the streets in between ----------

// weights: optional, one factor per street (see streetWeights in climate.js). The way between two points is then
// the one with the least length × factor, while the minutes are still the real walking time along it.
export function prepareNetwork(kit, weights = null) {
  const { poi } = kit
  const ends = endpointsOf(poi).map((e) => ({ ...e, visit_min: 0, endpoint: true }))
  const points = [...ends, ...poi.places]
  const snap = points.map((p) => nearestNode(kit, p.xy))

  // Real metres from one street node to every node, along the chosen ways.
  const walk = (node, prev) => {
    if (!weights) return walkDistances(kit, node, prev)
    const metres = new Float64Array(kit.nodes.length)
    walkDistances(kit, node, prev, { weights, metres })
    return metres
  }

  const prevs = [], dists = []
  for (const s of snap) {
    const prev = new Int32Array(kit.nodes.length)
    dists.push(walk(s.node, prev))
    prevs.push(prev)
  }
  // From a point to its nearest street node in a straight line, then along the streets.
  const minutes = points.map((_, a) =>
    points.map((_, b) => (a === b ? 0 : (dists[a][snap[b].node] + snap[a].distance + snap[b].distance) / SPEED_M_PER_MIN)),
  )

  // Walk from each place's own bus stop, plus the walking inside the place (a park, for example).
  const busWalk = points.map((p, k) => {
    if (p.endpoint) return 0
    const stop = poi.bus_stops.find((s) => s.id === p.bus_stop)
    if (!stop) return 0
    const s = nearestNode(kit, stop.xy)
    return (dists[k][s.node] + s.distance + snap[k].distance) / SPEED_M_PER_MIN + (p.extra_walk_min ?? 0)
  })

  // Between two nodes, the street the search would take: the one with the least (weighted) length.
  const edgeAt = new Map()
  const cost = (k) => kit.edges[k].length * (weights ? weights[k] : 1)
  kit.edges.forEach((e, k) => {
    const key = Math.min(e.u, e.v) + ',' + Math.max(e.u, e.v)
    if (!edgeAt.has(key) || cost(edgeAt.get(key)) > cost(k)) edgeAt.set(key, k)
  })
  // The streets of the walk from point a to point b, as indices into kit.edges.
  const legEdges = (a, b) => {
    const out = []
    let t = snap[b].node
    while (t !== snap[a].node && prevs[a][t] >= 0) {
      const u = prevs[a][t]
      out.push(edgeAt.get(Math.min(u, t) + ',' + Math.max(u, t)))
      t = u
    }
    return out
  }
  // The walk from a to b as one line of points in walking order, for the time-lapse.
  const legPath = (a, b) => {
    const nodes = [snap[b].node]
    let t = snap[b].node
    while (t !== snap[a].node && prevs[a][t] >= 0) {
      t = prevs[a][t]
      nodes.push(t)
    }
    nodes.reverse()
    const pts = [points[a].xy, kit.nodes[nodes[0]]]
    for (let i = 1; i < nodes.length; i++) {
      const u = nodes[i - 1], v = nodes[i]
      const e = kit.edges[edgeAt.get(Math.min(u, v) + ',' + Math.max(u, v))]
      pts.push(...(e.u === u ? e.line : [...e.line].reverse()).slice(1))
    }
    pts.push(points[b].xy)
    return pts
  }
  // The same walk as polylines, with the short straight bits at both ends.
  const legLines = (a, b) => [
    [points[b].xy, kit.nodes[snap[b].node]],
    ...legEdges(a, b).map((k) => kit.edges[k].line),
    [kit.nodes[snap[a].node], points[a].xy],
  ]

  // A start or end point clicked on the map: { id, name, xy }. It joins the table of walking minutes on first use.
  const addEndpoint = (ep) => {
    const found = points.findIndex((p) => p.id === ep.id)
    if (found >= 0) return found
    const k = points.length
    const s = nearestNode(kit, ep.xy)
    const prev = new Int32Array(kit.nodes.length)
    points.push({ ...ep, visit_min: 0, endpoint: true })
    snap.push(s)
    dists.push(walk(s.node, prev))
    prevs.push(prev)
    // Edges have no direction, so the walk there takes as long as the walk back.
    const row = points.map((_, b) => (b === k ? 0 : (dists[k][snap[b].node] + s.distance + snap[b].distance) / SPEED_M_PER_MIN))
    minutes.forEach((r, a) => r.push(row[a]))
    minutes.push(row)
    busWalk.push(0)
    return k
  }

  return { points, minutes, busWalk, legLines, legEdges, legPath, addEndpoint, transit: poi.transit }
}

// The vibe a place fits best, for its colour and icon.
export function mainVibe(p) {
  const { classic = 0, modern = 0, nature = 0 } = p.vibes ?? {}
  return nature >= classic && nature >= modern ? 'nature' : modern > classic ? 'modern' : 'classic'
}

// ---------- the plan ----------

const tourMinutes = (net, seq) => {
  let t = 0
  for (let i = 0; i < seq.length; i++) {
    t += net.points[seq[i]].visit_min
    if (i > 0) t += net.minutes[seq[i - 1]][seq[i]]
  }
  return t
}

// The clock time you arrive at each stop.
const arrivals = (net, seq, startMin) => {
  const out = [startMin]
  for (let i = 1; i < seq.length; i++) out.push(out[i - 1] + net.points[seq[i - 1]].visit_min + net.minutes[seq[i - 1]][seq[i]])
  return out
}

// Entry for the whole group at one place, and the bus for the whole group.
const groupPrice = (p, counts) => VISITORS.reduce((s, v) => s + (p.price?.[v.id] ?? 0) * (counts[v.id] ?? 0), 0)
const busPrice = (net, counts, useBus) =>
  useBus ? VISITORS.reduce((s, v) => s + net.transit.trips * (net.transit.price[v.id] ?? 0) * (counts[v.id] ?? 0), 0) : 0
const spentOn = (net, seq, opts) => busPrice(net, opts.counts, opts.useBus) + seq.reduce((s, k) => s + groupPrice(net.points[k], opts.counts), 0)

function vibeWeights(vibe) {
  if (vibe !== 'surprise') return { classic: 0, modern: 0, nature: 0, [vibe]: 1 }
  const w = { classic: Math.random(), modern: Math.random(), nature: Math.random() }
  const sum = w.classic + w.modern + w.nature
  for (const k in w) w[k] /= sum
  return w
}

const matchOf = (p, w) => !p.vibes ? 0 : p.vibes.classic * w.classic + p.vibes.modern * w.modern + p.vibes.nature * w.nature

// How much a place is worth adding. A good vibe match counts far more than anything else.
function scoreOf(net, k, weights, vibe, weather, rainOk) {
  const p = net.points[k]
  const match = matchOf(p, weights)
  let s = 1 + 20 * match * match
  if (vibe === 'surprise') s *= 0.6 + 0.8 * Math.random()
  if (weather?.extreme) s *= p.indoor ? 1.3 : net.busWalk[k] > LONG_STOP_WALK_MIN ? 0.4 : 0.8
  else if (weather?.rainy && !p.indoor && !rainOk) s *= 0.3 // unless you chose to walk in the rain
  return s
}

// Swap the order of a run of stops whenever that makes the walk shorter (2-opt). Start and end stay put.
function untangle(net, seq) {
  const d = net.minutes
  let better = true
  while (better) {
    better = false
    for (let i = 1; i < seq.length - 2; i++) {
      for (let j = i + 1; j < seq.length - 1; j++) {
        const before = d[seq[i - 1]][seq[i]] + d[seq[j]][seq[j + 1]]
        const after = d[seq[i - 1]][seq[j]] + d[seq[i]][seq[j + 1]]
        if (after < before - 1e-6) {
          seq.splice(i, j - i + 1, ...seq.slice(i, j + 1).reverse())
          better = true
        }
      }
    }
  }
  return seq
}

// Add the place with the best worth per extra minute, at its cheapest spot in the tour, until nothing more fits.
// A place with an entry fee is only added while the group's money lasts; free places always may be.
function fill(net, seq, minutes, scores, opts) {
  const d = net.minutes
  const maxSpend = opts.maxBudget ?? Infinity
  for (;;) {
    const used = tourMinutes(net, seq)
    const spent = spentOn(net, seq, opts)
    let best = null
    for (let k = 0; k < net.points.length; k++) {
      if (seq.includes(k) || scores[k] == null) continue
      const price = groupPrice(net.points[k], opts.counts)
      if (price > 0 && spent + price > maxSpend + 1e-9) continue
      let cheapest = Infinity, at = -1
      for (let i = 0; i < seq.length - 1; i++) {
        const extra = d[seq[i]][k] + d[k][seq[i + 1]] - d[seq[i]][seq[i + 1]]
        if (extra < cheapest) { cheapest = extra; at = i + 1 }
      }
      const extra = cheapest + net.points[k].visit_min
      if (used + extra > minutes) continue
      const ratio = scores[k] / Math.max(extra, 1)
      if (!best || ratio > best.ratio) best = { k, at, ratio }
    }
    if (!best) return seq
    seq.splice(best.at, 0, best.k)
  }
}

// Times, costs and street lines for a finished order of stops. `forced` is a stop added for a dry window.
export function describeRoute(net, plan, seq, forced = null) {
  const { opts, anchors } = plan
  const arrive = arrivals(net, seq, opts.startMin)
  const stops = seq.map((k, i) => {
    const p = net.points[k]
    const last = i === seq.length - 1
    const visit = i === 0 || last ? 0 : p.visit_min
    return {
      index: k,
      place: p,
      walkMin: i > 0 ? net.minutes[seq[i - 1]][k] : 0,
      arrive: arrive[i],
      leave: arrive[i] + visit,
      anchor: anchors.includes(k),
      dry: k === forced && i > 0 && !last,
      end: last,
    }
  })

  const cost = { total: 0, byType: {} }
  for (const { id } of VISITORS) {
    const n = opts.counts[id] ?? 0
    const entry = stops.reduce((s, st) => s + (st.place.price?.[id] ?? 0), 0)
    const bus = opts.useBus ? net.transit.trips * (net.transit.price[id] ?? 0) : 0
    cost.byType[id] = { n, entry: entry * n, bus: bus * n, total: (entry + bus) * n }
    cost.total += (entry + bus) * n
  }
  const budget =
    opts.maxBudget == null ? null : { max: opts.maxBudget, left: opts.maxBudget - cost.total, over: cost.total > opts.maxBudget + 1e-9 }

  // paths[i]: the walk from stop i to stop i + 1, in walking order, for the time-lapse.
  const lines = [], edges = [], paths = []
  for (let i = 1; i < seq.length; i++) {
    lines.push(...net.legLines(seq[i - 1], seq[i]))
    edges.push(...net.legEdges(seq[i - 1], seq[i]))
    paths.push(net.legPath(seq[i - 1], seq[i]))
  }

  const totalMin = tourMinutes(net, seq)
  return { ...plan, ok: true, seq, stops, totalMin, freeMin: opts.durationMin - totalMin, cost, budget, lines, edges, paths }
}

// opts: counts { bauhaus, student, adult }, startMin minutes after midnight, durationMin, vibe id,
// anchors: place ids, start and end: endpoint ids from endpointsOf(), weather: from summarise() in weather.js,
// useBus: true to add the bus tickets,
// maxBudget: the most the whole group wants to spend in €, or null for no limit,
// rainOk: true when you chose to walk in the rain, so outdoor places are not avoided on a mildly rainy day.
export function planRoute(net, opts) {
  const at = (id) => net.points.findIndex((p) => p.id === id)
  const start = at(opts.start), end = at(opts.end)
  if (start < 0 || end < 0) throw new Error(`Unknown start or end point: ${opts.start}, ${opts.end}`)
  const anchors = opts.anchors.map(at).filter((k) => k >= 0 && !net.points[k].endpoint)

  // The must-sees alone, in their shorter order.
  let seq = [start, ...anchors, end]
  if (anchors.length === 2) {
    const other = [start, anchors[1], anchors[0], end]
    if (tourMinutes(net, other) < tourMinutes(net, seq)) seq = other
  }
  const mandatoryMin = tourMinutes(net, seq)
  if (mandatoryMin > opts.durationMin) return { ok: false, mandatoryMin }
  const mandatoryCost = spentOn(net, seq, opts)

  const weights = vibeWeights(opts.vibe)
  // On a rainy day with a dry hour, outdoor places are kept back for the dry-window offer, unless you chose the rain.
  const saveForDry = opts.weather?.rainy && !opts.rainOk && opts.weather.dry?.length > 0
  const scores = net.points.map((p, k) =>
    p.endpoint || (saveForDry && !p.indoor && !anchors.includes(k)) ? null : scoreOf(net, k, weights, opts.vibe, opts.weather, opts.rainOk),
  )

  // Fill, untangle, and fill again with the minutes the untangling saved.
  for (let round = 0; round < 2; round++) untangle(net, fill(net, seq, opts.durationMin, scores, opts))

  return describeRoute(net, { opts, anchors, weights, scores, mandatoryMin, mandatoryCost }, seq)
}

// ---------- a dry hour in a rainy day ----------

// Look for an outdoor place that fits the vibe and can be visited while it is dry.
// Returns null, or { place, index, addedMin, window, seq, dropped }: the new order, with the place inserted where you
// arrive inside the dry window. If the day gets too long, the least valuable stops after it are left out, so the
// time you reach it doesn't move.
export function findDryWindow(net, route, weather) {
  if (!route?.ok || !weather?.dry?.length) return null
  const { opts, weights, scores, anchors, seq } = route
  const before = tourMinutes(net, seq)
  const spent = spentOn(net, seq, opts)
  const maxSpend = opts.maxBudget ?? Infinity

  const candidates = net.points
    .map((p, k) => ({ p, k, match: matchOf(p, weights) }))
    .filter(({ p, k, match }) => !p.endpoint && !p.indoor && !seq.includes(k) && match >= 0.2)
    .filter(({ p }) => {
      const price = groupPrice(p, opts.counts)
      return price === 0 || spent + price <= maxSpend + 1e-9
    })
    .sort((a, b) => b.match - a.match || net.busWalk[a.k] - net.busWalk[b.k])

  for (const { p, k } of candidates) {
    let best = null
    for (const w of weather.dry) {
      for (let i = 1; i < seq.length; i++) {
        const trial = [...seq.slice(0, i), k, ...seq.slice(i)]
        const at = arrivals(net, trial, opts.startMin)[i]
        // Minutes of the visit that fall outside the dry window; at most a third of it.
        const wet = Math.max(0, w.start - at) + Math.max(0, at + p.visit_min - w.end)
        if (wet > p.visit_min / 3) continue
        const added = tourMinutes(net, trial) - before
        const cost = added + 3 * wet
        if (!best || cost < best.cost) best = { cost, added, trial, at: i, window: w }
      }
    }
    if (!best) continue

    const trial = best.trial
    const dropped = []
    while (tourMinutes(net, trial) > opts.durationMin) {
      let worst = -1
      for (let i = best.at + 1; i < trial.length - 1; i++) {
        if (anchors.includes(trial[i])) continue
        if (worst < 0 || scores[trial[i]] < scores[trial[worst]]) worst = i
      }
      if (worst < 0) break
      dropped.push(net.points[trial[worst]].name)
      trial.splice(worst, 1)
    }
    return { place: p, index: k, addedMin: best.added, window: best.window, seq: trial, dropped }
  }
  return null
}

// ---------- weather that changes during the day ----------

// Move stops around so the outdoor ones fall in the better hours, within your time.
// A day planned to the minute has no room to move anything, so a move may also leave out one indoor stop of little value;
// minutes freed that way are filled again with indoor places only, which the weather does not spoil.
// hours: from weather.js, each with `min` (start of the hour, minutes after midnight) and `good` (0 rain … 1 sun).
// Returns { route, before, after, outdoor, dropped }: the share of outdoor minutes in good weather before and after.
export function optimizeForWeather(net, route, hours) {
  const { opts, anchors, scores } = route
  const goodAt = (t) => hours.find((h) => t >= h.min && t < h.min + 60)?.good ?? 1
  // Outdoor visiting minutes, and how many of them are spoiled, looked at in 5-minute steps.
  const exposure = (seq) => {
    const at = arrivals(net, seq, opts.startMin)
    let total = 0, bad = 0
    for (let i = 1; i < seq.length - 1; i++) {
      const p = net.points[seq[i]]
      if (p.indoor) continue
      for (let t = 0; t < p.visit_min; t += 5) {
        const step = Math.min(5, p.visit_min - t)
        total += step
        bad += step * (1 - goodAt(at[i] + t + step / 2))
      }
    }
    return { total, bad }
  }
  // Two minutes of an outdoor visit in bad weather weigh as much as walking four extra minutes, and leaving out a
  // place weighs three minutes for every point of its score (a good vibe match scores about 21, a poor one 1).
  const worth = (seq, lost) => tourMinutes(net, seq) + 2 * exposure(seq).bad + 3 * lost
  const fits = (seq) => tourMinutes(net, seq) <= opts.durationMin + 1e-6
  // Only indoor stops may be left out: the point is to visit the outdoor ones in better weather, not to skip them.
  const droppable = (k) => !net.points[k].endpoint && !anchors.includes(k) && net.points[k].indoor

  let seq = [...route.seq]
  let lost = 0
  const dropped = []
  let best = worth(seq, lost)
  for (let round = 0, better = true; better && round < 50; round++) {
    better = false
    // Take each stop out and try it everywhere else; if that runs over, also try leaving out one other stop.
    for (let i = 1; i < seq.length - 1; i++) {
      for (let j = 1; j < seq.length - 1; j++) {
        if (i === j) continue
        const moved = [...seq]
        const [k] = moved.splice(i, 1)
        moved.splice(j, 0, k)
        const trials = fits(moved)
          ? [{ seq: moved, lost: 0 }]
          : moved
              .map((d, at) => ({ d, at }))
              .filter(({ d, at }) => at > 0 && at < moved.length - 1 && d !== k && droppable(d))
              .map(({ d, at }) => ({ seq: moved.filter((_, x) => x !== at), lost: scores[d] ?? 0, d }))
              .filter((t) => fits(t.seq))
        for (const t of trials) {
          const w = worth(t.seq, lost + t.lost)
          if (w < best - 1e-6) {
            seq = t.seq
            best = w
            better = true
            if (t.d != null) {
              lost += t.lost
              dropped.push(net.points[t.d].name)
            }
          }
        }
      }
    }
  }

  // Fill freed minutes with indoor places only.
  if (dropped.length) {
    const indoorOnly = scores.map((s, k) => (s != null && net.points[k].indoor ? s : null))
    fill(net, seq, opts.durationMin, indoorOnly, opts)
  }

  const share = (s) => {
    const e = exposure(s)
    return e.total ? 1 - e.bad / e.total : 1
  }
  const kept = new Set(seq.map((k) => net.points[k].name))
  return {
    route: describeRoute(net, route, seq),
    before: share(route.seq),
    after: share(seq),
    outdoor: exposure(seq).total,
    dropped: dropped.filter((n) => !kept.has(n)),
  }
}

// ---------- one network per way of choosing streets ----------

const nets = new WeakMap()

// The walking network for a kit: plain (shortest ways), or with `weights` that make some streets preferred.
// Built on first use under `key`, then kept; the first build takes a moment.
export function networkFor(kit, key = 'plain', weights = null) {
  let byKey = nets.get(kit)
  if (!byKey) nets.set(kit, (byKey = new Map()))
  if (!byKey.has(key)) byKey.set(key, prepareNetwork(kit, weights))
  return byKey.get(key)
}

// The same order of stops walked on another network, by place id: its streets and its walking minutes.
export function sameStopsOn(net, seqIds) {
  const seq = seqIds.map((id) => net.points.findIndex((p) => p.id === id))
  const edges = []
  let minutes = 0
  for (let i = 1; i < seq.length; i++) {
    edges.push(...net.legEdges(seq[i - 1], seq[i]))
    minutes += net.minutes[seq[i - 1]][seq[i]]
  }
  return { edges, minutes }
}

// ---------- the quick street preference (step 2) ----------

export const QUICK_PREFS = [
  { id: 'direct', label: 'Direct', hint: 'Shortest ways' },
  { id: 'sun', label: 'Sun', hint: 'Streets in the sun' },
  { id: 'cover', label: 'Cover', hint: 'Shade, or facades in rain' },
]

// The kind of street a quick choice prefers, for this weather: cover means facades when it rains, shade otherwise.
// null: the shortest ways.
export function pathForQuick(choice, weather) {
  if (choice === 'sun') return 'sun'
  if (choice === 'cover') return weather?.rainy ? 'shelter' : 'shade'
  return null
}
