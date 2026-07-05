#!/usr/bin/env python3
"""Geocode museum addresses -> data/museums.json (final app dataset).

US addresses go through the Census batch geocoder (free, no key).
Failures and non-US addresses fall back to Nominatim (1 req/sec, free).
Results are cached in data/geocode_cache.json so reruns are cheap.
"""

import csv
import io
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "museums_raw.json"
CACHE = ROOT / "data" / "geocode_cache.json"
OUT = ROOT / "data" / "museums.json"

CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
UA = "astc-passport-map/1.0 (+https://github.com/jasonherngwang/astc-passport-map)"

COUNTRY_NAMES = {
    "US": "USA", "CANADA": "Canada", "AUSTRALIA": "Australia",
    "BERMUDA": "Bermuda", "CZECH REPUBLIC": "Czech Republic",
    "ISRAEL": "Israel", "MALAYSIA": "Malaysia", "PHILIPPINES": "Philippines",
    "SINGAPORE": "Singapore",
}


def split_us_address(addr: str):
    """'1300 S Lake Shore Dr, Chicago, IL 60605' -> (street, city, state, zip)"""
    m = re.match(r"^(?P<street>.+?),\s*(?P<city>[^,]+?),\s*(?P<state>[A-Z]{2})[, ]+(?P<zip>[\d\-]+)?\s*$", addr)
    if not m:
        return None
    return m.group("street"), m.group("city"), m.group("state"), m.group("zip") or ""


def census_batch(rows):
    """rows: list of (id, street, city, state, zip). Returns {id: (lat, lon)}."""
    buf = io.StringIO()
    w = csv.writer(buf)
    for r in rows:
        w.writerow(r)
    body_file = buf.getvalue().encode()

    boundary = "----astcboundary"
    parts = []
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"benchmark\"\r\n\r\nPublic_AR_Current\r\n")
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"addressFile\"; filename=\"addresses.csv\"\r\n"
        "Content-Type: text/csv\r\n\r\n"
    )
    body = "".join(parts).encode() + body_file + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        CENSUS_URL, data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        text = resp.read().decode()
    out = {}
    for row in csv.reader(io.StringIO(text)):
        # id, input addr, match?, exact/non-exact, matched addr, "lon,lat", tigerline, side
        if len(row) >= 6 and row[2] == "Match":
            lon, lat = row[5].split(",")
            out[row[0]] = (float(lat), float(lon))
    return out


def nominatim(query: str):
    params = urllib.parse.urlencode({"q": query, "format": "json", "limit": 1})
    req = urllib.request.Request(f"{NOMINATIM_URL}?{params}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        results = json.load(resp)
    time.sleep(1.1)  # Nominatim usage policy: max 1 req/sec
    if results:
        return float(results[0]["lat"]), float(results[0]["lon"])
    return None


def main():
    museums = json.loads(RAW.read_text())
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}

    def key(m):
        return m["address"]

    # 1) US addresses not in cache -> Census batch
    todo_census = []
    for i, m in enumerate(museums):
        if key(m) in cache:
            continue
        if m["country"] == "US":
            parts = split_us_address(m["address"])
            if parts:
                todo_census.append((str(i), *parts))
    if todo_census:
        print(f"census batch: {len(todo_census)} addresses")
        matched = census_batch(todo_census)
        print(f"  matched: {len(matched)}")
        for i_str, latlon in matched.items():
            cache[key(museums[int(i_str)])] = latlon
        CACHE.write_text(json.dumps(cache, indent=0))

    # 2) everything still missing -> Nominatim (full address, then name+city fallback)
    for m in museums:
        if key(m) in cache:
            continue
        country = COUNTRY_NAMES.get(m["country"], m["country"] or "")
        queries = [f'{m["address"]}, {country}']
        # fallback: museum name + last two address components
        tail = ", ".join(m["address"].split(",")[-2:]).strip()
        queries.append(f'{m["name"]}, {tail}, {country}')
        queries.append(f'{m["name"]}, {country}')
        result = None
        for q in queries:
            print(f"nominatim: {q}")
            result = nominatim(q)
            if result:
                break
        if result:
            cache[key(m)] = result
            CACHE.write_text(json.dumps(cache, indent=0))
        else:
            print(f"  FAILED: {m['name']} | {m['address']}")

    # 3) write final dataset
    final = []
    missing = []
    for i, m in enumerate(museums):
        latlon = cache.get(key(m))
        if not latlon:
            missing.append(m["name"])
            continue
        final.append({
            "id": i,
            "name": m["name"],
            "address": m["address"],
            "phone": m["phone"],
            "email": m["email"],
            "url": m["url"],
            "region": m["region"],
            "state": m["state"],
            "country": m["country"],
            "individualTiers": m["individual_tiers"],
            "groupTiers": m["group_tiers"],
            "proofOfResidence": m["proof_of_residence"],
            "lat": round(latlon[0], 5),
            "lon": round(latlon[1], 5),
        })
    OUT.write_text(json.dumps(final, indent=0, ensure_ascii=False))
    print(f"\nwrote {len(final)}/{len(museums)} museums to {OUT}")
    if missing:
        print("missing coordinates:", missing)


if __name__ == "__main__":
    main()
