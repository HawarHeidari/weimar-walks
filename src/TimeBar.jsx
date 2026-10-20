// The time slider under the map: play the walk as a time-lapse, or drag through it.
// Keys: left and right arrows move 5 minutes (with Shift 15), space plays and pauses, Home and End jump to the ends.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { spanOf, poseAt, hourAt } from './timeline.js'
import { WeatherGlyph } from './glyphs.jsx'

const SPEEDS = [5, 15, 30] // minutes of the walk per second of watching

const clockText = (min) => {
  const m = Math.round(min) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// hours: the forecast hours of the walk, to show the weather of the minute under the slider (may be missing).
export default function TimeBar({ route, clock, camera, onCamera, hours }) {
  const t = useSyncExternalStore(clock.subscribe, clock.get)
  const [start, end] = spanOf(route)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const raf = useRef()

  // Play: move the clock on every screen frame, and stop at the end.
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    if (clock.get() >= end) clock.set(start)
    const tick = (now) => {
      const next = Math.min(end, clock.get() + ((now - last) / 1000) * SPEEDS[speed])
      last = now
      clock.set(next)
      if (next >= end) setPlaying(false)
      else raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, speed, start, end, clock])

  // Keys, except while typing in a field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, select, textarea, [role="listbox"]')) return
      const step = e.shiftKey ? 15 : 5
      const to = (v) => clock.set(Math.max(start, Math.min(end, v)))
      if (e.key === 'ArrowRight') to(clock.get() + step)
      else if (e.key === 'ArrowLeft') to(clock.get() - step)
      else if (e.key === 'Home') to(start)
      else if (e.key === 'End') to(end)
      else if (e.key === ' ' && !e.target.closest?.('button')) setPlaying((p) => !p)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clock, start, end])

  const pose = poseAt(route, t)
  const at = route.stops[pose.stop], next = route.stops[pose.next]
  const name = (s) => s.place.short ?? s.place.name
  const status = pose.walking
    ? `Walking to ${name(next)}`
    : pose.stop === 0
      ? `Starting at ${name(at)}`
      : at.end
        ? `Arrived at ${name(at)}`
        : `At ${name(at)} until ${clockText(at.leave)}`
  const hour = hourAt(hours, t)
  const mm = hour?.precipitation ?? 0
  const pct = (v) => `${((v - start) / (end - start || 1)) * 100}%`

  return (
    <>
      <div className="camera-toggle" role="radiogroup" aria-label="Camera">
        <button role="radio" aria-checked={camera === 'bird'} onClick={() => onCamera('bird')}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1" y="1" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="8" cy="8" r="3" fill="currentColor" />
          </svg>
          Bird's eye
        </button>
        <button role="radio" aria-checked={camera === 'observer'} onClick={() => onCamera('observer')}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <polygon points="8,1 15,15 1,15" fill="currentColor" />
          </svg>
          Observer
        </button>
      </div>
      <div className="timebar" role="group" aria-label="Time-lapse of the walk">
        <button className="tb-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            {playing ? (
              <>
                <rect x="3" y="2" width="4" height="12" fill="currentColor" />
                <rect x="9" y="2" width="4" height="12" fill="currentColor" />
              </>
            ) : (
              <polygon points="3,2 14,8 3,14" fill="currentColor" />
            )}
          </svg>
        </button>
        <button className="tb-speed" onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)} aria-label={`Speed: ${SPEEDS[speed]} minutes per second`}>
          ×{SPEEDS[speed]}
        </button>
        <div className="tb-time">
          <strong>
            {clockText(t)}
            {hour && <WeatherGlyph code={hour.code} mm={mm} size={22} />}
          </strong>
          <span>
            {status}
            {hour && (mm > 0 ? ` · ${mm.toFixed(1)} mm rain` : ' · dry')}
          </span>
        </div>
        <div className="tb-track">
          <div className="tb-ticks" aria-hidden="true">
            {route.stops.slice(1, -1).map((s, i) => (
              <span
                key={i}
                className={`tb-visit${s.anchor ? ' anchor' : ''}`}
                style={{ left: pct(s.arrive), width: `calc(${pct(s.leave)} - ${pct(s.arrive)})` }}
                title={`${clockText(s.arrive)} ${s.place.name}`}
              >
                {i + 1}
              </span>
            ))}
          </div>
          <input
            type="range"
            min={start}
            max={end}
            step={1}
            value={t}
            onChange={(e) => {
              setPlaying(false)
              clock.set(Number(e.target.value))
            }}
            aria-label="Time of the walk"
            aria-valuetext={`${clockText(t)}, ${status}`}
          />
          <div className="tb-ends" aria-hidden="true">
            <span>{clockText(start)}</span>
            <span>{clockText(end)}</span>
          </div>
        </div>
      </div>
    </>
  )
}
