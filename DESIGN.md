# Where I Was Listening — A Nine-Year Map of Place

A web-based, day-by-day map visualization of where listening happened from 2014 to 2022. The map fills in as time advances: cities you returned to many times grow darker; cities you only passed through stay pale. By the end of the playback, the user can read the *shape* of nine years — the long stays, the trips, the years that pivoted across the world.

> **Visual lineage.** This piece sits in the tradition of Stefanie Posavec's [*People Like You*](https://www.stefanieposavec.com/projects/people-like-you) and [*Insights in Ink*](https://www.stefanieposavec.com/projects/insights-in-ink): hand-drawn warmth, paper-like grounds, organic marks, and labels that feel written rather than rendered. Data here is autobiographical, so the visual language should feel like a journal entry, not a dashboard.

---

## 1. Goal

Let a viewer **feel** how the map fills up over nine years. Specific aims:

1. **Time-as-experience.** A scrubbable / autoplay timeline that steps through every day from `2014-01-18` through `2022-12-31`. The viewer should sense the *rhythm* — months of stillness in one city, then a sudden constellation of trip-circles.
2. **Time-as-density.** Each city is a circle on the map. The more `ms_played` accumulated at that city, the **darker** (more saturated, less transparent) it gets. A 4-month Boston stay should ink in deeply; a 4-row Istanbul layover should stay a faint dot.
3. **Surface city-level insight.** As the playback advances, callouts surface key moments: "Boston stay begins," "NYU Shanghai summer," "Tulum trip," "stuck in Shanghai through 2020 lockdown." These are hand-written in `annotations.json`.
4. **Read the year shape, not just the data.** By the end, the viewer can look at the map and tell that 2014 had three chapters, 2018 was full of small bright pinpricks (lots of trips), 2020 was an overwhelming dark blot over Shanghai.

---

## 2. Data

Source: my Spotify *Extended streaming history*, 2014–2022, with each play resolved to a local city/country and editorially corrected. The raw files are personal and are kept outside the repo, on my own machine. They are reduced once, by `scripts/prepare_public_data.py`, to two small public tables. Everything the page shows is built from those tables. See [data/README.md](data/README.md).

### Public data fields

`data/city_days.csv`: one row per (local day, city):

| field | use |
|---|---|
| `date` | day-bucket key (`YYYY-MM-DD`, local calendar day) |
| `city`, `country` | the unit of aggregation (a "circle"); blank city = country-level only, not mapped |
| `plays`, `ms_played` | accumulators that drive circle darkness |

`data/tracks_by_year.csv` (year × track) feeds the per-year cards. It carries no location at all.

### Build (`scripts/build_map_data.py`)

The browser loads only the small built `web/map_data.json`:

```jsonc
{
  "days": {
    "2014-01-18": [
      { "city": "Boston",   "country": "US", "lat": 42.36, "lon": -71.06, "ms": 287430, "plays": 11 },
      …
    ],
    "2014-01-19": [ … ],
    …
  },
  "cities": {
    "Boston|US":   { "lat": 42.36, "lon": -71.06, "total_ms": 1046160000, "first_day": "2014-01-18", "last_day": "2014-05-25" },
    "New York|US": { … },
    …
  },
  "annotations": [
    { "day": "2014-01-18", "title": "Boston stay begins",        "body": "4-month residency." },
    { "day": "2014-06-01", "title": "NYU Shanghai summer",       "body": "The map widens by half a world." },
    { "day": "2020-05-07", "title": "Stuck in Shanghai",         "body": "Shanghai inks in through year-end." },
    …
  ]
}
```

City lat/lon comes from the hand-curated centroid table `data/city_coords.json` (59 cities). Before publishing, suburbs were folded into their metro city and unreliable few-play geolocations reduced to country level (the rule list itself stays private). Country-only plays are left off the map but counted in `meta`.

Annotations are **manually authored once** in `data/annotations.json`. The build script just merges them with the day index.

---

## 3. Visual specification

### 3.1 The map

