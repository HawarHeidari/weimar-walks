// The weather for the hours of the walk, from the free Open-Meteo forecast (no key needed).
// Test weathers for the page address, so every question can be tried on any day:
//   ?weather=rain       heavy rain (also the bad-weather warning for far must-sees)
//   ?weather=mildrain   light rain at 13 °C          ?weather=mildsun   sunny at 19 °C
//   ?weather=warm       sunny at 26 °C               ?weather=hot       sunny at 32 °C
//   ?weather=cold       grey at 1 °C                 ?weather=sun       sunny at 21 °C
//   ?weather=drywindow  rain with one dry hour       ?weather=clearing  rain for two hours, then sun
//   ?weather=clouding   sun for two hours, then grey

const LAT = 50.98
const LON = 11.33

// Weather codes for heavy rain, heavy snow, violent showers and thunderstorms.
const HEAVY_CODES = new Set([65, 67, 75, 82, 86, 95, 96, 99])
export const HEAVY_RAIN_MM = 4 // per hour
export const COLD_C = 5
export const HOT_C = 28

const pad = (n) => String(n).padStart(2, '0')
const addDays = (date, n) => {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const FAKE = {
  rain: { temperature: 9, precipitation: 6, code: 65 },
  cold: { temperature: 1, precipitation: 0, code: 3 },
  hot: { temperature: 32, precipitation: 0, code: 0 },
  sun: { temperature: 21, precipitation: 0, code: 0 },
  mildrain: { temperature: 13, precipitation: 1.2, code: 61 },
  mildsun: { temperature: 19, precipitation: 0, code: 0 },
  warm: { temperature: 26, precipitation: 0, code: 1 },
  // Steady rain, except the third hour of the walk.
  drywindow: (k) => (k === 2 ? { temperature: 13, precipitation: 0, code: 2 } : { temperature: 12, precipitation: 2.5, code: 63 }),
  clearing: (k) => (k < 2 ? { temperature: 11, precipitation: 1.5, code: 61 } : { temperature: 15, precipitation: 0, code: 1 }),
  clouding: (k) => (k < 2 ? { temperature: 17, precipitation: 0, code: 0 } : { temperature: 15, precipitation: 0, code: 3 }),
}

// One answer per address, so changing the start time does not ask Open-Meteo again.
const answers = new Map()
const getJSON = (url) => {
  if (!answers.has(url))
    answers.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j) => (j || answers.delete(url), j)), // a failure is not kept, so it is tried again later
    )
  return answers.get(url)
}

