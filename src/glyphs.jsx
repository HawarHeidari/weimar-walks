// Flat geometric pictures in the five Bauhaus colours only: red, blue, yellow, black, white.
// Weather by the hour, the climate choices before a route is made, and small marks for the itinerary.

export const C = { red: '#e0301e', blue: '#1d4fd8', yellow: '#f5c400', black: '#0d0d0d', white: '#f3f0e8' }

// ---------- weather by the hour ----------

// The kind of weather for an Open-Meteo weather code.
export function weatherKind(code) {
  if (code <= 1) return 'sun'
  if (code === 2) return 'part'
  if (code === 3 || code === 45 || code === 48) return 'cloud'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'storm'
  return 'rain'
}

export const WEATHER_WORDS = {
  sun: 'clear',
  part: 'some clouds',
  cloud: 'grey',
  rain: 'rain',
  snow: 'snow',
  storm: 'thunderstorm',
}

// A cloud is a white bar with a square on top: no curves, like the rest.
const Cloud = ({ x = 6, y = 12 }) => (
  <g fill={C.white}>
    <rect x={x} y={y + 5} width="20" height="7" />
    <rect x={x + 5} y={y} width="8" height="6" />
  </g>
)

// How many rain dots for an hour's rain: 1 a trace, 2 under 1.5 mm, 3 under 3 mm, 4 (and bigger) 3 mm or more.
export function dropsFor(mm) {
  if (!(mm > 0)) return 0
  return mm < 0.5 ? 1 : mm < 1.5 ? 2 : mm < 3 ? 3 : 4
}

// With `mm`, the rain is drawn as blue dots right under the cloud, one to four by amount, instead of rain lines.
export function WeatherGlyph({ code, size = 28, mm }) {
  const kind = weatherKind(code)
  if (mm != null && (mm > 0 || kind === 'rain' || kind === 'storm')) return <RainDots kind={kind} mm={mm} size={size} />
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {kind === 'sun' && <circle cx="16" cy="16" r="9" fill={C.yellow} />}
      {kind === 'part' && (
        <>
          <circle cx="12" cy="12" r="7" fill={C.yellow} />
          <Cloud x={8} y={13} />
        </>
      )}
      {kind === 'cloud' && (
        <>
          <Cloud x={6} y={8} />
          <rect x="10" y="22" width="16" height="3" fill={C.white} opacity="0.55" />
        </>
      )}
      {kind === 'rain' && (
        <>
          <Cloud x={6} y={4} />
          <g stroke={C.blue} strokeWidth="2.5">
            <line x1="11" y1="20" x2="9" y2="27" />
            <line x1="17" y1="20" x2="15" y2="27" />
            <line x1="23" y1="20" x2="21" y2="27" />
          </g>
        </>
      )}
      {kind === 'snow' && (
        <>
          <Cloud x={6} y={4} />
          <g fill={C.white}>
            <rect x="9" y="21" width="3" height="3" />
            <rect x="15" y="24" width="3" height="3" />
            <rect x="21" y="21" width="3" height="3" />
          </g>
        </>
      )}
      {kind === 'storm' && (
        <>
          <Cloud x={6} y={4} />
          <polyline points="17,18 12,24 17,24 13,30" fill="none" stroke={C.red} strokeWidth="2.5" />
        </>
      )}
    </svg>
  )
}

// A cloud with a row of rain dots under it (white squares for snow, a red flash for a storm).
function RainDots({ kind, mm, size }) {
  const n = Math.max(1, dropsFor(mm))
  const r = n === 4 ? 2.6 : 2.1
  const gap = 6.5
  const x0 = 16 - ((n - 1) * gap) / 2
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <Cloud x={6} y={3} />
      {kind === 'storm' && <polyline points="27,6 24,11 27,11 24,16" fill="none" stroke={C.red} strokeWidth="2" />}
      {Array.from({ length: n }, (_, i) =>
        kind === 'snow' ? (
          <rect key={i} x={x0 + i * gap - r} y={23 - r} width={2 * r} height={2 * r} fill={C.white} />
        ) : (
          <circle key={i} cx={x0 + i * gap} cy="23" r={r} fill={C.blue} />
        ),
      )}
    </svg>
  )
}

// ---------- the climate choices ----------