- **Projection.** Natural Earth or Equal Earth. The viewer should see the whole globe at once — the *shape of the year* is the headline, and that shape lives across continents (Boston ↔ Shanghai ↔ Paris ↔ Tulum). No interactive pan/zoom on first load; a single, calm world view.
- **Base map style.** No tiles. A single drawn coastline path on a warm off-white ground (think `#F4EEE3`, the colour of aged paper). Coastlines are a thin, slightly broken line — not crisp vector, more like a fine-tip pen. No country borders, no labels, no graticule. The map is a *ground*, not the subject.
- **No basemap interactivity.** Hover and click are reserved for the city circles.

### 3.2 The circles (the subject)

Each city is one circle, positioned at its lat/lon.

- **Radius.** Fixed-ish, lightly varied by hand to feel drawn. Three size buckets: trip (≤ 1 hr), stay (1–24 hr), residency (24+ hr). Maximum diameter is small — about 1.5° of the visible map. Density, not size, is the encoding.
- **Darkness.** This is the headline encoding. Opacity = `min(1, total_ms_so_far / RESIDENCY_THRESHOLD)`. Circles start at ~8% opacity on first appearance and saturate toward fully inked over weeks of presence. **A circle never fades.** Once a place has been visited it stays on the map for the rest of the run.
- **Stroke.** A slightly wobbly hand-drawn circle outline, drawn once per city when the city first appears, in a darker variant of the fill. Roughness implemented with [rough.js](https://roughjs.com/) so circles feel sketched, not vector-perfect.
- **Colour.** A single warm ink colour (`#3A2E27`, a dark sepia) for everything. **No categorical colour by country or year** — the viewer's eye should track *density*, not hue. (One possible exception: a faint warm-orange tint for the *currently-active* day's plays, dissolving back to sepia within a few seconds. Decide during build.)

### 3.3 Time controls

A horizontal timeline strip across the bottom, ~80 px tall.

- **Spine.** A single horizontal line spanning the full year range with year tick marks `2014 … 2022`, hand-lettered. Behind the spine, a faint area chart of "plays per day" — the amplitude of listening over time, drawn as a soft fill so it reads as texture, not a chart.
- **Playhead.** A vertical line + a hand-drawn date label that floats above it (e.g., `Mar 12, 2014`). Drag to scrub.
- **Play / pause.** A single circular button to the left of the spine. Default speed: ~1 second of real time = ~7 days of listening (so the full nine years takes ~7 minutes). Speed slider: 1×, 2×, 4×, 8×.
- **Day step buttons.** `←` and `→` step one day at a time, for slow inspection.

### 3.4 The annotation layer

When the playhead crosses an annotated day:

- A small hand-drawn arrow extends from the relevant city circle to a margin where a short, hand-lettered note appears: `Boston stay begins · Jan 18, 2014`. The note lingers ~6 seconds, then fades.
- Annotations stack in a right-margin scroll-list as the playback proceeds, so the viewer at any moment can scroll back through everything that has been called out so far. This list also doubles as a navigation tool — clicking a past annotation jumps the playhead to that day.

### 3.5 The city panel (right side)

A small panel listing every city the playhead has touched so far, ranked by accumulated hours. The list grows over time. Each row:

```
  ●  New York      544.6 hrs   ████████████████░░░  (mini bar)
  ●  Shanghai      372.4 hrs   ████████████░░░░░░░
  ●  Boston        290.6 hrs   █████████░░░░░░░░░░
  …
```

The bullet `●` echoes the circle's current darkness. The list re-sorts as totals shift. Hovering a row highlights the corresponding circle on the map.

### 3.6 Typography

