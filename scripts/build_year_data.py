"""Step 2b: data/city_days.csv + data/tracks_by_year.csv -> web/year_data.json
(the per-year cards under the map).

Output: web/year_data.json with this shape:

    {
      "years": [
        {
          "year": 2014,
          "plays": N, "hours": float, "active_days": N,
          "distinct_artists": N, "distinct_tracks": N,
          "headline": "...",          # one-paragraph story (from year_headlines.json)
          "top_tracks":   [{name, artist, plays, ms}, ...],     # top 8
          "top_artists":  [{name, plays, ms}, ...],             # top 8
          "top_albums":   [{name, artist, plays, ms}, ...],     # top 8
          "top_locations":[{city, country, hours, plays}, ...], # top 6
          "countries":    [{code, plays, hours, share}, ...]    # top 5
        }, ...
      ],
      "longitudinal": {
        "artists": [
          { "name": "...", "total_plays": N, "per_year": [N,N,N,N,N,N,N,N,N],
            "peak_year": YYYY, "first_year": YYYY }, ...
        ],
        "tracks": [
          { "name": "...", "artist": "...", "total_plays": N,
            "per_year": [N,N,N,N,N,N,N,N,N] }, ...
        ],
        "years": [2014, 2015, ..., 2022]
      }
    }
"""

import csv
import io
import json
import os
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CITY_DAYS_PATH = os.path.join(ROOT, "data", "city_days.csv")
TRACKS_PATH = os.path.join(ROOT, "data", "tracks_by_year.csv")
HEADLINES_PATH = os.path.join(ROOT, "data", "year_headlines.json")
OUT_PATH = os.path.join(ROOT, "web", "year_data.json")

YEARS = list(range(2014, 2023))


def load_by_year(path):
    out = defaultdict(list)
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            r["plays"] = int(r["plays"])
            r["ms_played"] = int(r["ms_played"])
            out[int(r["year"])].append(r)
    return out


def headline_for_year(year):
    """Hand-written one-paragraph story for the year, from year_headlines.json."""
    if not os.path.exists(HEADLINES_PATH):
        return ""
    with io.open(HEADLINES_PATH, encoding="utf-8") as f:
        return json.load(f).get(str(year), "")


def country_label(code):
    return code or "??"


def aggregate_year(year, where, what):
    n = sum(r["plays"] for r in where)
    total_ms = sum(r["ms_played"] for r in where)
    days_active = {r["date"] for r in where}
    art_plays = Counter()
    art_ms = Counter()
    track_plays = Counter()
    track_ms = Counter()
    track_artist = {}
    alb_plays = Counter()
    alb_ms = Counter()
    alb_artist = {}
    loc_plays = Counter()
    loc_ms = Counter()
    country_plays = Counter()
    country_ms = Counter()

    for r in where:
        if r["city"] and r["country"]:
            lk = (r["city"], r["country"])
            loc_plays[lk] += r["plays"]
            loc_ms[lk] += r["ms_played"]
        if r["country"]:
            country_plays[r["country"]] += r["plays"]
            country_ms[r["country"]] += r["ms_played"]

    for r in what:
        k, ms = r["plays"], r["ms_played"]
        artist, track, album = r["artist"], r["track"], r["album"]
        if artist:
            art_plays[artist] += k
            art_ms[artist] += ms
        tk = (track, artist)
        track_plays[tk] += k
        track_ms[tk] += ms
        track_artist[tk] = artist
        if album:
            ak = (album, artist)
            alb_plays[ak] += k
            alb_ms[ak] += ms
            alb_artist[ak] = artist
    distinct_artists = set(art_plays)
    distinct_tracks = set(track_plays)

    top_artists = [
        {"name": a, "plays": art_plays[a], "ms": art_ms[a]}
        for a, _ in art_plays.most_common(8)
    ]
    top_tracks = [
        {"name": t[0], "artist": track_artist[t], "plays": track_plays[t], "ms": track_ms[t]}
        for t, _ in track_plays.most_common(8)
    ]
    top_albums = [
        {"name": al[0], "artist": alb_artist[al], "plays": alb_plays[al], "ms": alb_ms[al]}
        for al, _ in alb_plays.most_common(8)
    ]
    top_locations = [
        {
            "city": loc[0],
            "country": loc[1],
            "plays": loc_plays[loc],
            "hours": round(loc_ms[loc] / 3_600_000, 1),
        }
        for loc, _ in loc_plays.most_common(6)
    ]
    countries = [
        {
            "code": c,
            "plays": country_plays[c],
            "hours": round(country_ms[c] / 3_600_000, 1),
            "share": round(country_plays[c] / max(n, 1) * 100, 1),
        }
        for c, _ in country_plays.most_common(5)
    ]

    return {
        "year": year,
        "plays": n,
        "hours": round(total_ms / 3_600_000, 1),
        "active_days": len(days_active),
        "distinct_artists": len(distinct_artists),
        "distinct_tracks": len(distinct_tracks),
        "headline": headline_for_year(year),
        "top_tracks": top_tracks,
        "top_artists": top_artists,
        "top_albums": top_albums,
        "top_locations": top_locations,
        "countries": countries,
        "_artists_full": art_plays,    # internal — for longitudinal
        "_tracks_full": track_plays,   # internal — for longitudinal
        "_track_artist": track_artist,
    }


def build_longitudinal(years_data):
    # artist totals across years
    grand_artist = Counter()
    per_year_artist = []
    for yd in years_data:
        per_year_artist.append(yd["_artists_full"])
        grand_artist.update(yd["_artists_full"])

    artists_top = [a for a, _ in grand_artist.most_common(12)]
    artists_long = []
    years = [yd["year"] for yd in years_data]
    for a in artists_top:
        per_year = [per_year_artist[i].get(a, 0) for i in range(len(years_data))]
        peak_idx = max(range(len(per_year)), key=lambda i: per_year[i])
        first_idx = next(i for i, v in enumerate(per_year) if v > 0)
        artists_long.append({
            "name": a,
            "total_plays": grand_artist[a],
            "per_year": per_year,
            "peak_year": years[peak_idx],
            "first_year": years[first_idx],
        })

    # track totals across years
    grand_track = Counter()
    per_year_track = []
    track_artists = {}
    for yd in years_data:
        per_year_track.append(yd["_tracks_full"])
        grand_track.update(yd["_tracks_full"])
        track_artists.update(yd["_track_artist"])

    tracks_top = [t for t, _ in grand_track.most_common(10)]
    tracks_long = []
    for t in tracks_top:
        per_year = [per_year_track[i].get(t, 0) for i in range(len(years_data))]
        tracks_long.append({
            "name": t[0],
            "artist": track_artists.get(t, ""),
            "total_plays": grand_track[t],
            "per_year": per_year,
        })

    return {
        "years": years,
        "artists": artists_long,
        "tracks": tracks_long,
    }


def main():
    where = load_by_year(CITY_DAYS_PATH)
    what = load_by_year(TRACKS_PATH)
    years_data = []
    for y in YEARS:
        years_data.append(aggregate_year(y, where[y], what[y]))
        print(f"  {y}: {years_data[-1]['plays']} plays")

    longitudinal = build_longitudinal(years_data)

    # strip internal keys
    for yd in years_data:
        for k in ("_artists_full", "_tracks_full", "_track_artist"):
            yd.pop(k, None)

    out = {"years": years_data, "longitudinal": longitudinal}
    with io.open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
