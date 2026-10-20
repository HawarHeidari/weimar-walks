// Colours for the dark Bauhaus map: a near-black ground, muted building uses that read well against it,
// and the three Bauhaus primaries for what matters (the route, the must-sees, the landmarks).

export const BAUHAUS = {
  red: '#e0301e',
  blue: '#1d4fd8',
  yellow: '#f5c400',
  black: '#0d0d0d',
  white: '#f3f0e8',
}

export const USE_COLORS = {
  residential: ['#6b6862', 'residential'],
  service: ['#5f6b74', 'service'],
  office: ['#55697c', 'office'],
  retail: ['#8c7a3f', 'retail'],
  food_and_drink: ['#83654f', 'food and drink'],
  accommodation: ['#74645e', 'accommodation'],
  education: ['#5c7a52', 'education'],
  health: ['#4c7d77', 'health'],
  civic: ['#5a6a8c', 'civic'],
  culture: ['#76628f', 'culture'],
  entertainment: ['#82668e', 'entertainment'],
  sport: ['#6f7f46', 'sport'],
  transport: ['#5a5a54', 'transport'],
  light_industrial: ['#706652', 'light industrial'],
  undefined: ['#58585a', 'use unknown'],
}

// 5, 10 and 15 minutes: bright to dark, so the nearest area glows most on the black ground.
export const REACH_COLORS = ['#ff5a36', '#d9452a', '#8f2e1d']

export const GROUND = '#141414'
export const BACKGROUND = '#070707'
export const STREET = '#3b3b3b'

// The planned route: the line and stops in yellow, the must-sees in red.
export const ROUTE = BAUHAUS.yellow
export const ROUTE_ANCHOR = BAUHAUS.red
export const ROUTE_DRY = '#ffffff'

// Landmarks: gold for the classic ones, a bright blue for the modern ones.
export const LANDMARK_CLASSIC = '#f2b705'
export const LANDMARK_MODERN = '#2f7bff'

// Green on the ground: parks vivid, cemeteries a little quieter.
export const PARK = '#3f9e3a'
export const CEMETERY = '#2c6b35'

// Light for the weather of the planned walk.
export const MOODS = {
  normal: { sky: '#ffffff', groundLight: '#3a3a3a', hemi: 2.1, sun: 1.7, sunColor: '#ffffff', background: BACKGROUND },
  sunny: { sky: '#fff6e2', groundLight: '#4a4236', hemi: 2.5, sun: 2.4, sunColor: '#ffe9c2', background: '#0d0b07' },
  rainy: { sky: '#b9c6d4', groundLight: '#2a3036', hemi: 1.6, sun: 0.7, sunColor: '#cdd8e4', background: '#06090c' },
}
