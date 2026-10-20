// The time-lapse in 3D: Fiona walking the route, and the camera that watches her.
// Both read the shared clock on every frame, so moving the time slider moves them without re-drawing the page.
// Plan coordinates [x east, y north] become three.js [x, height, -y], as in City.jsx.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { poseAt, boundsOf } from './timeline.js'
import { BAUHAUS } from './palette.js'

const clockText = (min) => {
  const m = Math.round(min) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// Turn smoothly from angle a towards angle b (radians), the short way round.
function turnTowards(a, b, k) {
  let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return a + d * k
}

// ---------- Fiona ----------

// A Bauhaus figure: a blue cone for the body, a yellow ball for the head, a white arrow on the ground for her way,
// and a yellow ring so she can be found from far above. About 14 m tall: life size would vanish at this scale.
// She is drawn over the buildings (no depth test), like the arrow of a navigation app, so a roof never hides her.
export function Fiona({ route, clock }) {
  const fiona = useRef()
  const arrow = useRef()
  const ring = useRef()
  const label = useRef()
  const heading = useRef(null)
  const lastText = useRef('')

  useFrame((state, dt) => {
    if (!fiona.current) return
    const pose = poseAt(route, clock.get())
    fiona.current.position.set(pose.xy[0], 0, -pose.xy[1])
    if (pose.heading) {
      const target = Math.atan2(pose.heading[1], pose.heading[0])
      heading.current = heading.current == null ? target : turnTowards(heading.current, target, 1 - Math.exp(-dt * 8))
      arrow.current.rotation.y = heading.current
    }
    arrow.current.visible = pose.walking
    // The ring breathes, so she stands out in the overview.
    const s = 1 + 0.12 * Math.sin(state.clock.elapsedTime * 3)
    ring.current.scale.set(s, s, s)
    // The label changes only when its text does.
    const s0 = route.stops[pose.stop], s1 = route.stops[pose.next]
    const text = pose.walking
      ? `Fiona · ${clockText(clock.get())} · to ${s1.place.short ?? s1.place.name}`
      : `Fiona · ${clockText(clock.get())} · ${pose.stop === 0 ? 'starts at' : s0.end ? 'ends at' : 'at'} ${s0.place.short ?? s0.place.name}`
    if (text !== lastText.current && label.current) {
      label.current.textContent = text
      lastText.current = text
    }
  })

  const arrowShape = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(22, 0)
    s.lineTo(8, 7)
    s.lineTo(8, -7)
    s.closePath()
    return s
  }, [])

  return (
    <group ref={fiona} name="Fiona">
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.3, 0]} renderOrder={40}>
        <ringGeometry args={[11, 14, 48]} />
        <meshBasicMaterial color={BAUHAUS.yellow} transparent opacity={0.85} depthWrite={false} depthTest={false} />
      </mesh>
      <group ref={arrow}>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.4, 0]} renderOrder={41}>
          <shapeGeometry args={[arrowShape]} />
          <meshBasicMaterial color={BAUHAUS.white} depthWrite={false} depthTest={false} />
        </mesh>
      </group>
      <mesh position={[0, 5, 0]} renderOrder={42}>
        <coneGeometry args={[4, 10, 24]} />
        <meshLambertMaterial color={BAUHAUS.blue} emissive={BAUHAUS.blue} emissiveIntensity={0.35} depthTest={false} />
      </mesh>
      <mesh position={[0, 12.5, 0]} renderOrder={43}>
        <sphereGeometry args={[2.8, 20, 14]} />
        <meshLambertMaterial color={BAUHAUS.yellow} emissive={BAUHAUS.yellow} emissiveIntensity={0.35} depthTest={false} />
      </mesh>
      <Html position={[0, 20, 0]} center zIndexRange={[6, 0]}>
        <span className="fiona-label" ref={label} />
      </Html>
    </group>
  )
}

// ---------- the camera ----------

const OBSERVER = {
  distance: 130, // metres from the camera to Fiona
  pitch: 70, // degrees from looking straight down: 0 is a map, 90 the horizon
  aim: 5, // metres above the ground the camera aims at: her body
  turn: 2.5, // how quickly the camera turns with her (per second)
  settle: 1, // seconds to glide in when the view is switched on; after that it is locked on her
}
const FLY_S = 1.2 // seconds for the flight to the overview

// mode: 'bird' (top-down overview of the whole route, free to orbit afterwards), 'observer' (follows Fiona),
// or null (leave the camera alone, as in the walk-reach mode).
export function CameraRig({ mode, route, clock }) {
  const { camera, controls, size } = useThree()
  const fly = useRef(null)
  const bearing = useRef(null)
  const look = useRef(new THREE.Vector3())
  const settle = useRef(0)

  // Bird's eye: fly to a top-down view that frames the whole route.
  useEffect(() => {
    if (!controls) return
    if (mode !== 'bird' || !route) {
      controls.enabled = mode !== 'observer'
      return
    }
    const [x0, y0, x1, y1] = boundsOf(route)
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const fov = (camera.fov * Math.PI) / 180
    const aspect = size.width / size.height
    const half = Math.max((y1 - y0) / 2, (x1 - x0) / 2 / aspect) + 120
    const height = half / Math.tan(fov / 2)
    fly.current = {
      t: 0,
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      // A hair south of straight above, so "north is up" and the orbit controls stay steady.
      toPos: new THREE.Vector3(cx, height, -cy + height * 0.02),
      toTarget: new THREE.Vector3(cx, 0, -cy),
    }
    controls.enabled = false
    bearing.current = null
  }, [mode, route, controls, camera, size])

  // Starting to follow: begin looking from where the camera already looks, so there is no jump.
  useEffect(() => {
    if (mode === 'observer' && controls) {
      look.current.copy(controls.target)
      settle.current = 0
    }
  }, [mode, controls])

  useFrame((_, dt) => {
    if (!controls || !route) return
    if (mode === 'bird' && fly.current) {
      const f = fly.current
      f.t = Math.min(1, f.t + dt / FLY_S)
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2 // ease in and out
      camera.position.lerpVectors(f.fromPos, f.toPos, e)
      controls.target.lerpVectors(f.fromTarget, f.toTarget, e)
      if (f.t >= 1) {
        fly.current = null
        controls.enabled = true
      }
      controls.update()
    }
    if (mode === 'observer') {
      const pose = poseAt(route, clock.get())
      if (pose.heading) {
        const target = Math.atan2(pose.heading[1], pose.heading[0])
        bearing.current = bearing.current == null ? target : turnTowards(bearing.current, target, 1 - Math.exp(-dt * OBSERVER.turn))
      }
      // Behind her along her way, high up: the centre of the view is always Fiona herself.
      const h = bearing.current ?? Math.PI / 2
      const dx = Math.cos(h), dy = Math.sin(h)
      const tilt = (OBSERVER.pitch * Math.PI) / 180
      const back = OBSERVER.distance * Math.sin(tilt), up = OBSERVER.distance * Math.cos(tilt)
      const [x, y] = pose.xy
      const wantLook = new THREE.Vector3(x, OBSERVER.aim, -y)
      const wantPos = new THREE.Vector3(x - dx * back, OBSERVER.aim + up, -(y - dy * back))
      // Glide in for a moment after switching, then stay locked, however fast the time-lapse runs.
      settle.current = Math.min(1, settle.current + dt / OBSERVER.settle)
      const k = settle.current < 1 ? 1 - Math.exp(-dt * 5) : 1
      camera.position.lerp(wantPos, k)
      look.current.lerp(wantLook, k)
      controls.target.copy(look.current)
      controls.update()
    }
  })

  return null
}