// One picture per answer, drawn on a white card.
export function ChoiceGlyph({ kind, size = 96 }) {
  const { red, blue, yellow, black, white } = C
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      {kind === 'rain' && (
        // A blue drop with rain lines, and a red accent: walking out in it.
        <>
          <g stroke={blue} strokeWidth="3">
            <line x1="20" y1="10" x2="14" y2="30" />
            <line x1="34" y1="6" x2="28" y2="26" />
            <line x1="74" y1="12" x2="68" y2="32" />
          </g>
          <path d="M48 18 L66 52 A18 18 0 1 1 30 52 Z" fill={blue} />
          <rect x="62" y="70" width="14" height="14" fill={red} />
          <line x1="8" y1="88" x2="88" y2="88" stroke={black} strokeWidth="3" />
        </>
      )}
      {kind === 'shelter' && (
        // A facade with a yellow overhang; the path runs dry beneath it.
        <>
          <rect x="12" y="10" width="34" height="78" fill={black} />
          <g fill={white}>
            <rect x="18" y="18" width="8" height="10" />
            <rect x="32" y="18" width="8" height="10" />
            <rect x="18" y="36" width="8" height="10" />
            <rect x="32" y="36" width="8" height="10" />
          </g>
          <rect x="12" y="54" width="62" height="7" fill={yellow} />
          <line x1="46" y1="88" x2="90" y2="88" stroke={black} strokeWidth="3" />
          <line x1="50" y1="76" x2="84" y2="76" stroke={black} strokeWidth="3" strokeDasharray="6 5" />
        </>
      )}
      {kind === 'sun' && (
        // An open path under a full yellow sun.
        <>
          <circle cx="48" cy="38" r="24" fill={yellow} />
          <line x1="8" y1="78" x2="88" y2="78" stroke={black} strokeWidth="4" />
        </>
      )}
      {kind === 'shade' && (
        // A blue canopy over a black stem; the path below it lies in its shadow.
        <>
          <path d="M14 46 A34 34 0 0 1 82 46 Z" fill={blue} />
          <rect x="45" y="46" width="6" height="32" fill={black} />
          <rect x="20" y="78" width="56" height="6" fill={black} />
          <line x1="6" y1="88" x2="90" y2="88" stroke={black} strokeWidth="2" />
        </>
      )}
      {kind === 'canopy' && (
        // Layers of shade: a yellow roof above a blue one, over the path.
        <>
          <rect x="10" y="14" width="60" height="14" fill={yellow} />
          <rect x="26" y="36" width="60" height="14" fill={blue} />
          <rect x="10" y="58" width="44" height="10" fill={black} />
          <line x1="6" y1="84" x2="90" y2="84" stroke={black} strokeWidth="3" />
        </>
      )}
      {kind === 'direct' && (
        // A sharp red line straight from start to goal.
        <>
          <rect x="8" y="74" width="14" height="14" fill={black} />
          <circle cx="80" cy="16" r="8" fill={black} />
          <line x1="20" y1="76" x2="68" y2="28" stroke={red} strokeWidth="6" />
          <polygon points="78,18 56,26 70,40" fill={red} />
        </>
      )}
      {kind === 'through' && (
        // Straight on through the weather: the red line crosses the blue rain to the goal.
        <>
          <g stroke={blue} strokeWidth="3">
            <line x1="30" y1="8" x2="24" y2="26" />
            <line x1="50" y1="14" x2="44" y2="32" />
            <line x1="70" y1="40" x2="64" y2="58" />
          </g>
          <rect x="8" y="74" width="14" height="14" fill={black} />
          <rect x="70" y="10" width="18" height="18" fill={red} />
          <line x1="20" y1="76" x2="66" y2="30" stroke={red} strokeWidth="6" />
        </>
      )}
      {kind === 'warm' && (
        // A yellow sun held in a black grid: the streets that catch it.
        <>
          <circle cx="48" cy="48" r="30" fill={yellow} />
          <g stroke={black} strokeWidth="3">
            <line x1="8" y1="34" x2="88" y2="34" />
            <line x1="8" y1="62" x2="88" y2="62" />
            <line x1="34" y1="8" x2="34" y2="88" />
            <line x1="62" y1="8" x2="62" y2="88" />
          </g>
        </>
      )}
      {kind === 'shortest' && (
        // Black and white: a start, a goal and the straight line between.
        <>
          <rect x="8" y="40" width="16" height="16" fill={black} />
          <circle cx="80" cy="48" r="9" fill={black} />
          <line x1="24" y1="48" x2="71" y2="48" stroke={black} strokeWidth="4" />
        </>
      )}
      {kind === 'early' && (
        // The day as a bar, blue for rain and yellow for sun; the outdoor visit moves into the yellow.
        <>
          <rect x="8" y="50" width="36" height="14" fill={blue} />
          <rect x="44" y="50" width="44" height="14" fill={yellow} />
          <line x1="8" y1="64" x2="88" y2="64" stroke={black} strokeWidth="2" />
          <polygon points="66,46 58,32 74,32" fill={black} />
          <path d="M26 40 Q 40 16 56 26" fill="none" stroke={black} strokeWidth="3" strokeDasharray="5 4" />
          <rect x="22" y="72" width="8" height="8" fill={red} />
        </>
      )}
      {kind === 'fixed' && (
        // A strict black timeline with even ticks: nothing moves.
        <>
          <line x1="8" y1="56" x2="88" y2="56" stroke={black} strokeWidth="4" />
          <g fill={black}>
            <rect x="10" y="40" width="8" height="8" />
            <rect x="30" y="40" width="8" height="8" />
            <rect x="50" y="40" width="8" height="8" />
            <rect x="70" y="40" width="8" height="8" />
          </g>
          <g fill={white} stroke={black} strokeWidth="2">
            <rect x="11" y="64" width="6" height="6" />
            <rect x="31" y="64" width="6" height="6" />
            <rect x="51" y="64" width="6" height="6" />
            <rect x="71" y="64" width="6" height="6" />
          </g>
        </>
      )}
    </svg>
  )
}

