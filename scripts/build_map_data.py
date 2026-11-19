"""Step 2a: data/city_days.csv -> web/map_data.json (the listening map).

Output: web/map_data.json with this shape:

    {
      "meta": { "first_day": "...", "last_day": "...", "total_plays": N, "residency_threshold_ms": M },
      "cities": [
        { "id": "New York|US", "name": "New York", "country": "US",
          "lat": 40.71, "lon": -74.01,
          "first_day": "2014-08-25", "last_day": "2022-12-31",
          "total_ms": 11663640000, "total_plays": 50180 }, ...
      ],
      "days": [
        { "day": "2014-01-18", "plays": [
            { "city_id": "Boston|US", "ms": 287430, "n": 11 } ] },
        ...
      ],
      "annotations": [ { "day": "...", "title": "...", "body": "..." }, ... ],
      "daily_total_ms": [ [ "2014-01-18", 287430 ], ... ]   // for the timeline area chart
    }

Country-only rows (blank city in city_days.csv) are not mapped, only counted.
Cities missing from data/city_coords.json are skipped and counted.
"""

import csv
import json
import os
from collections import defaultdict
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CITY_DAYS_PATH = os.path.join(ROOT, "data", "city_days.csv")
COORDS_PATH = os.path.join(ROOT, "data", "city_coords.json")
ANNOTATIONS_PATH = os.path.join(ROOT, "data", "annotations.json")
OUT_DIR = os.path.join(ROOT, "web")
OUT_PATH = os.path.join(OUT_DIR, "map_data.json")

# How much accumulated ms_played makes a circle fully inked. Tuned to feel right:
# the New York residency (~544 hours in 2014 alone) saturates; trip-circles stay pale.
RESIDENCY_THRESHOLD_MS = 1_500_000_000  # ~417 hours

def load_coords():
    raw = json.load(open(COORDS_PATH, encoding="utf-8"))
    return {k: (v["lat"], v["lon"]) for k, v in raw.items()
            if not k.startswith("_") and "lat" in v}

def main():
    coords = load_coords()
    annotations = json.load(open(ANNOTATIONS_PATH, encoding="utf-8"))

    # day -> city_id -> {ms, n}
    daily = defaultdict(lambda: defaultdict(lambda: {"ms": 0, "n": 0}))
    # city_id -> { country, total_ms, total_plays, first_day, last_day }
    city_stats = {}
    daily_total_ms = defaultdict(int)
    dropped_country_only = 0
    dropped_no_coord = 0
    dropped_explicit = 0
    total_plays = 0

    with open(CITY_DAYS_PATH, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            city, country = r["city"], r["country"]
            n = int(r["plays"])
            if not city:
                dropped_country_only += n
                continue
            cid = f"{city}|{country}"
            if cid not in coords:
                dropped_explicit += n
                continue

            ms = int(r["ms_played"])
            day = r["date"]
            daily[day][cid]["ms"] += ms
            daily[day][cid]["n"] += n
            daily_total_ms[day] += ms
            total_plays += n

            stat = city_stats.get(cid)
            if stat is None:
                lat, lon = coords[cid]
                city_stats[cid] = {
                    "name": city,
                    "country": country,
                    "lat": lat,
                    "lon": lon,
                    "total_ms": ms,
                    "total_plays": n,
                    "first_day": day,
                    "last_day": day,
                }
            else:
                stat["total_ms"] += ms
                stat["total_plays"] += n
                if day < stat["first_day"]:
                    stat["first_day"] = day
                if day > stat["last_day"]:
                    stat["last_day"] = day

    # Build the day list as a sorted dense array — every calendar day from first to last.
    if not daily:
        raise SystemExit("no rows")
    all_days = sorted(daily.keys())
    first_day = all_days[0]
    last_day = all_days[-1]

    # Dense day list (one entry per calendar day, even days with no plays — empty plays list).
    # This makes the frontend animation a simple index walk.
    def daterange(start_iso, end_iso):
        y, m, d = map(int, start_iso.split("-"))
        cur = date(y, m, d)
        y, m, d = map(int, end_iso.split("-"))
        end = date(y, m, d)
        from datetime import timedelta
        while cur <= end:
            yield cur.isoformat()
            cur += timedelta(days=1)

    days_out = []
    daily_total_out = []
    for d in daterange(first_day, last_day):
        plays = []
        for cid, agg in daily.get(d, {}).items():
            plays.append({"city_id": cid, "ms": agg["ms"], "n": agg["n"]})
        plays.sort(key=lambda x: -x["ms"])
        days_out.append({"day": d, "plays": plays})
        daily_total_out.append([d, daily_total_ms.get(d, 0)])

    cities_out = []
    for cid, stat in city_stats.items():
        cities_out.append({
            "id": cid,
            "name": stat["name"],
            "country": stat["country"],
            "lat": stat["lat"],
            "lon": stat["lon"],
            "first_day": stat["first_day"],
            "last_day": stat["last_day"],
            "total_ms": stat["total_ms"],
            "total_plays": stat["total_plays"],
        })
    cities_out.sort(key=lambda c: -c["total_ms"])

    out = {
        "meta": {
            "first_day": first_day,
            "last_day": last_day,
            "total_plays": total_plays,
            "residency_threshold_ms": RESIDENCY_THRESHOLD_MS,
            "dropped_country_only": dropped_country_only,
            "dropped_no_coord": dropped_explicit,
        },
        "cities": cities_out,
        "days": days_out,
        "daily_total_ms": daily_total_out,
        "annotations": annotations,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"wrote {OUT_PATH}  ({size_kb:.1f} KB)")
    print(f"  span:    {first_day} -> {last_day}  ({len(days_out)} calendar days)")
    print(f"  plays:   {total_plays:,}")
    print(f"  cities:  {len(cities_out)}")
    print(f"  country-only (not mapped): {dropped_country_only}")
    print(f"  no coords (skipped): {dropped_explicit}")

if __name__ == "__main__":
    main()
