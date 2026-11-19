"""Step 1: raw Spotify export -> minimal public dataset.

This is the only script that reads the raw streaming history. The raw files
are kept on my own machine, outside this repo, and are never published.

Usage:
    python3 scripts/prepare_public_data.py /path/to/raw-folder Everything downstream
(the map, the year cards) is built from the two CSVs this script writes.

Inputs  (local only, not in the repo), both in the raw folder:
    Streaming_History_Audio_<YEAR>.json
        Spotify "Extended streaming history" with each play already resolved
        to local_city / local_country / geolite_accuracy_radius.
    location_rules.json  (see "Location cleanup" below)

Outputs (public):
    data/city_days.csv       where:  year, date, city, country, plays, ms_played
    data/tracks_by_year.csv  what:   year, track, artist, album, spotify_track_uri,
                                     plays, ms_played

What is deliberately thrown away:
    - every network/device field (IP-derived hostnames, ISP and network
      labels, platform/device strings, conn_country, VPN/offline flags)
    - exact timestamps: plays are bucketed to the local calendar day
    - the link between a song and a place: location and listening are
      written to two separate tables

Location cleanup (rules live in location_rules.json in the raw folder, not published):
    - geolocations with accuracy radius >= 500 km keep only their country
    - suburb/neighbourhood-level or mis-geolocated cities are folded into
      their metro city ("merge_into")
    - unreliable few-play artifacts are dropped to country level ("drop")
"""

import csv
import glob
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CITY_DAYS_PATH = os.path.join(ROOT, "data", "city_days.csv")
TRACKS_PATH = os.path.join(ROOT, "data", "tracks_by_year.csv")

RADIUS_COUNTRY_ONLY_KM = 500


def load_rules(rules_path):
    if not os.path.exists(rules_path):
        return {}, set()
    raw = json.load(open(rules_path, encoding="utf-8"))
    merge, drop = {}, set()
    for key, v in raw.items():
        if key.startswith("_"):
            continue
        if v.get("drop"):
            drop.add(key)
        elif v.get("merge_into"):
            merge[key] = v["merge_into"]
    return merge, drop


def clean_location(row, merge, drop):
    """Return (city, country) at the granularity we are willing to publish."""
    city = (row.get("local_city") or "").strip()
    country = (row.get("local_country") or "").strip()
    radius = row.get("geolite_accuracy_radius") or 0
    if not city or not country or radius >= RADIUS_COUNTRY_ONLY_KM:
        return "", country
    key = f"{city}|{country}"
    if key in drop:
        return "", country
    if key in merge:
        city, country = merge[key].split("|")
    return city, country


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: python3 scripts/prepare_public_data.py /path/to/raw-folder")
    raw_dir = os.path.abspath(os.path.expanduser(sys.argv[1]))
    rules_path = os.path.join(raw_dir, "location_rules.json")
    merge, drop = load_rules(rules_path)
    if not merge and not drop:
        print(f"  note: no location rules at {rules_path}; publishing cities as-is")
    paths = sorted(glob.glob(os.path.join(raw_dir, "Streaming_History_Audio_*.json")))
    if not paths:
        raise SystemExit(f"no Streaming_History_Audio_*.json files in {raw_dir}")

    where = Counter()    # (year, date, city, country) -> plays
    where_ms = Counter()
    what = Counter()     # (year, track, artist, album) -> plays
    what_ms = Counter()
    uri = {}             # first Spotify track URI seen for each track key

    for path in paths:
        year = int(re.search(r"(\d{4})\.json$", path).group(1))
        for r in json.load(open(path, encoding="utf-8")):
            ms = int(r.get("ms_played") or 0)
            day = (r.get("local_time") or r.get("ts") or "")[:10]
            if not day:
                continue
            city, country = clean_location(r, merge, drop)
            where[(year, day, city, country)] += 1
            where_ms[(year, day, city, country)] += ms

            track = (r.get("master_metadata_track_name") or "").strip()
            if track:
                k = (
                    year,
                    track,
                    (r.get("master_metadata_album_artist_name") or "").strip(),
                    (r.get("master_metadata_album_album_name") or "").strip(),
                )
                what[k] += 1
                what_ms[k] += ms
                uri.setdefault(k, r.get("spotify_track_uri") or "")
        print(f"  read {os.path.basename(path)}")

    with open(CITY_DAYS_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["year", "date", "city", "country", "plays", "ms_played"])
        for k in sorted(where):
            w.writerow([*k, where[k], where_ms[k]])

    with open(TRACKS_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["year", "track", "artist", "album", "spotify_track_uri", "plays", "ms_played"])
        for k in sorted(what, key=lambda k: (k[0], -what[k], k[1])):
            w.writerow([*k, uri[k], what[k], what_ms[k]])

    print(f"wrote {CITY_DAYS_PATH}  ({len(where):,} rows)")
    print(f"wrote {TRACKS_PATH}  ({len(what):,} rows)")


if __name__ == "__main__":
    main()