// The quick street preference in step 2: red square for the direct way, yellow circle for sun, blue canopy for cover.
export function QuickGlyph({ kind, size = 36 }) {
  const { red, blue, yellow, white } = C
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      {kind === 'direct' && (
        <>
          <rect x="6" y="6" width="22" height="22" fill={red} />
          <line x1="16" y1="34" x2="36" y2="34" stroke={white} strokeWidth="3" />
          <polygon points="36,34 30,30 30,38" fill={white} />
        </>
      )}
      {kind === 'sun' && (
        <>
          <circle cx="20" cy="17" r="13" fill={yellow} />
          <line x1="4" y1="35" x2="36" y2="35" stroke={white} strokeWidth="3" />
        </>
      )}
      {kind === 'cover' && (
        <>
          <path d="M3 22 A17 17 0 0 1 37 22 Z" fill={blue} />
          <rect x="18" y="22" width="4" height="12" fill={white} />
          <line x1="4" y1="35" x2="36" y2="35" stroke={white} strokeWidth="3" />
        </>
      )}
    </svg>
  )
}

// The walk from the bus stop: a black square (the stop), a red line, a black circle (the place).
export function WalkGlyph({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="12" width="8" height="8" fill={C.white} />
      <line x1="10" y1="16" x2="23" y2="16" stroke={C.red} strokeWidth="3" />
      <circle cx="26" cy="16" r="4.5" fill={C.white} />
    </svg>
  )
}

// The small sign at the top of a question: what kind of day it is.
export function DayGlyph({ kind, size = 28 }) {
  const { red, blue, yellow, white } = C
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {kind === 'rain' && <path d="M16 3 L24 17 A8 8 0 1 1 8 17 Z" fill={blue} />}
      {kind === 'mildsun' && <circle cx="16" cy="16" r="11" fill={yellow} />}
      {kind === 'hot' && (
        <>
          <circle cx="16" cy="16" r="11" fill={yellow} />
          <circle cx="16" cy="16" r="5" fill={red} />
        </>
      )}
      {kind === 'cold' && (
        <>
          <rect x="5" y="5" width="22" height="22" fill={blue} />
          <rect x="12" y="12" width="8" height="8" fill={white} />
        </>
      )}
      {kind === 'changing' && (
        <>
          <path d="M16 4 A12 12 0 0 0 16 28 Z" fill={blue} />
          <path d="M16 4 A12 12 0 0 1 16 28 Z" fill={yellow} />
        </>
      )}
    </svg>
  )
}
