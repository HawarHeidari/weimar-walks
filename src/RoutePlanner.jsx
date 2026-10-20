// The route planner: a fullscreen wizard (group and time, then vibe and must-sees) that hides the map until the
// first route is made, and the itinerary of that route, shown on the map.
// Nothing is calculated until every required choice is made and "Generate smart route" is pressed.
import { useEffect, useRef, useState } from 'react'
import {
  VIBES,
  VISITORS,
  LONG_STOP_WALK_MIN,
  planRoute,
  findDryWindow,
  describeRoute,
  endpointsOf,
  mainVibe,
  networkFor,
  sameStopsOn,
  optimizeForWeather,
  QUICK_PREFS,
  pathForQuick,
} from './route.js'
import { streetClimate, streetWeights, shareOf, PATHS } from './climate.js'
import { fetchWeather, fetchDay, summarise, questionsFor, suggestFor, DAY_FROM, DAY_TO } from './weather.js'
import { WeatherGlyph, ChoiceGlyph, DayGlyph, WalkGlyph, QuickGlyph, weatherKind, WEATHER_WORDS } from './glyphs.jsx'
import { BAUHAUS } from './palette.js'
import Dropdown from './Dropdown.jsx'

const VIBE_COLOR = { classic: BAUHAUS.red, modern: BAUHAUS.blue, nature: BAUHAUS.yellow }
const VIBE_LABEL = Object.fromEntries(VIBES.map((v) => [v.id, v.label]))
const CHOOSE_ON_MAP = '__map'

const clock = (min) => {
  const m = Math.round(min) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const hm = (min) => {
  const m = Math.round(min)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}
const eur = (v) => (v === 0 ? '€0' : `€${v.toFixed(2)}`)
const today = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD in local time

// ---------- Bauhaus vibe icons: square, circle, triangle ----------

export function VibeIcon({ vibe, size = 40 }) {
  const { red, blue, yellow } = BAUHAUS
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      {vibe === 'classic' && <rect x="6" y="6" width="28" height="28" fill={red} />}
      {vibe === 'modern' && <circle cx="20" cy="20" r="15" fill={blue} />}
      {vibe === 'nature' && <polygon points="20,5 36,34 4,34" fill={yellow} />}
      {vibe === 'surprise' && (
        <>
          <rect x="3" y="15" width="18" height="18" fill={red} />
          <circle cx="25" cy="15" r="10" fill={blue} />
          <polygon points="27,18 38,37 16,37" fill={yellow} />
        </>
      )}
    </svg>
  )
}

// The hero logo: yellow triangle (nature, the base), blue circle (modern, balance), red square (classic, structure).
function HeroLogo() {
  return (
    <div className="hero-logo">
      <svg width="120" height="120" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bauhaus square, circle and triangle">
        <polygon points="100,20 180,160 20,160" fill="#FFD700" opacity="0.8" />
        <circle cx="130" cy="100" r="55" fill="#0055A4" opacity="0.85" />
        <rect x="40" y="70" width="80" height="80" fill="#E32636" opacity="0.9" />
      </svg>
    </div>
  )
}

// ---------- what is still missing ----------

function missingOf(form) {
  const people = VISITORS.reduce((s, v) => s + form.counts[v.id], 0)
  const step1 = []
  if (people === 0) step1.push('at least one visitor')
  if (!form.date) step1.push('date')
  if (!form.start) step1.push('start time')
  if (!(Number(form.hours) > 0)) step1.push('duration')
  if (!form.from) step1.push('start point')
  if (!form.to) step1.push('end point')
  if (form.maxBudget !== '' && !(Number(form.maxBudget) >= 0)) step1.push('a budget of €0 or more')
  const step2 = form.vibe ? [] : ['vibe']
  return { step1, step2, all: [...step1, ...step2] }
}

function Missing({ items }) {
  if (!items.length) return null
  return <p className="missing">Still needed: {items.join(', ')}.</p>
}

// ---------- the two steps ----------