// Whole hours h0 (inclusive) to h1 (exclusive) of `date`; hours past 24 run into the next day.
// walkStartHour: the hour the walk starts, which the test weathers count from.
// Returns { known, fake?, hours: [{ time, min, temperature, precipitation, code }] }, where `min` is the start of the
// hour in minutes after midnight of the chosen date.
async function fetchHours(date, h0, h1, walkStartHour) {
  const fake = FAKE[new URLSearchParams(window.location.search).get('weather')]
  if (fake) {
    const hourly = Array.from({ length: h1 - h0 }, (_, k) => ({
      time: `${date}T${pad((h0 + k) % 24)}:00`,
      min: (h0 + k) * 60,
      ...(typeof fake === 'function' ? fake(h0 + k - walkStartHour) : fake),
    }))
    return { known: true, fake: true, hours: hourly }
  }

  const end = addDays(date, Math.floor((h1 - 1) / 24))
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&hourly=temperature_2m,precipitation,weather_code&timezone=Europe%2FBerlin&start_date=${date}&end_date=${end}`
  const j = await getJSON(url)
  const t = j?.hourly?.time ?? []
  const out = []
  for (let i = h0; i < h1 && i < t.length; i++) {
    if (j.hourly.temperature_2m[i] == null) continue
    out.push({ time: t[i], min: i * 60, temperature: j.hourly.temperature_2m[i], precipitation: j.hourly.precipitation[i], code: j.hourly.weather_code[i] })
  }
  return out.length ? { known: true, hours: out } : { known: false }
}

// The hours of the walk. date 'YYYY-MM-DD', start 'HH:MM', hours a number.
export function fetchWeather(date, start, hours) {
  const h0 = Number(start.slice(0, 2))
  const h1 = h0 + Math.ceil(hours + Number(start.slice(3, 5)) / 60)
  return fetchHours(date, h0, h1, h0)
}

// The day at a glance for the weather bar: 08:00 to 20:00.
export const DAY_FROM = 8
export const DAY_TO = 20
export function fetchDay(date, start) {
  return fetchHours(date, DAY_FROM, DAY_TO + 1, Number((start || '10:00').slice(0, 2)))
}

const WET_MM = 0.2 // an hour with at least this much rain counts as wet

// Stretches of whole hours with no rain at all (0 mm), as { start, end } in minutes after midnight, longest first.
function dryWindows(hours) {
  const out = []
  for (const h of hours) {
    if (h.precipitation !== 0) continue
    const last = out[out.length - 1]
    if (last && last.end === h.min) last.end += 60
    else out.push({ start: h.min, end: h.min + 60 })
  }
  return out.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
}

// Short summary for the panel, and whether any hour of the walk is extreme.
// rainy: at least half the hours are wet, or one is heavy. dry: the 0 mm windows inside a rainy walk.
export function summarise(weather) {
  if (!weather?.known) return { known: false, extreme: false, rainy: false, sunny: false, dry: [] }
  const temps = weather.hours.map((h) => h.temperature)
  const min = Math.min(...temps), max = Math.max(...temps)
  const rain = weather.hours.reduce((s, h) => s + (h.precipitation ?? 0), 0)
  const heavy = weather.hours.some((h) => h.precipitation >= HEAVY_RAIN_MM || HEAVY_CODES.has(h.code))
  const reasons = []
  if (heavy) reasons.push('heavy rain')
  if (min < COLD_C) reasons.push(`${Math.round(min)} °C`)
  if (max > HOT_C) reasons.push(`${Math.round(max)} °C`)
  const wet = weather.hours.filter((h) => h.precipitation >= WET_MM).length
  const rainy = heavy || wet >= weather.hours.length / 2
  const sunny = !rainy && rain === 0 && weather.hours.filter((h) => h.code <= 1).length >= weather.hours.length / 2
  const dry = rainy ? dryWindows(weather.hours) : []
  // One weather code for the whole walk, for its picture: the most common one, among the wet hours on a rainy walk.
  const counts = new Map()
  for (const h of weather.hours) if (!rainy || h.precipitation >= WET_MM || h.code >= 51) counts.set(h.code, (counts.get(h.code) ?? 0) + 1)
  const code = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? weather.hours[0].code
  const hours = weather.hours.map((h) => ({ ...h, good: goodness(h) }))
  const goods = hours.map((h) => h.good)
  // Changing: the best and worst hour differ a lot (rain and dry, or sun and grey).
  const changing = hours.length > 1 && Math.max(...goods) - Math.min(...goods) >= 0.5
  return {
    known: true,
    fake: weather.fake,
    min,
    max,
    rain,
    extreme: reasons.length > 0,
    reason: reasons.join(', '),
    // The main kind of extreme weather, for its picture, and a two-word label: heavy rain first, then heat, then cold.
    extremeKind: heavy ? 'rain' : max > HOT_C ? 'hot' : min < COLD_C ? 'cold' : null,
    extremeLabel: heavy ? 'Heavy rain' : max > HOT_C ? `${Math.round(max)} °C` : min < COLD_C ? `${Math.round(min)} °C` : '',
    code,
    rainy,
    sunny,
    dry,
    hours,
    changing,
    timeline: changing ? timeline(hours) : '',
  }
}

// ---------- weather by the hour ----------

// How good an hour is for being outdoors: 0 with rain, 0.5 grey or foggy, 0.8 some clouds, 1 sunny.
export function goodness(h) {
  if (h.precipitation >= WET_MM || h.code >= 51) return 0
  if (h.code <= 1) return 1
  if (h.code === 2) return 0.8
  return 0.5
}

const KIND = (g) => (g === 0 ? 'rain' : g >= 0.8 ? 'sunny' : 'grey')
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:00`

// "rain 10:00–12:00, then sunny 12:00–16:00"
function timeline(hours) {
  const parts = []
  for (const h of hours) {
    const kind = KIND(h.good), last = parts[parts.length - 1]
    if (last && last.kind === kind) last.end = h.min + 60
    else parts.push({ kind, start: h.min, end: h.min + 60 })
  }
  return parts.map((p, i) => `${i ? 'then ' : ''}${p.kind} ${hhmm(p.start)}–${hhmm(p.end)}`).join(', ')
}

// ---------- the questions before the route is made ----------

export function seasonOf(date) {
  const m = Number(date.slice(5, 7))
  return m <= 2 || m === 12 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn'
}

// The questions to ask for this weather and season, in order. Each has a short title and line, and two options;
// `glyph` names its picture in glyphs.jsx. An answer is a set of preferences:
//   path: 'shelter' | 'shade' | 'sun' | null (the kind of streets to prefer), rainOk, reorder (for changing weather).
// What kind of day it is for walking: hot, cold or mild, by temperature and season.
export function dayType(w, date) {
  const season = seasonOf(date)
  const hot = w.max >= 25 || (season === 'summer' && w.max >= 22)
  const cold = w.max <= 8 || (season === 'winter' && w.max <= 12)
  return { season, hot, cold, mild: !hot && !cold }
}

// The quick street preference that suits the forecast, if one clearly does: cover from rain or heat, sun when cold.
export function suggestFor(w, date) {
  if (!w?.known) return null
  const { hot, cold } = dayType(w, date)
  if (w.rainy) return { choice: 'cover', why: 'rain' }
  if (hot) return { choice: 'cover', why: `${Math.round(w.max)} °C` }
  if (cold) return { choice: 'sun', why: `${Math.round(w.max)} °C` }
  return null
}

export function questionsFor(w, date) {
  if (!w?.known) return []
  const { season, hot, cold, mild } = dayType(w, date)
  const context = `${season[0].toUpperCase()}${season.slice(1)} · ${Math.round(w.min)}–${Math.round(w.max)} °C${w.rain > 0 ? ` · ${w.rain.toFixed(1)} mm` : ''}`
  const out = []
  if (w.rainy)
    out.push({
      id: 'rain',
      context,
      title: mild ? 'Mild rainy day' : 'Rainy day',
      text: 'Walk out in the rain, or keep close to the building facades?',
      options: [
        { label: 'Rain route', hint: 'Outdoor places stay in', glyph: 'rain', answer: { path: null, rainOk: true } },
        { label: 'Sheltered route', hint: 'Streets along facades', glyph: 'shelter', answer: { path: 'shelter' } },
      ],
    })
  else if (hot)
    out.push({
      id: 'hot',
      context,
      title: season === 'summer' ? 'Hot summer day' : 'Hot day',
      text: 'Through shade and park canopies, even if it is a little longer?',
      options: [
        { label: 'Shade & canopies', hint: 'Shaded streets, parks', glyph: 'canopy', answer: { path: 'shade' } },
        { label: 'Direct fast path', hint: 'Shortest ways', glyph: 'direct', answer: { path: null } },
      ],
    })
  else if (cold)
    out.push({
      id: 'cold',
      context,
      title: season === 'winter' ? 'Cold winter day' : 'Cold day',
      text: 'A sunny route to keep warm, even if it is a little longer?',
      options: [
        { label: 'Sunny warm route', hint: 'Streets in the sun', glyph: 'warm', answer: { path: 'sun' } },
        { label: 'Shortest route', hint: 'Shortest ways', glyph: 'shortest', answer: { path: null } },
      ],
    })
  else if (w.sunny)
    out.push({
      id: 'mildsun',
      context,
      title: 'Mild sunny day',
      text: 'Soak up the sun on open paths, or walk in the shade?',
      options: [
        { label: 'Open sun path', hint: 'Streets in the sun', glyph: 'sun', answer: { path: 'sun' } },
        { label: 'Shaded path', hint: 'Shaded streets, parks', glyph: 'shade', answer: { path: 'shade' } },
      ],
    })
  if (w.changing)
    out.push({
      id: 'changing',
      context: w.timeline,
      title: 'Shifting weather',
      text: 'Visit the open-air places while the weather is good, even if the order changes?',
      options: [
        { label: 'Early outdoor visit', hint: 'Outdoors in the good hours', glyph: 'early', answer: { reorder: true } },
        { label: 'Fixed schedule', hint: 'Keep the order', glyph: 'fixed', answer: { reorder: false } },
      ],
    })
  return out
}
