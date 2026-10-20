// The 3D city on a dark ground: streets, buildings, parks and trees, the walking areas, the planned route with
// Fiona walking it, and the landmarks.
// Plan coordinates [x east, y north] in metres become three.js [x, height, -y].
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  USE_COLORS,
  REACH_COLORS,
  GROUND,
  BACKGROUND,
  STREET,
  ROUTE,
  ROUTE_ANCHOR,
  ROUTE_DRY,
  BAUHAUS,
  LANDMARK_CLASSIC,
  LANDMARK_MODERN,
  PARK,
  CEMETERY,
  MOODS,
} from './palette.js'
import { bandArea, buildingsTouching } from './reach.js'
import { mainVibe } from './route.js'
import { plantTrees } from './trees.js'
import { Fiona, CameraRig } from './Simulation.jsx'

// All buildings in one mesh: walls and flat roofs, with one colour per vertex.
function buildBuildingGeometry(buildings) {
  const pos = []
  const ranges = []
  const v = (x, y, h) => pos.push(x, h, -y)
  for (const b of buildings) {
    const start = pos.length / 3
    const h = Math.max(b.height, 0.5)
    // Walls. Outer ring runs counter-clockwise and holes clockwise, so every wall faces outwards.
    for (const ring of b.rings) {
      for (let i = 0; i < ring.length; i++) {
        const [px, py] = ring[i], [qx, qy] = ring[(i + 1) % ring.length]
        v(px, py, 0); v(qx, qy, 0); v(qx, qy, h)
        v(px, py, 0); v(qx, qy, h); v(px, py, h)
      }
    }
    // Roof.
    const contour = b.rings[0].map(([x, y]) => new THREE.Vector2(x, y))
    const holes = b.rings.slice(1).map((r) => r.map(([x, y]) => new THREE.Vector2(x, y)))
    const all = [contour, ...holes].flat()
    for (const [a, c, d] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      const A = all[a], C = all[c], D = all[d]
      const ccw = (C.x - A.x) * (D.y - A.y) - (C.y - A.y) * (D.x - A.x) > 0
      for (const P of ccw ? [A, C, D] : [A, D, C]) v(P.x, P.y, h)
    }
    ranges.push([start, pos.length / 3 - start])
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geom.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3))
  geom.computeVertexNormals()
  return { geom, ranges }
}

// focus: with a route on the map, the set of buildings along it. Those keep most of their colour; every other
// building fades into the dark, so the route stands out.
const FADE_NEAR = 0.3
const FADE_FAR = 0.8

function Buildings({ buildings, levels, focus }) {
  const { geom, ranges } = useMemo(() => buildBuildingGeometry(buildings), [buildings])
  useLayoutEffect(() => {
    const useCol = Object.fromEntries(Object.entries(USE_COLORS).map(([k, [hex]]) => [k, new THREE.Color(hex)]))
    const reachCol = REACH_COLORS.map((hex) => new THREE.Color(hex))
    const dark = new THREE.Color(BACKGROUND)
    const attr = geom.getAttribute('color')
    const c = new THREE.Color()
    buildings.forEach((b, i) => {
      const lvl = levels ? levels[i] : -1
      c.copy(lvl >= 0 ? reachCol[lvl] : useCol[b.use] ?? useCol.undefined)
      if (focus) c.lerp(dark, focus.has(i) ? FADE_NEAR : FADE_FAR)
      const [start, count] = ranges[i]
      for (let k = start; k < start + count; k++) attr.setXYZ(k, c.r, c.g, c.b)
    })
    attr.needsUpdate = true
  }, [geom, ranges, buildings, levels, focus])
  useLayoutEffect(() => () => geom.dispose(), [geom])
  return (
    <mesh geometry={geom} renderOrder={10}>
      <meshLambertMaterial vertexColors />
    </mesh>
  )
}