function Counter({ label, note, value, onChange }) {
  return (
    <div className="counter">
      <span>
        {label}
        <span className="note">{note}</span>
      </span>
      <button onClick={() => onChange(Math.max(0, value - 1))} disabled={value === 0} aria-label={`fewer ${label}`}>−</button>
      <output>{value}</output>
      <button onClick={() => onChange(Math.min(30, value + 1))} aria-label={`more ${label}`}>+</button>
    </div>
  )
}

// Start or end: "Choose on map" first, then points already picked on the map, stations and stops, landmarks.
function EndpointSelect({ label, value, onChange, endpoints, picked, onChooseOnMap }) {
  const options = [
    { value: CHOOSE_ON_MAP, label: '📍 Choose on map', action: onChooseOnMap },
    ...picked.map((p) => ({ value: p.id, label: p.name, group: 'Picked on the map' })),
    ...endpoints.map((e) => ({ value: e.id, label: e.name, group: e.group })),
  ]
  return <Dropdown label={label} value={value} options={options} onChange={onChange} />
}

// The chosen day hour by hour, 08:00 to 20:00. The start hour is highlighted and the hours of the walk are marked;
// clicking an hour makes it the start time.
function HourlyBar({ date, start, hours, onPickHour }) {
  const [day, setDay] = useState({ status: 'loading' })
  const strip = useRef()
  const startHour = start ? Number(start.slice(0, 2)) : null
  const endHour = startHour != null && Number(hours) > 0 ? startHour + Math.ceil(Number(hours) + Number(start.slice(3, 5)) / 60) : null

  useEffect(() => {
    if (!date) return
    let live = true
    setDay((d) => (d.status === 'ok' ? d : { status: 'loading' }))
    fetchDay(date, start).then((r) => live && setDay(r.known ? { status: 'ok', ...r } : { status: 'none' }))
    return () => {
      live = false
    }
    // Test weathers count from the start hour, so they follow it; the real forecast is fetched once per date.
  }, [date, startHour])

  // Bring the start hour into the middle of the strip, without moving the page.
  useEffect(() => {
    const el = strip.current?.querySelector('[aria-pressed="true"]')
    if (el) strip.current.scrollTo({ left: el.offsetLeft - strip.current.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
  }, [startHour, day])

  if (!date) return null
  return (
    <div className="hourly" aria-label={`Weather on ${date}, ${DAY_FROM}:00 to ${DAY_TO}:00`}>
      {day.status === 'loading' && <p className="hourly-note">Loading the forecast…</p>}
      {day.status === 'none' && <p className="hourly-note">No hourly forecast for this date yet (about 16 days ahead at most).</p>}
      {day.status === 'ok' && (
        <>
          <div className="hourly-strip" ref={strip}>
            {day.hours.map((h) => {
              const hour = h.min / 60
              const on = hour === startHour
              const walk = endHour != null && hour >= startHour && hour < endHour
              const mm = h.precipitation ?? 0
              const words = WEATHER_WORDS[weatherKind(h.code)]
              return (
                <button
                  key={h.min}
                  className={`hour${walk ? ' in-walk' : ''}`}
                  aria-pressed={on}
                  aria-label={`${String(hour).padStart(2, '0')}:00, ${words}, ${Math.round(h.temperature)} degrees, ${mm.toFixed(1)} mm rain. Start here.`}
                  onClick={() => onPickHour(`${String(hour).padStart(2, '0')}:00`)}
                >
                  <span className="hour-time">{String(hour).padStart(2, '0')}</span>
                  <WeatherGlyph code={h.code} mm={mm} size={34} />
                  <span className="hour-temp">{Math.round(h.temperature)}°</span>
                  <span className="hour-mm">{mm > 0 ? `${mm.toFixed(1)} mm` : ' '}</span>
                </button>
              )
            })}
          </div>
          <p className="hourly-note rain-key">
            <span>{day.fake ? 'Test weather from the page address.' : 'Open-Meteo forecast.'}</span>
            <span className="dots-key" aria-label="Rain dots: one for a trace, two under 1.5 mm, three under 3 mm, four for 3 mm or more">
              {[1, 2, 3, 4].map((n) => (
                <span key={n}>
                  {Array.from({ length: n }, (_, i) => (
                    <i key={i} className={n === 4 ? 'big' : ''} />
                  ))}
                </span>
              ))}
              <span>more rain</span>
            </span>
            <span>Click an hour to start then.</span>
          </p>
        </>
      )}
    </div>
  )
}

function StepOne({ form, set, endpoints, missing, onNext, onChooseOnMap }) {
  const picked = Object.values(form.custom)
  return (
    <>
      <section className="block">
        <h3>Who</h3>
        {VISITORS.map((v) => (
          <Counter key={v.id} label={v.label} note={v.note} value={form.counts[v.id]} onChange={(n) => set({ counts: { ...form.counts, [v.id]: n } })} />
        ))}
      </section>
      <section className="block">
        <h3>When</h3>
        <div className="grid3">
          <label className="field">
            <span>Date</span>
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
          <label className="field">
            <span>Start time</span>
            <input type="time" value={form.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label className="field">
            <span>Duration (h)</span>
            <input type="number" min="1" max="10" step="0.5" placeholder="e.g. 6" value={form.hours} onChange={(e) => set({ hours: e.target.value })} />
          </label>
        </div>
        <HourlyBar date={form.date} start={form.start} hours={form.hours} onPickHour={(start) => set({ start })} />
      </section>
      <section className="block">
        <h3>Where</h3>
        <div className="grid2">
          <EndpointSelect
            label="Start point"
            value={form.from}
            onChange={(from) => set({ from })}
            endpoints={endpoints}
            picked={picked}
            onChooseOnMap={() => onChooseOnMap('from')}
          />
          <EndpointSelect
            label="End point"
            value={form.to}
            onChange={(to) => set({ to })}
            endpoints={endpoints}
            picked={picked}
            onChooseOnMap={() => onChooseOnMap('to')}
          />
        </div>
      </section>
      <section className="block">
        <h3>Money</h3>
        <div className="grid2">
          <label className="field">
            <span>Max budget for the group (€) <em>optional</em></span>
            <input type="number" min="0" step="1" inputMode="decimal" placeholder="no limit" value={form.maxBudget} onChange={(e) => set({ maxBudget: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.useBus} onChange={(e) => set({ useBus: e.target.checked })} />
            <span>Arrive and leave by bus (adds tickets)</span>
          </label>
        </div>
      </section>
      <div className="actions">
        <Missing items={missing.step1} />
        <button className="primary" disabled={missing.step1.length > 0} onClick={onNext}>
          Next: Choose vibe →
        </button>
      </div>
    </>
  )
}

// The quick street preference: three small cards, one click. None chosen: we ask only if the weather calls for it.
// The forecast for your hours marks the card that suits it.
function QuickPrefs({ form, set }) {
  const [suggest, setSuggest] = useState(null)
  useEffect(() => {
    if (!form.date || !form.start || !(Number(form.hours) > 0)) return
    let live = true
    fetchWeather(form.date, form.start, Number(form.hours)).then((r) => live && setSuggest(suggestFor(summarise(r), form.date)))
    return () => {
      live = false
    }
  }, [form.date, form.start, form.hours])

  return (
    <section className="block">
      <h3>
        Streets <em>optional</em>
      </h3>
      <div className="quick" role="radiogroup" aria-label="Street preference">
        {QUICK_PREFS.map((q) => {
          const on = form.quick === q.id
          const tip = suggest?.choice === q.id
          return (
            <button
              key={q.id}
              role="radio"
              aria-checked={on}
              className={`quick-card${on ? ' active' : ''}`}
              onClick={() => set({ quick: on ? '' : q.id })}
            >
              <QuickGlyph kind={q.id} />
              <span className="quick-text">
                <span className="quick-label">{q.label}</span>
                <span className="quick-hint">{q.hint}</span>
              </span>
              {tip && <span className="quick-tip">Suggested · {suggest.why}</span>}
            </button>
          )
        })}
      </div>
      <p className="quick-note">{form.quick ? 'Click it again to let the weather decide.' : 'None chosen: we ask only if the weather calls for it.'}</p>
    </section>
  )
}

function StepTwo({ form, set, places, missing, onBack, onGenerate, busy, error }) {
  return (
    <>
      <section className="block">
        <h3>Vibe</h3>
        <div className="vibes" role="radiogroup" aria-label="Vibe">
          {VIBES.map((v) => (
            <button key={v.id} role="radio" aria-checked={form.vibe === v.id} className={form.vibe === v.id ? 'active' : ''} onClick={() => set({ vibe: v.id })}>
              <VibeIcon vibe={v.id} />
              <span>{v.label}</span>
            </button>
          ))}
        </div>
      </section>
      <QuickPrefs form={form} set={set} />
      <section className="block">
        <h3>Must-sees <em>optional</em></h3>
        <div className="grid2">
          {[0, 1].map((k) => (
            <Dropdown
              key={k}
              label={`Must-see point ${k + 1}`}
              value={form.anchors[k]}
              placeholder="None"
              options={[
                { value: '', label: 'None' },
                ...places
                  .filter((p) => k === 0 || p.id !== form.anchors[0])
                  .map((p) => {
                    const vibe = mainVibe(p)
                    return {
                      value: p.id,
                      label: p.name,
                      color: VIBE_COLOR[vibe],
                      icon: <VibeIcon vibe={vibe} size={14} />,
                      note: `${VIBE_LABEL[vibe]} · ${p.visit_min} min · ${p.price?.adult > 0 ? `adult €${p.price.adult.toFixed(2)}` : 'free'}`,
                    }
                  }),
              ]}
              onChange={(v) => set({ anchors: k === 0 ? [v, form.anchors[1] === v ? '' : form.anchors[1]] : [form.anchors[0], v] })}
            />
          ))}
        </div>
        <p className="vibe-key" aria-hidden="true">
          {['classic', 'modern', 'nature'].map((v) => (
            <span key={v}>
              <VibeIcon vibe={v} size={12} /> {VIBE_LABEL[v]}
            </span>
          ))}
        </p>
      </section>
      {error && <p className="warn">{error}</p>}
      <div className="actions">
        <Missing items={missing.all} />
        <div className="row">
          <button onClick={onBack}>← Back</button>
          <button className="primary" disabled={missing.all.length > 0 || !!busy} onClick={onGenerate}>
            {busy ?? 'Generate smart route'}
          </button>
        </div>
      </div>
    </>
  )
}

// ---------- the questions on the way ----------

// A must-see far from its bus stop, in extreme weather: go anyway, or leave it out for sheltered places.
// The words are few; the two signs say what is at stake, the two cards what you can do.
function TradeOff({ ask, onAnswer }) {
  const name = ask.place.short ?? ask.place.name
  return (
    <div className="modal-back glass-back">
      <div className="modal question tradeoff" role="dialog" aria-modal="true" aria-labelledby="tradeoff-title" aria-describedby="tradeoff-facts">
        <p className="q-head">
          <span className="q-must">Must-see</span>
        </p>
        <h2 id="tradeoff-title">{name}</h2>
        <ul className="facts" id="tradeoff-facts">
          <li>
            <DayGlyph kind={ask.kind ?? 'rain'} size={22} />
            <span>{ask.label}</span>
          </li>
          <li>
            <WalkGlyph />
            <span>{Math.round(ask.walk)} min on foot from the bus</span>
          </li>
        </ul>
        <div className="choices">
          <button className="choice" onClick={() => onAnswer(true)} autoFocus>
            <ChoiceGlyph kind="through" />
            <span className="choice-label">
              <span className="choice-letter">A</span>Go anyway
            </span>
            <span className="choice-hint">Direct path to {name}</span>
          </button>
          <button className="choice" onClick={() => onAnswer(false)}>
            <ChoiceGlyph kind="shelter" />
            <span className="choice-label">
              <span className="choice-letter">B</span>Sheltered alternative
            </span>
            <span className="choice-hint">Skip it; indoor places instead</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// One weather question before the route is made: two picture cards to choose from.
function Question({ q, n, of, onAnswer }) {
  return (
    <div className="modal-back glass-back">
      <div className="modal question" role="dialog" aria-modal="true" aria-labelledby={`q-${q.id}`} aria-describedby={`q-${q.id}-text`}>
        <p className="q-head">
          <DayGlyph kind={q.id} size={22} />
          <span>{q.context}</span>
          {of > 1 && <span className="q-count">{n} / {of}</span>}
        </p>
        <h2 id={`q-${q.id}`}>{q.title}</h2>
        <p id={`q-${q.id}-text`} className="q-text">{q.text}</p>
        <div className="choices">
          {q.options.map((o, i) => (
            <button key={o.label} className="choice" onClick={() => onAnswer(o.answer)} autoFocus={i === 0}>
              <ChoiceGlyph kind={o.glyph} />
              <span className="choice-label">
                <span className="choice-letter">{'AB'[i]}</span>
                {o.label}
              </span>
              <span className="choice-hint">{o.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function DryWindow({ offer, onAnswer }) {
  return (
    <div className="modal-back glass-back">
      <div className="modal glass" role="dialog" aria-modal="true">
        <h2>🌤️ Dry Window Alert!</h2>
        <p>
          The rain stops temporarily, {clock(offer.window.start)}–{clock(offer.window.end)}. You have a chance to visit{' '}
          <strong>{offer.place.name}</strong>. It adds {Math.round(offer.addedMin)} mins to your walk. Do you want to grab
          this opportunity?
        </p>
        {offer.dropped.length > 0 && <p className="note">To stay within your time, this leaves out: {offer.dropped.join(', ')}.</p>}
        <div className="row">
          <button onClick={() => onAnswer(false)}>No, stick to the current route</button>
          <button className="primary" onClick={() => onAnswer(true)}>Yes, add it</button>
        </div>
      </div>
    </div>
  )
}

// ---------- the itinerary, on the map ----------

const pct = (v) => `${Math.round(v * 100)} %`

// What your weather answers did to the route.
function Preferences({ route, prefs }) {
  const s = route.streets
  const items = []
  if (s) {
    const { label } = PATHS[s.path]
    const extra = Math.round(s.extraMin)
    items.push(
      <li key="streets">
        <ChoiceGlyph kind={s.path} size={24} />
        <span>
          <strong>{pct(s.share)}</strong> of the walk {label}; on the shortest ways it would be {pct(s.shortestShare)}.{' '}
          {extra > 0 ? `${extra} min more walking.` : 'No extra walking.'}
          <span className="note">
            {s.path === 'shelter'
              ? 'Counted: streets within 6 m of a building at least 6 m tall.'
              : s.sunHours === 0
                ? 'The sun is down during your walk, so everything counts as shade.'
                : "Shade cast by the 3D buildings for the sun's position in each hour of your walk; parks count as tree shade, as the data has no trees."}
          </span>
        </span>
      </li>,
    )
  }
  if (prefs.rainOk)
    items.push(
      <li key="rain">
        <ChoiceGlyph kind="rain" size={24} />
        <span>Rain route: outdoor places are not avoided.</span>
      </li>,
    )
  if (route.reorder)
    items.push(
      <li key="reorder">
        <ChoiceGlyph kind="early" size={24} />
        <span>
          {route.reorder.outdoor > 0 ? (
            <>
              Outdoor time in good weather: {pct(route.reorder.before)} → <strong>{pct(route.reorder.after)}</strong>.
              {route.reorder.dropped.length > 0 && <span className="note">Left out to make room: {route.reorder.dropped.join(', ')}.</span>}
            </>
          ) : (
            'No outdoor stops on this route to move into the better hours.'
          )}
        </span>
      </li>,
    )
  if (!items.length) return null
  return <ul className="prefs">{items}</ul>
}

export function Itinerary({ plan, selected, onSelect }) {
  const { route, weather } = plan
  return (
    <>
      <p className="weather">
        {!weather.known && 'No forecast for this date yet; the weather was not checked.'}
        {weather.known && (
          <>
            <WeatherGlyph code={weather.code} size={18} /> {Math.round(weather.min)}–{Math.round(weather.max)} °C, {weather.rain.toFixed(1)} mm rain
            {weather.extreme && <strong> · {weather.reason}: indoor places preferred</strong>}
            {weather.fake && <span className="note">Test weather from the page address, not a forecast.</span>}
          </>
        )}
      </p>
      <Preferences route={route} prefs={plan.prefs ?? {}} />
      {route.dropped?.length > 0 && <p className="note">Left out at your choice: {route.dropped.join(', ')}.</p>}
      {route.dryDropped?.length > 0 && <p className="note">Left out to make room for the dry window: {route.dryDropped.join(', ')}.</p>}
      <div className="summary">
        <div>
          <strong>{hm(route.totalMin)}</strong>
          <span className="note">{hm(Math.max(0, route.freeMin))} spare</span>
        </div>
        <div>
          <strong>{eur(route.cost.total)}</strong>
          <span className="note">whole group</span>
        </div>
        <div>
          <strong>{route.stops.length - 2}</strong>
          <span className="note">stops</span>
        </div>
      </div>
      {route.budget && (
        <p className={`budget-line${route.budget.over ? ' over' : ''}`}>
          {route.budget.over
            ? `Bus tickets and must-sees alone cost ${eur(route.mandatoryCost)}, over your ${eur(route.budget.max)} budget. Only free places were added.`
            : `Budget ${eur(route.budget.max)}: ${eur(route.cost.total)} spent, ${eur(route.budget.left)} left`}
          <span className="meter">
            <span style={{ width: `${Math.min(100, (100 * route.cost.total) / Math.max(route.budget.max, 0.01))}%` }} />
          </span>
        </p>
      )}
      <ol className="timeline">
        {route.stops.map((s, i) => {
          const first = i === 0
          const n = first || s.end ? null : i
          return (
            <li key={i} className={s.anchor ? 'anchor' : s.dry ? 'dry' : first || s.end ? 'end' : ''}>
              {s.walkMin > 0 && <span className="leg">{Math.max(1, Math.round(s.walkMin))} min walk</span>}
              <button className={selected === i ? 'active' : ''} onClick={() => onSelect(selected === i ? null : i)}>
                <span className="time">{clock(s.arrive)}</span>
                <span className="dot">{n ?? (first ? 'S' : 'E')}</span>
                <span>
                  {first ? `Start: ${s.place.name}` : s.end ? `End: ${s.place.name}` : s.place.name}
                  {n && (
                    <span className="note">
                      {s.place.visit_min} min{s.anchor && ' · must-see'}
                      {s.dry && ' · 🌤️ in the dry window'}
                      {s.place.price && s.place.price.adult > 0 ? ` · adult ${eur(s.place.price.adult)}` : ' · free'}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <table className="cost">
        <tbody>
          {VISITORS.filter((v) => route.cost.byType[v.id].n > 0).map((v) => {
            const c = route.cost.byType[v.id]
            return (
              <tr key={v.id}>
                <th>{c.n} × {v.label}</th>
                <td>
                  {eur(c.total)}
                  <span className="note">entry {eur(c.entry)}{route.opts.useBus && ` · bus ${eur(c.bus)}`}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="method">
        Walking at 4.8 km/h on the pedestrian network. The must-sees are fixed first; the rest of the time is filled with
        the places that match the vibe best for the extra minutes they cost, then the order is untangled so you don't
        walk back and forth. Places, prices and visit times are estimates; check opening hours.
      </p>
    </>
  )
}

// ---------- the wizard ----------

// kit: the loaded city kit. onDone({ route, weather, prefs }) when a route is ready.
// onClose: back to the map without changes, or null on first use.
// onChooseOnMap(callback): hide the wizard for one click on the map; callback({ id, name, xy }) or callback(null).
export default function RoutePlanner({ kit, onDone, onClose, onChooseOnMap }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    counts: { bauhaus: 0, student: 0, adult: 0 },
    date: today(),
    start: '10:00',
    hours: '',
    from: '',
    to: '',
    useBus: true,
    vibe: '',
    anchors: ['', ''],
    maxBudget: '',
    custom: {}, // points picked on the map, by id
    quick: '', // quick street preference: '', 'direct', 'sun' or 'cover'
  })
  const [busy, setBusy] = useState(null) // what is being worked out, for the button
  const [error, setError] = useState(null)
  const [asking, setAsking] = useState(null) // { questions, index, prefs, w } while the weather questions are open
  const [pending, setPending] = useState(null) // { queue, kept, dropped, w, prefs } while the bad-weather question is open
  const [dryOffer, setDryOffer] = useState(null) // { route, offer, w, ctx } while the dry-window question is open
  const set = (patch) => {
    setError(null)
    setForm((f) => ({ ...f, ...patch }))
  }
  const endpoints = endpointsOf(kit.poi)
  const places = kit.poi.places
  const missing = missingOf(form)
  const [sh, sm] = form.start.split(':').map(Number)
  const startMin = sh * 60 + sm
  const durationMin = Number(form.hours) * 60

  const chooseOnMap = (which) =>
    onChooseOnMap((point) => {
      if (!point) return
      setError(null)
      setForm((f) => ({ ...f, [which]: point.id, custom: { ...f.custom, [point.id]: point } }))
    })

  // The networks: the plain one, and for a preferred kind of street one that favours it.
  const networks = (path) => {
    const base = networkFor(kit)
    if (!path) return { net: base, base, climate: null }
    const climate = streetClimate(kit, form.date, startMin, durationMin)
    const net = networkFor(kit, `${path}|${form.date}|${startMin}|${durationMin}`, streetWeights(climate, path))
    return { net, base, climate }
  }

  // What the chosen streets did: the share of the walk with the wanted quality, against the shortest ways.
  const finalize = (route, w, ctx) => {
    const { base, climate, prefs } = ctx
    let streets = null
    if (prefs.path) {
      const metric = PATHS[prefs.path].metric
      const shortest = sameStopsOn(base, route.seq.map((k) => route.stops.find((s) => s.index === k).place.id))
      const walked = route.stops.reduce((s, st) => s + st.walkMin, 0)
      streets = {
        path: prefs.path,
        share: shareOf(kit, route.edges, climate[metric]),
        shortestShare: shareOf(kit, shortest.edges, climate[metric]),
        extraMin: walked - shortest.minutes,
        sunHours: climate.hours,
      }
    }
    onDone({ route: { ...route, streets }, weather: w, prefs })
  }

  const finish = async (kept, dropped, w, prefs) => {
    setBusy(prefs.path ? 'Working out sun and shade…' : 'Planning…')
    await new Promise((r) => setTimeout(r, 30)) // let the button show it before the work starts
    const ctx = { ...networks(prefs.path), prefs }
    const { net, base } = ctx
    for (const id of [form.from, form.to])
      if (form.custom[id]) {
        net.addEndpoint(form.custom[id])
        base.addEndpoint(form.custom[id])
      }
    const r = planRoute(net, {
      counts: form.counts,
      startMin,
      durationMin,
      vibe: form.vibe,
      anchors: kept,
      start: form.from,
      end: form.to,
      weather: w,
      useBus: form.useBus,
      maxBudget: form.maxBudget === '' ? null : Math.max(0, Number(form.maxBudget)),
      rainOk: !!prefs.rainOk,
    })
    setBusy(null)
    if (!r.ok) {
      setError(`Your start, must-sees and end alone take ${hm(r.mandatoryMin)}, longer than the ${hm(durationMin)} you have. Add time or drop a must-see.`)
      return
    }
    let full = { ...r, dropped }
    if (prefs.reorder) {
      const o = optimizeForWeather(net, full, w.hours)
      full = { ...o.route, dropped, reorder: { before: o.before, after: o.after, outdoor: o.outdoor, dropped: o.dropped } }
    }
    // Before showing the route, offer an outdoor place in a dry hour of a rainy day.
    const offer = findDryWindow(net, full, w)
    if (offer) setDryOffer({ route: full, offer, w, ctx })
    else finalize(full, w, ctx)
  }

  // After the weather questions: the question about far must-sees in extreme weather, then the route.
  const afterQuestions = (prefs, w) => {
    const anchors = form.anchors.filter(Boolean)
    const net = networkFor(kit)
    const queue = w.extreme
      ? anchors
          .map((id) => net.points.findIndex((p) => p.id === id))
          .filter((k) => net.busWalk[k] > LONG_STOP_WALK_MIN)
          .map((k) => ({ id: net.points[k].id, place: net.points[k], walk: net.busWalk[k], kind: w.extremeKind, label: w.extremeLabel }))
      : []
    if (queue.length) setPending({ queue, kept: anchors, dropped: [], w, prefs })
    else finish(anchors, [], w, prefs)
  }

  const generate = async () => {
    if (missing.all.length || busy) return
    setBusy('Checking the weather…')
    const w = summarise(await fetchWeather(form.date, form.start, Number(form.hours)))
    setBusy(null)
    // A quick street choice made in step 2 answers the street question already; only the one about the order remains.
    const quick = form.quick ? { path: pathForQuick(form.quick, w) } : {}
    const questions = questionsFor(w, form.date).filter((q) => !form.quick || q.id === 'changing')
    if (questions.length) setAsking({ questions, index: 0, prefs: quick, w })
    else afterQuestions(quick, w)
  }

  const answerQuestion = (answer) => {
    const prefs = { ...asking.prefs, ...answer }
    if (asking.index + 1 < asking.questions.length) setAsking({ ...asking, index: asking.index + 1, prefs })
    else {
      setAsking(null)
      afterQuestions(prefs, asking.w)
    }
  }

  const answer = (keep) => {
    const [ask, ...rest] = pending.queue
    const kept = keep ? pending.kept : pending.kept.filter((id) => id !== ask.id)
    const dropped = keep ? pending.dropped : [...pending.dropped, ask.place.name]
    if (rest.length) setPending({ ...pending, queue: rest, kept, dropped })
    else {
      setPending(null)
      finish(kept, dropped, pending.w, pending.prefs)
    }
  }

  const answerDry = (yes) => {
    const { route, offer, w, ctx } = dryOffer
    setDryOffer(null)
    finalize(yes ? { ...describeRoute(ctx.net, route, offer.seq, offer.index), dryDropped: offer.dropped } : route, w, ctx)
  }

  return (
    <div className="wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <div className="wizard-inner">
        <header>
          <HeroLogo />
          <h1 id="wizard-title">Weimar walks</h1>
          <p className="lede">A walking route through Weimar for your group, your time and your mood.</p>
          {onClose && (
            <button className="close" onClick={onClose} aria-label="Back to the map">
              ×
            </button>
          )}
        </header>
        <ol className="stepper">
          <li className={step === 1 ? 'on' : 'done'}>
            <span>1</span> Group, time and place
          </li>
          <li className={step === 2 ? 'on' : ''}>
            <span>2</span> Vibe and must-sees
          </li>
        </ol>
        {step === 1 && (
          <StepOne form={form} set={set} endpoints={endpoints} missing={missing} onNext={() => setStep(2)} onChooseOnMap={chooseOnMap} />
        )}
        {step === 2 && (
          <StepTwo form={form} set={set} places={places} missing={missing} busy={busy} error={error} onBack={() => setStep(1)} onGenerate={generate} />
        )}
      </div>
      {asking && (
        <Question q={asking.questions[asking.index]} n={asking.index + 1} of={asking.questions.length} onAnswer={answerQuestion} />
      )}
      {pending && <TradeOff ask={pending.queue[0]} onAnswer={answer} />}
      {dryOffer && <DryWindow offer={dryOffer.offer} onAnswer={answerDry} />}
    </div>
  )
}
