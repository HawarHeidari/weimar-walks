// Loads the city kit and turns longitude/latitude into metres around the kit centre.
// x points east, y points north. Over 2 km the error of this flat projection is a few centimetres.

const R = 6371008.8 // mean Earth radius, metres

export function makeProjection([lon0, lat0]) {
  const k = (Math.PI / 180) * R
  const kx = k * Math.cos((lat0 * Math.PI) / 180)
  return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * k]
}

// The way back: metres around the kit centre to [lon, lat].
export function makeUnprojection([lon0, lat0]) {
  const k = (Math.PI / 180) * R
  const kx = k * Math.cos((lat0 * Math.PI) / 180)
  return ([x, y]) => [lon0 + x / kx, lat0 + y / k]
}

const url = (file) => `${import.meta.env.BASE_URL}data/${file}`

async function getJSON(file) {
  const r = await fetch(url(file))
  if (!r.ok) throw new Error(`data/${file}: ${r.status}`)
  return r.json()
}

// Drop the closing point that repeats the first one.
function openRing(ring) {
  const n = ring.length
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, -1)
  return ring
}

function signedArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  return a / 2
}

function bboxOf(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

// Outer ring counter-clockwise, holes clockwise.
function orientRings(rings) {
  return rings.map((r, i) => {
    const ccw = signedArea(r) > 0
    return (i === 0) === ccw ? r : [...r].reverse()
  })
}

export function prepareKit({ kit, buildings, graph, zensus, places, plots }) {
  const project = makeProjection(kit.center)

  const bldgs = buildings.features.map((f) => {
    const rings = orientRings(f.geometry.coordinates.map((r) => openRing(r).map(project)))
    return {
      id: f.properties.id,
      // One building has no use at all; it is shown with the buildings of unknown use.
      use: f.properties.use ?? 'undefined',
      height: f.properties.height,
      floors: f.properties.floors,
      // Shop floor area in m², estimated for the whole building; 0 if none.
      retail: f.properties.floor_area_m2?.retail ?? 0,
      rings,
      bbox: bboxOf(rings),
    }
  })

  const index = new Map(graph.nodes.map((n, i) => [n.id, i]))
  const nodes = graph.nodes.map((n) => project([n.lon, n.lat]))
  const edges = graph.edges
    .filter((e) => e.walkable)
    .map((e) => ({ u: index.get(e.from), v: index.get(e.to), length: e.length, line: e.coords.map(project) }))
  const walkable = new Set()
  for (const e of edges) walkable.add(e.u).add(e.v)

  const cells = zensus.features.map((f) => {
    const ring = openRing(f.geometry.coordinates[0]).map(project)
    return { id: f.properties.id, population: f.properties.population, ring, area: Math.abs(signedArea(ring)), bbox: bboxOf([ring]) }
  })

  const [w, s, e, n] = kit.bbox
  const [x0, y0] = project([w, s])
  const [x1, y1] = project([e, n])

  // Hand-written places and bus stops for the route planner, with their position in metres.
  const at = (p) => ({ ...p, xy: project([p.lon, p.lat]) })
  const poi = { ...places, places: places.places.map(at), bus_stops: places.bus_stops.map(at) }

  // Parks and cemeteries from the plots, as outlines with holes, for the green on the ground.
  const green = (plots?.features ?? [])
    .filter((f) => f.properties.landuse === 'recreation' || f.properties.landuse === 'cemetery')
    .map((f) => {
      const [outer, ...holes] = f.geometry.coordinates.map((r) => openRing(r).map(project))
      return { landuse: f.properties.landuse, outer, holes }
    })

  const unproject = makeUnprojection(kit.center)

  return { kit, buildings: bldgs, nodes, edges, walkable: [...walkable], cells, extent: [x0, y0, x1, y1], poi, green, unproject }
}

export async function loadKit() {
  const [kit, buildings, graph, zensus, places, plots] = await Promise.all(
    ['kit.json', 'buildings.geojson', 'streets.graph.json', 'zensus.geojson', 'places.json', 'plots.geojson'].map(getJSON),
  )
  return prepareKit({ kit, buildings, graph, zensus, places, plots })
}