function Streets({ edges }) {
  const geom = useMemo(() => {
    const pos = []
    for (const e of edges) for (let i = 1; i < e.line.length; i++) {
      const [a, b] = [e.line[i - 1], e.line[i]]
      pos.push(a[0], 0, -a[1], b[0], 0, -b[1])
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  }, [edges])
  return (
    <lineSegments geometry={geom} renderOrder={5}>
      <lineBasicMaterial color={STREET} depthWrite={false} />
    </lineSegments>
  )
}

// One walking area as a flat shape on the ground.
function Area({ polygons, color, order, mix = 0.45 }) {
  const geom = useMemo(() => {
    const shapes = polygons.map(({ outer, holes }) => {
      const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
      s.holes = holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
      return s
    })
    const g = new THREE.ShapeGeometry(shapes)
    g.rotateX(-Math.PI / 2)
    return g
  }, [polygons])
  useLayoutEffect(() => () => geom.dispose(), [geom])
  // On the ground the shade is mixed with the pale ground, so the highlighted buildings stand out in the full shade.
  const tint = useMemo(() => new THREE.Color(color).lerp(new THREE.Color(GROUND), mix), [color, mix])
  return (
    <mesh geometry={geom} renderOrder={order}>
      <meshBasicMaterial color={tint} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

function Pin({ at }) {
  return (
    <group position={[at[0], 0, -at[1]]} renderOrder={20}>
      <mesh position={[0, 30, 0]}>
        <cylinderGeometry args={[1.2, 1.2, 60, 12]} />
        <meshLambertMaterial color={BAUHAUS.white} />
      </mesh>
      <mesh position={[0, 62, 0]}>
        <sphereGeometry args={[5, 20, 12]} />
        <meshLambertMaterial color={BAUHAUS.white} />
      </mesh>
    </group>
  )
}

// A dot above every building with shop space in the 5-minute area; a tall pin above the one picked in the list.
function ShopMarkers({ shops, selected }) {
  return shops.map(({ index, building: b }) => {
    const x = (b.bbox[0] + b.bbox[2]) / 2, y = (b.bbox[1] + b.bbox[3]) / 2
    const on = index === selected
    return (
      <group key={index} position={[x, b.height, -y]}>
        {on && (
          <mesh position={[0, 20, 0]}>
            <cylinderGeometry args={[0.8, 0.8, 40, 8]} />
            <meshBasicMaterial color={BAUHAUS.blue} />
          </mesh>
        )}
        <mesh position={[0, on ? 44 : 6, 0]}>
          <sphereGeometry args={[on ? 7 : 3.5, 16, 10]} />
          <meshLambertMaterial color={on ? BAUHAUS.blue : '#e8e4da'} />
        </mesh>
      </group>
    )
  })
}

// The colour of a stop's vibe, for its ring on the ground and its glowing building.
const VIBE_COLOR = { classic: BAUHAUS.red, modern: BAUHAUS.blue, nature: BAUHAUS.yellow }

// The planned route: the streets walked as a band on the ground, a glowing ring in its vibe colour round every
// stop, and a numbered marker. low: in the observer view the markers sit low, without their tall poles.
function RouteLayer({ route, stop, low }) {
  const ribbon = useMemo(() => bandArea(route.lines, 3.5).polygons, [route])
  return (
    <>
      <Area polygons={ribbon} color={ROUTE} order={4.5} mix={0} />
      {route.stops.map((s, i) => {
        const last = i === route.stops.length - 1
        // A round trip ends where it starts: one marker is enough.
        if (last && s.index === route.stops[0].index) return null
        const [x, y] = s.place.xy
        const on = i === stop || (i === 0 && stop === route.stops.length - 1 && s.index === route.stops[stop].index)
        const color = s.anchor ? ROUTE_ANCHOR : s.dry ? ROUTE_DRY : ROUTE
        const h = low ? 8 : on ? 70 : 40
        const visit = !s.place.endpoint
        return (
          <group key={i} position={[x, 0, -y]}>
            {visit && (
              <mesh rotation-x={-Math.PI / 2} position={[0, 0.25, 0]} renderOrder={6}>
                <ringGeometry args={[14, 19, 40]} />
                <meshBasicMaterial color={VIBE_COLOR[mainVibe(s.place)]} transparent opacity={0.9} depthWrite={false} />
              </mesh>
            )}
            {!low && (
              <mesh position={[0, h / 2, 0]}>
                <cylinderGeometry args={[0.8, 0.8, h, 8]} />
                <meshBasicMaterial color={color} />
              </mesh>
            )}
            <Html position={[0, h, 0]} center zIndexRange={[5, 0]}>
              <span className={`route-pin${on ? ' on' : ''}${s.anchor ? ' anchor' : ''}`} style={{ background: color }}>
                {i === 0 ? 'S' : last ? 'E' : i}
              </span>
            </Html>
          </group>
        )
      })}
    </>
  )
}

// Parks and cemeteries as green on the ground.
function Greenery({ green }) {
  const parks = useMemo(() => green.filter((g) => g.landuse === 'recreation'), [green])
  const cemeteries = useMemo(() => green.filter((g) => g.landuse === 'cemetery'), [green])
  return (
    <>
      <Area polygons={parks} color={PARK} order={1} mix={0.15} />
      <Area polygons={cemeteries} color={CEMETERY} order={1} mix={0.2} />
    </>
  )
}

// Schematic trees in the parks and cemeteries (see trees.js): a low-poly crown on a trunk, all in two instanced
// meshes so a thousand trees cost no more than two objects.
function Trees({ kit }) {
  const trees = useMemo(() => plantTrees(kit), [kit])
  const crowns = useRef()
  const trunks = useRef()
  useLayoutEffect(() => {
    const o = new THREE.Object3D()
    const light = new THREE.Color('#4fae45'), deep = new THREE.Color('#2e7a32'), c = new THREE.Color()
    trees.forEach((t, i) => {
      const trunk = t.height - t.crown * 1.6
      o.position.set(t.x, trunk + t.crown * 0.8, -t.y)
      o.scale.set(t.crown, t.crown * 1.15, t.crown)
      o.rotation.set(0, t.shade * Math.PI, 0)
      o.updateMatrix()
      crowns.current.setMatrixAt(i, o.matrix)
      crowns.current.setColorAt(i, c.copy(deep).lerp(light, t.shade))
      o.position.set(t.x, trunk / 2, -t.y)
      o.scale.set(1, trunk, 1)
      o.rotation.set(0, 0, 0)
      o.updateMatrix()
      trunks.current.setMatrixAt(i, o.matrix)
    })
    crowns.current.instanceMatrix.needsUpdate = true
    crowns.current.instanceColor.needsUpdate = true
    trunks.current.instanceMatrix.needsUpdate = true
  }, [trees])
  return (
    <>
      <instancedMesh ref={crowns} args={[null, null, trees.length]} renderOrder={12}>
        <icosahedronGeometry args={[1, 0]} />
        <meshLambertMaterial flatShading />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[null, null, trees.length]} renderOrder={12}>
        <cylinderGeometry args={[0.5, 0.7, 1, 6]} />
        <meshLambertMaterial color="#4a3a2a" />
      </instancedMesh>
    </>
  )
}

// A tiny Bauhaus shape for a vibe: red square, blue circle, yellow triangle.
function VibeMark({ vibe }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      {vibe === 'classic' && <rect x="1" y="1" width="8" height="8" fill={BAUHAUS.red} />}
      {vibe === 'modern' && <circle cx="5" cy="5" r="4.2" fill={BAUHAUS.blue} />}
      {vibe === 'nature' && <polygon points="5,0.5 9.5,9.5 0.5,9.5" fill={BAUHAUS.yellow} />}
    </svg>
  )
}

// One glowing shell per colour around the landmark buildings, a hair larger than the building so it covers it.
function Glow({ buildings, color, show, strength = 0.55 }) {
  const geom = useMemo(() => {
    if (!buildings.length) return null
    const grown = buildings.map((b) => {
      const cx = (b.bbox[0] + b.bbox[2]) / 2, cy = (b.bbox[1] + b.bbox[3]) / 2
      const rings = b.rings.map((r) => r.map(([x, y]) => [cx + (x - cx) * 1.012, cy + (y - cy) * 1.012]))
      return { ...b, rings, height: b.height + 0.4 }
    })
    return buildBuildingGeometry(grown).geom
  }, [buildings])
  useLayoutEffect(() => () => geom?.dispose(), [geom])
  if (!geom) return null
  return (
    <mesh geometry={geom} renderOrder={11} visible={show}>
      <meshLambertMaterial color={color} emissive={color} emissiveIntensity={strength} />
    </mesh>
  )
}

// The popular places: their buildings glow, and a frosted label floats above each.
// With a route (routeIds: the ids of its places), only the route's landmarks glow, brightly in their vibe colour,
// and the other labels fade back.
// Kept on the map all the time and only hidden, because removing the floating labels mid-render upsets drei.
function Landmarks({ kit, show, routeIds }) {
  const items = useMemo(() => {
    const byId = new Map(kit.buildings.map((b, i) => [String(b.id), i]))
    return kit.poi.places
      .filter((p) => p.landmark)
      .map((p) => {
        const b = p.building != null ? kit.buildings[byId.get(String(p.building))] : null
        const at = b ? [(b.bbox[0] + b.bbox[2]) / 2, (b.bbox[1] + b.bbox[3]) / 2] : p.xy
        return { place: p, building: b, at, top: b ? b.height : 0, vibe: mainVibe(p) }
      })
  }, [kit])
  // Kept in memos: a new list on every render would rebuild the glow shells every time.
  const glows = useMemo(() => {
    const has = (l) => l.building && (!routeIds || routeIds.has(l.place.id))
    const of = (test) => items.filter((l) => has(l) && test(l)).map((l) => l.building)
    return routeIds
      ? {
          red: of((l) => l.vibe === 'classic'),
          blue: of((l) => l.vibe === 'modern'),
          yellow: of((l) => l.vibe === 'nature'),
        }
      : { gold: of((l) => l.vibe !== 'modern'), lightBlue: of((l) => l.vibe === 'modern') }
  }, [items, routeIds])
  return (
    <>
      {routeIds ? (
        <>
          <Glow buildings={glows.red} color={BAUHAUS.red} show={show} strength={0.9} />
          <Glow buildings={glows.blue} color={BAUHAUS.blue} show={show} strength={0.9} />
          <Glow buildings={glows.yellow} color={BAUHAUS.yellow} show={show} strength={0.9} />
        </>
      ) : (
        <>
          <Glow buildings={glows.gold} color={LANDMARK_CLASSIC} show={show} />
          <Glow buildings={glows.lightBlue} color={LANDMARK_MODERN} show={show} />
        </>
      )}
      {items.map(({ place, at, top, vibe }) => (
        <Html key={place.id} position={[at[0], top + 8, -at[1]]} center zIndexRange={[4, 0]}>
          <span
            className={`landmark-chip ${vibe}${routeIds ? (routeIds.has(place.id) ? ' in-route' : ' faded') : ''}`}
            hidden={!show}
          >
            <VibeMark vibe={vibe} />
            {place.short ?? place.name}
          </span>
        </Html>
      ))}
    </>
  )
}

// paused: the wizard covers the map, so the scene is only drawn when something changes.
// onMiss: a click that hits nothing at all (outside the city).
// clock and camera: the time-lapse (see Simulation.jsx); camera is 'bird' or 'observer'.
export default function City({ kit, reach, onPick, onMiss, selected, route, stop, landmarks, mood = 'normal', paused = false, clock, camera = 'bird' }) {
  const buildingsRef = useRef()

  // With a route: the buildings within 30 m of it stay bright, the rest fade; and which places it visits.
  const focus = useMemo(() => (route ? buildingsTouching(kit.buildings, route.lines, 30) : null), [kit, route])
  const routeIds = useMemo(() => (route ? new Set(route.stops.map((s) => s.place.id)) : null), [route])
  const light = MOODS[mood] ?? MOODS.normal
  const [x0, y0, x1, y1] = kit.extent
  const margin = 150
  const w = x1 - x0 + 2 * margin, d = y1 - y0 + 2 * margin

  // A building in each area gets that area's shade; the smallest area wins.
  const levels = useMemo(() => {
    if (!reach?.ok) return null
    const l = new Int8Array(kit.buildings.length).fill(-1)
    for (let k = reach.levels.length - 1; k >= 0; k--) for (const i of reach.levels[k].buildings) l[i] = k
    return l
  }, [kit, reach])

  const handleClick = (e) => {
    if (e.delta > 5 || !onPick) return // that was a drag, not a click; or clicks do nothing in this tab
    e.stopPropagation()
    // If a building is in front of the ground, start at that building rather than at the ground behind it.
    let p = e.point
    const hits = new THREE.Raycaster(e.ray.origin, e.ray.direction).intersectObject(buildingsRef.current, true)
    if (hits.length && hits[0].distance < e.distance) p = hits[0].point
    onPick([p.x, -p.z])
  }

  return (
    <Canvas
      flat
      frameloop={paused ? 'demand' : 'always'}
      onPointerMissed={(e) => e.type === 'click' && onMiss?.()}
      camera={{ position: [0, 1500, 1900], fov: 35, near: 5, far: 20000 }}
      style={{ background: light.background, transition: 'background 0.8s' }}
    >
      <hemisphereLight color={light.sky} groundColor={light.groundLight} intensity={light.hemi} />
      <directionalLight position={[-600, 1200, 500]} color={light.sunColor} intensity={light.sun} />
      <mesh rotation-x={-Math.PI / 2} position={[(x0 + x1) / 2, 0, -(y0 + y1) / 2]} renderOrder={0} onClick={handleClick}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={GROUND} depthWrite={false} />
      </mesh>
      <Greenery green={kit.green} />
      {reach?.ok &&
        [2, 1, 0].map((k) => (
          <Area key={k} polygons={reach.levels[k].area.polygons} color={REACH_COLORS[k]} order={2 + (2 - k)} />
        ))}
      <Streets edges={kit.edges} />
      <group ref={buildingsRef}>
        <Buildings buildings={kit.buildings} levels={levels} focus={focus} />
      </group>
      <Trees kit={kit} />
      {reach?.ok && <Pin at={reach.start} />}
      {reach?.ok && <ShopMarkers shops={reach.shops} selected={selected} />}
      <Landmarks kit={kit} show={!!landmarks} routeIds={routeIds} />
      {route && <RouteLayer route={route} stop={stop} low={camera === 'observer'} />}
      {route && clock && <Fiona route={route} clock={clock} />}
      <CameraRig mode={route ? camera : null} route={route} clock={clock} />
      <OrbitControls makeDefault target={[0, 0, 0]} maxPolarAngle={Math.PI / 2.1} minDistance={80} maxDistance={6000} />
    </Canvas>
  )
}
