# Where I Was Listening

A day-by-day map of where I listened to music over nine years (2014–2022), drawn from my Spotify listening history.

**▶ [View it live](https://mango-jackson-gen1.github.io/where-i-was-listening/web/)**

Press play and the map fills in, one day at a time. Each city is a hand-drawn circle that inks in darker the longer I stayed. A four-month stay in Boston goes deep, while a two-day trip stays a faint dot. Story callouts surface as the timeline crosses them. Below the map, a card for each year shows its top tracks, artists, albums, places and country mix, plus a strip of how my favourite artists rose and fell over the nine years.

Visual lineage: Stefanie Posavec's *People Like You* and *Insights in Ink*. It should read like a notebook page, not a dashboard. The full design spec is in [DESIGN.md](DESIGN.md).

## How it's made

```
(local)    raw Spotify export ─┐   (kept on my machine, never in this repo)
                               │ 1. scripts/prepare_public_data.py
data/      city_days.csv  ◄────┤    strip network/device fields, bucket to the day,
           tracks_by_year.csv ◄┘    fold suburbs into cities, separate "where" from "what"
           city_coords.json · annotations.json · year_headlines.json   (hand-written)
                               │ 2. scripts/build_map_data.py · scripts/build_year_data.py
web/       map_data.json · year_data.json  →  index.html (D3 + rough.js)
```

1. **Prepare.** The only step that touches raw data, and it runs on my machine. It reduces the export to two small tables: where I listened (day × city) and what I listened to (year × track). No row links a song to a place.
2. **Edit.** The storytelling is hand-written: the map callouts in `data/annotations.json`, one paragraph per year in `data/year_headlines.json`, and city positions in `data/city_coords.json`.
3. **Build.** Two standard-library Python scripts turn the tables and editorial files into the JSON the page loads.
4. **Draw.** `web/` is a static page. It uses D3 (Equal Earth projection, timeline), rough.js for the hand-drawn circles and coastline, and a Natural Earth land outline.

Steps 2–4 run entirely from this repo. Change a callout, then rebuild:

```bash
python3 scripts/build_map_data.py      # data/ → web/map_data.json
python3 scripts/build_year_data.py     # data/ → web/year_data.json
python3 -m http.server 8000            # open http://localhost:8000/web/
```

## Repository layout

```
web/        the page: index.html, main.js, style.css + built map_data.json, year_data.json
data/       public data and editorial inputs (column-by-column in data/README.md)
scripts/    prepare → build pipeline
DESIGN.md   design spec
```

## Data and privacy

Only aggregated, city-level data is published. The raw export, and every IP, ISP, network or device field in it, stays off GitHub. [data/README.md](data/README.md) lists exactly what was kept and what was removed.
