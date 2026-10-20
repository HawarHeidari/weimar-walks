# Weimar walks

A walking route planner on a dark, Bauhaus-styled 3D map of central Weimar. Tell it who is coming, when, for how long, where you start and end, and what you are in the mood for; it plans a route through the city's sights that fits your time and budget, checks the weather for those hours, and plays the walk back as a time-lapse.

**Live:** https://hawarheidari.github.io/weimar-walks/

## Using it

1. **Group, time and place.** Count the visitors (Bauhaus students, other students, adults), pick the date, start time and duration, and choose a start and an end point: a station, a bus stop, a landmark, or **📍 Choose on map** to click any spot near a street. A budget for the whole group is optional. Below the time fields, an hourly weather bar shows the forecast from 08:00 to 20:00; click an hour to start then.
2. **Vibe and must-sees.** Pick a vibe (Classic, Modern, Nature or Surprise me), up to two must-sees, and if you like a street preference: **Direct**, **Sun** or **Cover** (shade, or building facades when it rains). The forecast marks the one that suits the day.
3. **Generate.** Depending on the weather you may get one or two short questions with picture cards (rain route or sheltered route, sun or shade, keep the order or move outdoor visits into the good hours), a warning if a must-see is a long walk from its bus stop in extreme weather, and an offer to fit in an outdoor place during a dry hour on a rainy day.
4. **The map.** The route is drawn in yellow with numbered stops; the city around it fades and the route's landmarks glow. At the bottom, a time slider plays the walk: Fiona walks the route and waits at each stop for its visit time. **Bird's eye** shows the whole route from above; **Observer** follows Fiona from behind and turns with her. Rain falls on the map only in the hours the forecast has rain, as heavily as it says.
5. **More.** **Itinerary** lists the stops with times, costs and what your weather answers changed; **Edit route** opens the wizard again with your choices; **Walk reach** is the older tool that shows how far you can walk in 5, 10 and 15 minutes from any point.

Keys on the map: ← and → move the time 5 minutes (with Shift 15), Space plays and pauses, Home and End jump to the start and end. Drag to orbit, right-drag to pan, scroll to zoom.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

`npm run build` makes the site in `dist/`. Every push to `main` publishes it at `https://<user>.github.io/<repo>/` through `.github/workflows/deploy.yml`.

### Test weathers

The real forecast only reaches about 16 days ahead and the weather is rarely what you want to test. Add one of these to the page address to replace the forecast with a made-up day:

| Address ending | Weather |
| --- | --- |
| `?weather=mildrain` | light rain, 13 °C |
| `?weather=rain` | heavy rain (also the warning for far must-sees) |
| `?weather=drywindow` | rain all day except one dry hour |
| `?weather=clearing` | rain for two hours, then sun |
| `?weather=clouding` | sun for two hours, then grey |
| `?weather=mildsun` / `?weather=sun` | sunny, 19 / 21 °C |
| `?weather=warm` / `?weather=hot` | sunny, 26 / 32 °C |
| `?weather=cold` | grey, 1 °C |

## How it works

### The route

- **Walking.** Everyone walks at 4.8 km/h (80 m a minute) on the pedestrian network in `streets.graph.json`. The walking time between every pair of places is the shortest walk along the network, plus the straight bit from each place to its nearest street.
- **Must-sees first.** The start, the must-sees and the end are fixed first, in whichever order is shorter. If they alone take longer than your time, the app says so.
- **Filling the time.** The rest of the time is filled from all places, not just those on the way. Each place scores by how well it fits the vibe (a good match counts about twenty times as much as none). The planner keeps adding the place worth most for the extra minutes it costs, at the point in the route where it costs least, until nothing more fits.
- **No back and forth.** The order is then untangled (2-opt): whenever reversing a run of stops makes the walk shorter, it is reversed.
- **Budget.** Entry for the whole group and the bus tickets (two each, if you come by bus) are counted as places are added. A place with a fee is only added while the money lasts; free places always may be. Bauhaus students are free everywhere.

### Weather

