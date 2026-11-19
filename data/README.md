# Data

Everything in this folder is public and is enough to rebuild every page in the repo. The raw Spotify export it was derived from is **not** in this repo at all. It stays on my own machine.

## Pipeline

```
<raw folder, outside the repo>/Streaming_History_Audio_*.json
        │  scripts/prepare_public_data.py <raw folder>   ← only script that touches raw data
        ▼
data/city_days.csv  +  data/tracks_by_year.csv
        │  scripts/build_map_data.py, scripts/build_year_data.py
        ▼
web/map_data.json  +  web/year_data.json  →  web/index.html
```

## Tables (generated)

### `city_days.csv`: *where* I listened, one row per local day × city

| column | meaning |
|---|---|
| `year` | year of the export file |
| `date` | local calendar day, `YYYY-MM-DD` |
| `city` | city name; **blank** = only the country is known (not drawn on the map) |
| `country` | ISO-3166 alpha-2 code |
| `plays` | number of plays that day in that city |
| `ms_played` | total milliseconds played |

### `tracks_by_year.csv`: *what* I listened to, one row per year × track

| column | meaning |
|---|---|
| `year` | year |
| `track`, `artist`, `album` | Spotify metadata |
| `spotify_track_uri` | public Spotify catalog ID (first one seen) |
| `plays`, `ms_played` | totals for that year |

The two tables are kept separate on purpose: no row links a song to a place or a time of day.

## Editorial inputs (hand-written)

| file | used by | what |
|---|---|---|
| `city_coords.json` | map build | centroids for the 59 cities drawn on the map |
| `annotations.json` | map build | dated story callouts shown on the map |
| `year_headlines.json` | year build | one-paragraph story per year |

## What was removed before publishing

- Every network and device field from the raw export: IP-derived hostnames, ISP and network labels, VPN flags, device/platform strings, and connection country.
- Exact timestamps. Plays are bucketed to the day.
- Locations finer than a city (neighbourhoods and suburbs are folded into their metro city), plus geolocation artifacts that never reflected a real place.