- **Body / labels.** A handwriting-style typeface — [Caveat](https://fonts.google.com/specimen/Caveat) or [Shadows Into Light](https://fonts.google.com/specimen/Shadows+Into+Light), regular weight. Used sparingly: city names on hover, annotation titles, year ticks.
- **Numbers.** Tabular figures, in the same handwriting font where possible, otherwise a quiet sans like Inter. Numbers should *never* dominate.
- **Title.** Top-left, hand-lettered, e.g., `where I was listening · 2014–2022`. Small. Gives the piece a frame, like the corner of a page.

### 3.7 Palette

| swatch | hex | use |
|---|---|---|
| paper | `#F4EEE3` | background |
| ink | `#3A2E27` | circles, text, coastline |
| ink-faint | `#3A2E2722` | first-appearance fill |
| ink-mid | `#3A2E2788` | mid-density fill |
| accent (optional) | `#C26A3F` | currently-playing pulse, only if it doesn't fight the gestalt |

Single-ink palette by default. Resist the urge to colour-by-country.

### 3.8 Interaction summary

| viewer does | system does |
|---|---|
| loads page | timeline rests at `2014-01-18`, map empty, ready to play |
| presses play | days advance, circles ink in, annotations surface |
| hovers a circle | small label appears: `New York · 544.6 hrs over 4 years` |
| hovers a city in the right panel | corresponding circle gains a highlight ring |
| clicks a past annotation | playhead jumps to that day; map state recomputes |
| drags the playhead | map recomputes from `t=0` to playhead in one frame |

### 3.9 Behaviour on scrub

The accumulator is *cumulative from `t=0`*. Scrubbing backwards rewinds the totals — a circle's darkness at any moment reflects only ms played up to and including the current day. Implementation note: precompute a per-city cumulative `ms` time-series on load, indexed by day, so scrubbing is a single lookup, not a re-summation.

---

## 4. Tech stack

Kept deliberately light — a single static page, no build pipeline beyond the data prep.

- **Map rendering.** D3 v7, with `d3-geo` (Equal Earth projection) and `d3-geo` `geoPath` against a small Natural Earth land-only TopoJSON (~80 KB). No Mapbox / Leaflet — they impose tiles and a base-map look we don't want.
- **Sketchy strokes.** [rough.js](https://roughjs.com/) over Canvas (or SVG; benchmark which feels smoother for ~30 circles + a coastline). Circles can also be drawn with rough.js, parameterized to look hand-drawn but stable across redraws by seeding with the city name.
- **Timeline area chart.** D3 area generator on the daily plays array, rendered into the timeline `<svg>`.
- **Animation.** `requestAnimationFrame` driving a single `currentDay` integer index. Day-step the index, then in one render pass: re-tint each city circle to its precomputed cumulative-ms-as-of-`currentDay`, advance the playhead, surface any annotations whose `day === currentDay`.
- **Build script.** `scripts/build_map_data.py` (Python, stdlib only) reads `data/city_days.csv`, joins to `data/city_coords.json`, and emits `web/map_data.json`. Run once locally, commit the output. The browser only loads `map_data.json`, never the raw streaming history.
- **Hosting.** Pure static. Open `index.html` directly or serve via `python -m http.server 8000`.

### File layout

See the repository layout in the top-level [README](README.md).

---

## 5. What "done" looks like

A single page that, when opened, shows a paper-coloured world map with one small dark circle over Boston and a date that reads `Jan 18, 2014`. Pressing play, the viewer watches Boston deepen for four months, then a constellation in eastern China light up, then NYC, then a quiet pinprick over Macau, Istanbul, the Caribbean — all the way through to a saturated blot over Shanghai in 2020 and a final return to NYC in late 2022. By the end, the map is a portrait of nine years, and the right-panel list reads like a quiet itinerary.

It should not look like a dashboard. It should look like a page from a notebook.

---

## 6. Out of scope (for v1)

- Track / artist data. This is location-only.
- Tooltip on individual plays. The unit is the city-day, not the song.
- Country-level choropleth. The encoding is per-city circles.
- Mobile-first layout. Works on desktop; phone is a stretch goal.
- Pan / zoom. The whole-globe view is the framing, not a starting point.

---

## 7. Open questions before building

Flagged here because they shape the build:

1. **Annotation source.** Should annotations be authored by hand (curated, ~3–5 per year, lyrical) or auto-derived from per-year summaries (more comprehensive, drier)? Recommendation: author by hand — tone matters for a Posavec-flavoured piece.
2. **`RESIDENCY_THRESHOLD`.** What total `ms_played` makes a circle fully inked? A natural choice: the median residency (NYU NYC at ~544 hrs / ~2 billion ms), so the largest circles saturate by mid-2014, and the trip-circles never reach full ink. Tune visually after first build.
3. **Single-ink vs. faint era-tint.** Pure single-ink is purer Posavec; a *very* faint warm tint shifting from cream-ink (2014) to deeper sepia (2022) could let the viewer feel time accumulating in colour space, not just opacity space. Decide after seeing the first render.
4. **Country-only rows** (~50–100 plays per year, radius ≥ 500 km). Drop entirely, or place at country centroid with a distinctive faint marker so they're not invisible? Default: drop, count in a footnote.
