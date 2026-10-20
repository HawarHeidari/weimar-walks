# How far can you walk? Central Weimar

A 3D map of central Weimar showing how far you can walk in 5, 10 and 15 minutes from any point, and roughly how many people live in each of those areas.

Buildings are drawn to their measured height and coloured by their main use; the legend names each colour. Click on the ground and the app walks along the pedestrian network from there. It draws three nested areas in three shades of one colour, highlights the buildings that touch each area in the same shade, and shows in a panel how many buildings each area reaches and about how many residents live in it. Drag to orbit, right-drag to pan, and scroll to zoom.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

`npm run build` makes the site in `dist/`. Every push to `main` publishes it at `https://<user>.github.io/<repo>/` through `.github/workflows/deploy.yml`.

## Method

- **Start.** The walk starts at the node of the pedestrian network (`streets.graph.json`) nearest to the click. If you click on a building, the walk starts from that spot on the building. If no walkable street is within 100 m of the click, the app says so and doesn't walk.
- **Walking.** You walk at 4.8 km/h, which is 80 m a minute, so you cover 400 m in 5 minutes, 800 m in 10 and 1,200 m in 15. Distances along the network use each edge's `length` in metres, and every edge can be walked in both directions. The app finds the shortest walk to every junction.
- **The areas.** Each area is the streets you reach in that time, including the part of the last street you get into before the time runs out. It has a band of 25 m on each side and round ends, and everything is joined into one shape. It isn't a circle or a convex hull.
- **Buildings.** A building counts for an area when its footprint touches the area, which means it lies within 25 m of a reached street. A building gets the shade of the smallest area it touches. The count for 10 minutes includes the buildings of the 5-minute area, and so on.
- **Shops within 5 minutes.** The panel lists the buildings in the 5-minute area that have any shop floor area (`retail` in `floor_area_m2`), nearest first, and marks them on the map with a dot. The walking time is the shortest walk to a point on a street that passes within 25 m of the building. Click an entry to show it with a tall pin.
- **Residents.** The residents come from the 100 m cells of the Zensus 2022. For each cell that overlaps the area, its population is multiplied by the share of the cell's area that lies inside. These are added up and rounded to the nearest 10.
- **Cells without a figure.** Some cells have no published resident count (`population` is `null`). They are not counted as zero: they are left out of the sum, and the panel shows how many of them overlap the area.

## Limits

- The walk starts at the nearest junction or dead end, not at the exact point you clicked. The way from the click to that node is not counted.
- Everyone walks at the same speed. Slopes, steps, crossings, waiting at lights and opening hours are ignored, and so are paths outside the kit's network.
- The 25 m band is a convention for "close to the street". It doesn't mean that every building inside the band has an entrance on that street.
- Residents are spread evenly over each 100 m cell, so the counts are estimates. The census also changes small counts slightly at random to protect privacy. Treat the numbers as "about", which is why they are rounded to 10.
- Near the edge of the kit the network stops, so areas there are cut short.
- The data has no individual shops: no names, kinds of shop or opening hours. The list shows buildings with estimated shop floor area, so one entry can be several shops, and a shop counted as `food_and_drink` (a café, say) is not in the list.
- The one building without any use is shown as "use unknown".

## Data

All data is in `public/data/`; see `public/data/SOURCES.md` for every file, field and unit. The app loads nothing from the internet.

| File | Source | Licence |
| --- | --- | --- |
| `buildings.geojson` | footprints and heights: 3D building models LoD2 of Thuringia, © GDI-Th; uses: Egor Gaydukov | dl-de/by-2-0 |
| `streets.graph.json` | pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| `zensus.geojson` | Zensus 2022, 100 m grid, © Statistische Ämter des Bundes und der Länder | dl-de/by-2-0 |

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5.
2. I decided:
3. The agent did: read the city kit, then wrote the 3D map, the walking and resident calculation, and this README, and tested them in a headless browser, both on localhost and under a GitHub Pages sub-path.
4. I checked:
