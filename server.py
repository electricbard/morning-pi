#!/usr/bin/env python3
"""Morning Pi: kitchen display backend.

Serves the web UI, proxies + caches Open-Meteo weather and TTC (UmoIQ/NextBus)
predictions, and drives the screen backlight on a day/evening/night schedule.
Standard library only.
"""
import glob
import json
import os
import statistics
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
CONFIG_PATH = os.path.join(ROOT, "config.json")
CONFIG_EXAMPLE = os.path.join(ROOT, "config.example.json")
CALENDAR_PATH = os.path.join(ROOT, "calendar.txt")
CALENDAR_EXAMPLE = os.path.join(ROOT, "calendar.example.txt")
UA = "morning-pi/1.0 (home kitchen display)"
NEXTBUS = "https://webservices.umoiq.com/service/publicXMLFeed"
PORT = int(os.environ.get("MORNING_PI_PORT", "8080"))

_cache = {}
_cache_lock = threading.Lock()
_wake_until = 0.0


def load_config():
    path = CONFIG_PATH if os.path.exists(CONFIG_PATH) else CONFIG_EXAMPLE
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_calendar():
    """Parse calendar.txt: `type | date | label` per line.

    date is YYYY-MM-DD, "YYYY-MM-DD to YYYY-MM-DD", or MM-DD (birthdays, yearly).
    """
    path = CALENDAR_PATH if os.path.exists(CALENDAR_PATH) else CALENDAR_EXAMPLE
    entries, errors = [], []
    with open(path, encoding="utf-8") as f:
        for n, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 3:
                errors.append(f"line {n}: expected 'type | date | label'")
                continue
            typ, date, label = parts[0].lower(), parts[1], "|".join(parts[2:]).strip()
            entry = {"type": typ, "label": label}
            try:
                if " to " in date:
                    a, b = [d.strip() for d in date.split(" to ", 1)]
                    datetime.strptime(a, "%Y-%m-%d"); datetime.strptime(b, "%Y-%m-%d")
                    entry.update(start=a, end=b)
                elif len(date) == 5:
                    datetime.strptime("2000-" + date, "%Y-%m-%d")
                    entry["md"] = date
                else:
                    datetime.strptime(date, "%Y-%m-%d")
                    entry.update(start=date, end=date)
            except ValueError:
                errors.append(f"line {n}: bad date '{date}'")
                continue
            entries.append(entry)
    return {"entries": entries, "errors": errors}


def fetch(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def cached(key, ttl, fn):
    """Return fn() cached for ttl seconds; serve the last good value if a refresh fails."""
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    try:
        val = fn()
    except Exception as e:  # network hiccup: fall back to stale data
        if hit:
            stale = dict(hit[1])
            stale["stale"] = True
            stale["error"] = str(e)
            return stale
        raise
    with _cache_lock:
        _cache[key] = (now, val)
    return val


# ---------------------------------------------------------------- weather
def get_weather(cfg):
    loc = cfg["location"]
    hourly = ",".join([
        "temperature_2m", "apparent_temperature", "precipitation_probability",
        "precipitation", "weather_code", "wind_speed_10m", "wind_gusts_10m",
        "cloud_cover", "is_day",
    ])
    current = "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,is_day,precipitation"
    daily = "sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={loc['lat']}&longitude={loc['lon']}"
        f"&current={current}&hourly={hourly}&daily={daily}"
        f"&timezone={loc['tz'].replace('/', '%2F')}&forecast_days=3"
    )
    data = json.loads(fetch(url))
    data["fetchedAt"] = int(time.time())
    return data


# ---------------------------------------------------------------- transit
def predictions(route, stop):
    xml = fetch(f"{NEXTBUS}?command=predictions&a=ttc&r={route}&s={stop}")
    root = ET.fromstring(xml)
    out = []
    for p in root.iter("prediction"):
        out.append({
            "epoch": int(p.get("epochTime")) // 1000,
            "trip": p.get("tripTag"),
            "vehicle": p.get("vehicle"),
        })
    out.sort(key=lambda x: x["epoch"])
    return out


def get_transit(cfg):
    sr = cfg["schoolRoute"]
    board = predictions(sr["route"], sr["board"])
    alight = predictions(sr["route"], sr["alight"])
    by_trip = {a["trip"]: a["epoch"] for a in alight if a["trip"]}
    by_vehicle = {}
    for a in alight:
        by_vehicle.setdefault(a["vehicle"], a["epoch"])

    rides = []
    matched = {}
    for b in board:
        arr = by_trip.get(b["trip"])
        if arr is None:
            arr = by_vehicle.get(b["vehicle"])
        if arr is not None and arr > b["epoch"]:
            matched[id(b)] = arr
            rides.append(arr - b["epoch"])
    fallback = int(statistics.median(rides)) if rides else sr["fallbackRideMin"] * 60

    buses = []
    for b in board:
        arr = matched.get(id(b))
        buses.append({
            "depart": b["epoch"],
            "arrive": arr if arr else b["epoch"] + fallback,
            "arriveLive": bool(arr),
            "vehicle": b["vehicle"],
        })

    stops = []
    for s in cfg.get("otherStops", []):
        try:
            times = [p["epoch"] for p in predictions(s["route"], s["stop"])]
        except Exception:
            times = []
        stops.append({"label": s["label"], "times": times})

    return {"fetchedAt": int(time.time()), "school": {"route": sr["route"], "buses": buses}, "stops": stops}


# ---------------------------------------------------------------- backlight
def _mins(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def desired_brightness(cfg, now=None):
    now = now or datetime.now()
    n = cfg["night"]
    m = now.hour * 60 + now.minute
    dim_at, off_at, on_at = _mins(n["dimAt"]), _mins(n["offAt"]), _mins(n["onAt"])
    in_off = (m >= off_at or m < on_at) if off_at > on_at else (off_at <= m < on_at)
    if in_off:
        return n["dimBrightness"] if time.time() < _wake_until else 0
    if m >= dim_at:
        return n["dimBrightness"]
    return n["dayBrightness"]


def backlight_loop():
    last = None
    while True:
        try:
            cfg = load_config()
            level = desired_brightness(cfg)
            if level != last:
                for path in glob.glob("/sys/class/backlight/*/brightness"):
                    with open(path, "w") as f:
                        f.write(str(level))
                last = level
        except Exception as e:
            print("backlight:", e, flush=True)
        time.sleep(5)


# ---------------------------------------------------------------- http
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):
        pass  # keep the journal quiet

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        try:
            if path == "/api/config":
                return self._json(load_config())
            if path == "/api/calendar":
                return self._json(load_calendar())
            if path == "/api/weather":
                cfg = load_config()
                return self._json(cached("weather", 600, lambda: get_weather(cfg)))
            if path == "/api/transit":
                cfg = load_config()
                return self._json(cached("transit", 20, lambda: get_transit(cfg)))
            if path == "/api/health":
                return self._json({"ok": True, "time": int(time.time())})
        except Exception as e:
            return self._json({"error": str(e)}, 502)
        return super().do_GET()

    def do_POST(self):
        global _wake_until
        if self.path == "/api/wake":
            _wake_until = time.time() + 120
            return self._json({"awakeUntil": int(_wake_until)})
        self.send_error(404)


def main():
    threading.Thread(target=backlight_loop, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"morning-pi listening on http://127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
