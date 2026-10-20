import { useEffect, useMemo, useState } from 'react'
import City from './City.jsx'
import { loadKit } from './geo.js'
import { computeReach, distanceToStreet, MINUTES, SPEED_M_PER_MIN, BAND_M, MAX_SNAP_M } from './reach.js'
import { USE_COLORS, REACH_COLORS, PARK, CEMETERY } from './palette.js'
import RoutePlanner, { Itinerary } from './RoutePlanner.jsx'
import Rain from './Rain.jsx'
import TimeBar from './TimeBar.jsx'
import { createClock, hourAt } from './timeline.js'
import { goodness } from './weather.js'

const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

const fmt = (n) => n.toLocaleString('en-GB')

const USE_LABEL = Object.fromEntries(Object.entries(USE_COLORS).map(([k, [, label]]) => [k, label]))

function ShopList({ shops, selected, onSelect }) {
  return (
    <div className="shops">
      <h2>
        Shops within 5 min: {shops.length} {shops.length === 1 ? 'building' : 'buildings'}
      </h2>
      <p className="note">
        Buildings with shop floor area, nearest first. The data has no shop names, only the estimated floor area per
        use. Click one to see it on the map.
      </p>
      {shops.length > 0 && (
        <ol>
          {shops.map((s) => (
            <li key={s.index}>
              <button className={s.index === selected ? 'active' : ''} onClick={() => onSelect(s.index === selected ? null : s.index)}>
                <span className="walk">{s.metres < SPEED_M_PER_MIN ? '< 1' : Math.ceil(s.metres / SPEED_M_PER_MIN)} min</span>
                <span>
                  {fmt(Math.round(s.building.retail))} m² shop space
                  <span className="note">
                    {s.building.use === 'retail' ? 'mainly shops' : `mainly ${USE_LABEL[s.building.use]}`} · {s.building.floors}{' '}
                    {s.building.floors === 1 ? 'floor' : 'floors'} · building {s.building.id}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Panel({ reach, busy, selected, onSelect }) {
  let status = 'Click on the ground to start walking.'
  if (busy) status = 'Walking…'
  else if (reach && !reach.ok) status = `No walkable street within ${MAX_SNAP_M} m of this point. Click closer to a street.`
  else if (reach?.ok) status = 'Walking from the street node nearest to your click.'

  return (
    <>
      <h1>How far can you walk?</h1>
      <p className="status">{status}</p>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>buildings</th>
            <th>residents</th>
          </tr>
        </thead>
        <tbody>
          {MINUTES.map((m, k) => {
            const l = reach?.ok ? reach.levels[k] : null
            return (
              <tr key={m}>
                <th>
                  <span className="swatch" style={{ background: REACH_COLORS[k] }} />
                  {m} min
                </th>
                <td>{l ? fmt(l.buildings.size) : '–'}</td>
                <td>
                  {l ? `≈ ${fmt(l.residents)}` : '–'}
                  {l?.withoutFigure > 0 && (
                    <span className="note">
                      {' '}+ {l.withoutFigure} {l.withoutFigure === 1 ? 'cell' : 'cells'} without a figure
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {reach?.ok && <ShopList shops={reach.shops} selected={selected} onSelect={onSelect} />}
      <div className="method">
        <p>
          You walk at {SPEED_M_PER_MIN * 0.06} km/h, which is {SPEED_M_PER_MIN} m a minute, along the pedestrian network,
          starting from the street node nearest to where you click.
        </p>
        <p>
          Each area is the streets you reach in that time, including part of the last street, with a band of {BAND_M} m on
          each side, joined into one shape. A building counts when it touches the area.
        </p>
        <p>
          Residents come from the 100 m cells of the Zensus 2022. For every cell that overlaps the area, its residents are
          multiplied by the share of the cell that lies inside. These are added up and rounded to the nearest 10.
        </p>
        <p>
          Some cells have no published resident figure. They are not counted as zero: they are left out of the sum, and
          the panel shows how many of them overlap the area.
        </p>
      </div>
    </>
  )
}

function Legend({ buildings }) {
  const counts = {}
  for (const b of buildings) counts[b.use] = (counts[b.use] ?? 0) + 1
  return (
    <section className="legend">
      <h2>Main use of the building</h2>
      <ul>
        {Object.entries(USE_COLORS)
          .filter(([use]) => counts[use])
          .map(([use, [color, label]]) => (
            <li key={use}>
              <span className="swatch" style={{ background: color }} />
              {label}
            </li>
          ))}
      </ul>
      <h2 className="ground">On the ground</h2>
      <ul>
        <li>
          <span className="swatch" style={{ background: PARK }} />
          park
        </li>
        <li>
          <span className="swatch" style={{ background: CEMETERY }} />
          cemetery
        </li>
      </ul>
    </section>
  )
}

export default function App() {
  const [kit, setKit] = useState(null)
  const [error, setError] = useState(null)
  const [reach, setReach] = useState(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(null)
  const [plan, setPlan] = useState(null) // { route, weather } once a route has been generated
  const [wizardOpen, setWizardOpen] = useState(true)
  const [mode, setMode] = useState('route') // 'route' or 'reach'
  const [itineraryOpen, setItineraryOpen] = useState(false)
  const [stop, setStop] = useState(null)
  // The time-lapse: one clock for the slider, Fiona and the camera; and the camera mode.
  const clock = useMemo(() => createClock(0), [])
  const [camera, setCamera] = useState('bird')
  // While choosing a start or end point on the map: { resolve, message }.
  const [picking, setPicking] = useState(null)
  // The 3D map is built the first time it is needed: to choose a point on it, or to show a route.
  const [mapBuilt, setMapBuilt] = useState(false)

  useEffect(() => {
    loadKit().then(setKit).catch((e) => setError(e.message))
  }, [])


  const chooseOnMap = (resolve) => {
    setMapBuilt(true)
    setPicking({ resolve, message: null })
    setWizardOpen(false)
  }
  const endPicking = (point) => {
    picking.resolve(point)
    setPicking(null)
    setWizardOpen(true)
  }
  // A click while choosing: only near a street, named after the nearest landmark if one is close.
  const pickPoint = (xy) => {
    if (distanceToStreet(kit, xy) > MAX_SNAP_M) {
      setPicking((p) => ({ ...p, message: `No street within ${MAX_SNAP_M} m of that spot. Click closer to a street.` }))
      return
    }
    const [lon, lat] = kit.unproject(xy)
    const near = kit.poi.places
      .map((p) => ({ p, d: Math.hypot(p.xy[0] - xy[0], p.xy[1] - xy[1]) }))
      .sort((a, b) => a.d - b.d)[0]
    const where = near && near.d < 120 ? `near ${near.p.short ?? near.p.name}` : `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E`
    endPicking({ id: `map:${Math.round(xy[0])},${Math.round(xy[1])}`, name: `📍 Map point, ${where}`, group: 'Picked on the map', xy })
  }

  useEffect(() => {
    if (!picking) return
    const onKey = (e) => e.key === 'Escape' && endPicking(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const done = (p) => {
    setMapBuilt(true)
    setPlan(p)
    clock.set(p.route.stops[0].arrive)
    setCamera('bird')
    setStop(null)
    setMode('route')
    setItineraryOpen(false)
    setWizardOpen(false)
  }

  // The weather of the planned walk sets the light of the map, in route mode only.
  const weather = plan?.weather
  // The forecast hour under the time slider. It changes only when the slider crosses into another hour, so the page
  // is not re-drawn on every frame of the time-lapse.
  const [hourNow, setHourNow] = useState(null)
  useEffect(() => {
    if (!weather?.known) {
      setHourNow(null)
      return
    }
    const update = () => setHourNow(hourAt(weather.hours, clock.get()))
    update()
    return clock.subscribe(update)
  }, [weather, clock])
  // The light of that hour: grey and dim while it rains, bright in the sun.
  const mood =
    mode === 'route' && hourNow ? (goodness(hourNow) === 0 ? 'rainy' : hourNow.code <= 1 ? 'sunny' : 'normal') : 'normal'

  // The time slider shows once a route is on the map, in route mode.
  const showTime = !!plan && !wizardOpen && !picking && mode === 'route'

  // Picking a stop in the itinerary also moves the time to when Fiona gets there.
  const selectStop = (i) => {
    setStop(i)
    if (i != null) clock.set(plan.route.stops[i].arrive)
  }

  const pick = (point) => {
    setBusy(true)
    // Let the page show "Walking…" before the calculation starts.
    setTimeout(() => {
      setReach(computeReach(kit, point))
      setSelected(null)
      setBusy(false)
    }, 20)
  }

  return (
    <div className={`app${showTime ? ' has-timebar' : ''}`}>
      {error && <p className="error">The city kit didn't load ({error}).</p>}
      {!kit && !error && (
        <div className="wizard loading-screen">
          <p className="loading">Loading Weimar…</p>
        </div>
      )}
      {/* The map is built only when it is first needed; until then the wizard is all there is. */}
      {kit && mapBuilt && (
        <>
          <City
            kit={kit}
            reach={mode === 'reach' && !picking ? reach : null}
            onPick={picking ? pickPoint : mode === 'reach' && !wizardOpen ? pick : null}
            onMiss={picking ? () => setPicking((p) => ({ ...p, message: 'That spot is outside the city. Click on the streets.' })) : null}
            selected={selected}
            route={plan && mode === 'route' && !picking ? plan.route : null}
            stop={stop}
            landmarks={!!picking || mode === 'route'}
            mood={picking ? 'normal' : mood}
            paused={wizardOpen}
            clock={clock}
            camera={camera}
          />
          {showTime && weather?.known && <Rain clock={clock} hours={weather.hours} />}
          {picking && (
            <div className="pick-banner" role="status">
              <span className="pick-dot" aria-hidden="true" />
              <span>
                <strong>Click on the map</strong> to set the point.
                {picking.message && <span className="note warn-text">{picking.message}</span>}
              </span>
              <button onClick={() => endPicking(null)}>Cancel</button>
            </div>
          )}
          {plan && !picking && (
            <>
              <nav className="toolbar" aria-label="Map tools" hidden={wizardOpen}>
                <button className="primary" onClick={() => setWizardOpen(true)}>Edit route</button>
                <button
                  aria-pressed={mode === 'route' && itineraryOpen}
                  onClick={() => {
                    setMode('route')
                    setItineraryOpen((o) => mode !== 'route' || !o)
                  }}
                >
                  Itinerary
                </button>
                <button aria-pressed={mode === 'reach'} onClick={() => setMode(mode === 'reach' ? 'route' : 'reach')}>
                  Walk reach
                </button>
              </nav>
              {!wizardOpen && mode === 'route' && itineraryOpen && (
                <section className="panel">
                  <h1>Your route</h1>
                  <Itinerary plan={plan} selected={stop} onSelect={selectStop} />
                </section>
              )}
              {!wizardOpen && mode === 'reach' && (
                <section className="panel">
                  <Panel reach={reach} busy={busy} selected={selected} onSelect={setSelected} />
                </section>
              )}
              {!wizardOpen && <Legend buildings={kit.buildings} />}
              {showTime && <TimeBar route={plan.route} clock={clock} camera={camera} onCamera={setCamera} hours={weather?.hours} />}
            </>
          )}
          {!wizardOpen && <footer className="attribution">{ATTRIBUTION}</footer>}
        </>
      )}
      {/* Kept mounted while hidden, so "Edit route" and "Choose on map" come back to your earlier choices. */}
      {kit && (
        <div hidden={!wizardOpen}>
          <RoutePlanner
            kit={kit}
            onDone={done}
            onClose={plan ? () => setWizardOpen(false) : null}
            onChooseOnMap={chooseOnMap}
          />
        </div>
      )}
    </div>
  )
}