- **Forecast.** Hourly temperature, rain and weather type for Weimar come from the Open-Meteo forecast (no key needed), for the hours of your walk.
- **Questions.** Rain, heat (25 °C, or 22 °C in summer), cold (8 °C, or 12 °C in winter), a mild sunny day or weather that changes during the walk each lead to one question. A street preference chosen in step 2 answers the street question in advance.
- **Sun and shade.** For each hour of the walk the app works out where the sun is, then casts shadows from the 3D buildings onto sample points every 8 m along every street. A street's shade is the share of its points in shadow, averaged over the hours. Parks and cemeteries count as tree shade.
- **Sheltered streets.** Points within 6 m of a building at least 6 m tall count as "along facades".
- **Preferring streets.** A street with none of what you asked for counts as up to three times as long when the way is chosen, so preferred streets win unless the detour is large. The minutes shown are still the real walking time. The itinerary reports the share of your walk in shade, in sun or along facades, and what the shortest ways would have given.
- **Changing weather.** If you choose to, the stops are reordered so that outdoor visits fall in the better hours, within your time. If the day is full, one indoor stop of little value may be left out to make room; the itinerary names it.
- **Dry window.** On a rainy day with a dry hour, outdoor places are kept back, and the app offers one that fits your vibe and can be visited in that hour.

### The map

- **Dark Bauhaus.** Buildings are drawn to their measured height and coloured by their main use. With a route, buildings within 30 m of it keep most of their colour and the rest fade; route landmarks glow red (Classic), blue (Modern) or yellow (Nature); every stop has a ring in its vibe colour.
- **Trees.** About a thousand schematic low-poly trees stand in the parks and cemeteries, on a jittered grid, off the paths and out of buildings.
- **Time-lapse.** Fiona's position comes from the route's times: between two stops she moves along the walked streets at an even pace; at a stop she stands still for its visit time. The observer camera stays locked on her at a 70° tilt and turns with her walking direction, smoothed so it does not jerk.

### Walk reach

The older tool, under **Walk reach**: click on the ground and the app walks along the network from the nearest junction. It draws the streets reached in 5, 10 and 15 minutes with a band of 25 m on each side, highlights the buildings that touch each area, lists buildings with shop floor area within 5 minutes, and estimates the residents from the 100 m cells of the Zensus 2022 (each cell's population times the share of the cell inside the area, rounded to 10; cells without a published figure are left out and counted).

## Limits

- **Places, prices and visit times are estimates.** The city kit has no named sights, so `public/data/places.json` was written by hand: 19 places, 8 stations and stops, approximate positions, estimated prices, visit times and vibe scores. Check them before relying on them. Opening hours are not included.
- **Only the kit area.** The network covers central Weimar west of and including the Markt. Most of Park an der Ilm is outside it, so only its west entrance is used; sights further out are missing.
- **Glowing buildings.** Only 6 landmarks are matched to their building (Goethe's house, City Palace, Bauhaus Museum, Bauhaus-Universität main building, National Theatre, Herder Church). The matches are likely but not checked on site; other stops are marked by their ring.
- **Shade is a model.** Shadows come from the building blocks only: no trees (parks stand in for them), no awnings or arcades, no weather. The sun is taken once per hour.
- **The trees are not real trees.** There is no tree data; they show where green space is, not where trees stand.
- **Weather.** The forecast reaches about 16 days ahead; beyond that the weather is not checked. Rain on the map follows the forecast hour by hour, not minute by minute.
- **Walking.** Everyone walks at the same even speed; slopes, steps, crossings and waiting at lights are ignored, and so are paths outside the network.
- **Fiona is about 14 m tall,** so she can be seen from above. She is drawn over the buildings, like a navigation arrow.
- **Walk reach:** the walk starts at the nearest junction, not the exact click; residents are spread evenly over each census cell, and the census changes small counts slightly at random, so the numbers are "about".

## Data

The city kit is in `public/data/`; see `public/data/SOURCES.md` for every file, field and unit. The only thing loaded from the internet is the weather forecast.

| File or service | Source | Licence |
| --- | --- | --- |
| `buildings.geojson` | footprints and heights: 3D building models LoD2 of Thuringia, © GDI-Th; uses: Egor Gaydukov | dl-de/by-2-0 |
| `plots.geojson` | land use per plot: Egor Gaydukov | |
| `streets.graph.json` | pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| `zensus.geojson` | Zensus 2022, 100 m grid, © Statistische Ämter des Bundes und der Länder | dl-de/by-2-0 |
| `places.json` | written by hand for this app; estimates | |
| Weather | [Open-Meteo](https://open-meteo.com/) forecast API | CC BY 4.0 |

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0). Weather data by Open-Meteo.com (CC BY 4.0).

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5.
2. I decided:
3. The agent did: read the city kit, then wrote the 3D map and the walk-reach tool; then, step by step from my briefs, the route planner and wizard, the hand-written places file, the weather features (forecast, questions, sun and shade, sheltered streets, dry window, reordering), the dark Bauhaus design, the time-lapse with Fiona and the two cameras, the trees and the route focus, and this README. It tested each step in a browser, on localhost and on the published site.
4. I checked:
