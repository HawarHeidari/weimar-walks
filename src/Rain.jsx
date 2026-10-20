// Falling rain drawn on a canvas over the map. It ignores the mouse, so the map below still works.
// It follows the time slider: on every frame it reads the clock, looks up the forecast hour of that minute and
// draws rain only if that hour has any (more than 0 mm), as densely as the millimetres say. In a dry hour the
// layer fades out within a moment and is then hidden completely.
// With "reduce motion" switched on in the system settings, there are no falling drops, only a still veil whose
// darkness follows the rain.
import { useEffect, useRef } from 'react'
import { hourAt, rainStrength } from './timeline.js'

const MAX_DROPS_PER_MEGAPIXEL = 520 // at full strength (8 mm an hour or more)
const FADE = 6 // how quickly the rain eases to a new strength (per second); dry hours reach zero in about 0.4 s

// clock: the shared time-lapse clock; hours: the forecast hours of the walk (weather.js).
export default function Rain({ clock, hours }) {
  const ref = useRef()

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let drops = [], frame = 0, w = 0, h = 0, strength = 0, last = performance.now()

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // A pool for the heaviest rain; lighter rain draws only the first part of it.
      const n = Math.round((w * h * MAX_DROPS_PER_MEGAPIXEL) / 1e6)
      drops = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        len: 0.4 + Math.random() * 0.6, // share of the full length
        speed: 0.6 + Math.random() * 0.4,
        alpha: 0.4 + Math.random() * 0.6,
      }))
    }
    resize()
    window.addEventListener('resize', resize)

    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const mm = hourAt(hours, clock.get())?.precipitation ?? 0
      const target = rainStrength(mm)
      strength += (target - strength) * (1 - Math.exp(-dt * FADE))
      if (target === 0 && strength < 0.02) strength = 0

      // Dry: nothing on screen at all, not even the veil.
      canvas.style.opacity = strength > 0 ? String(0.35 + 0.65 * Math.min(1, strength * 1.5)) : '0'
      canvas.style.setProperty('--veil', String(strength))
      ctx.clearRect(0, 0, w, h)
      if (strength > 0 && !still) {
        // Heavier rain: more drops, longer and faster streaks, a stronger slant.
        const count = Math.round(drops.length * strength)
        const length = 8 + 22 * strength
        const fall = (6 + 12 * strength) * (dt * 60)
        const slant = 0.12 + 0.18 * strength
        ctx.lineWidth = strength > 0.6 ? 1.4 : 1
        ctx.lineCap = 'round'
        for (let i = 0; i < count; i++) {
          const d = drops[i]
          const l = length * d.len
          ctx.strokeStyle = `rgba(190, 208, 226, ${(0.25 + 0.45 * strength) * d.alpha})`
          ctx.beginPath()
          ctx.moveTo(d.x, d.y)
          ctx.lineTo(d.x - l * slant, d.y + l)
          ctx.stroke()
          d.y += fall * d.speed
          d.x -= fall * d.speed * slant
          if (d.y > h) {
            d.y = -l
            d.x = Math.random() * (w + 60)
          }
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [clock, hours])

  return <canvas ref={ref} className="rain" aria-hidden="true" />
}
