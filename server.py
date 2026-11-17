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
import re
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime
from zoneinfo import ZoneInfo
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
SPOON = "https://api.spoonacular.com/recipes"
# Outside the app folder so deploy.sh's rsync --delete never wipes it.
RECIPE_CACHE = os.path.expanduser(os.environ.get("MORNING_PI_RECIPE_CACHE", "~/.cache/morning-pi/recipes.json"))
# Thumbs up/down. Liked recipes are kept whole so they can come back without another API call.
RECIPE_RATINGS = os.path.expanduser(os.environ.get("MORNING_PI_RECIPE_RATINGS", "~/.local/share/morning-pi/recipe-ratings.json"))
FAVOURITE_GAP_DAYS = 10  # a liked recipe returns at most this often

_cache = {}
_cache_lock = threading.Lock()
_wake_until = 0.0
_backlight_kick = threading.Event()  # set by a touch so the screen lights at once, not on the next 5 s poll


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
    if "brightAt" in n and on_at <= m < _mins(n["brightAt"]):  # early morning: on, but softer until brightAt
        return n.get("earlyBrightness", n["dayBrightness"] // 2)
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
        _backlight_kick.wait(5)
        _backlight_kick.clear()


# ---------------------------------------------------------------- dinner recipes (Spoonacular)
_recipe_lock = threading.Lock()


def _strip_html(t):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t or "")).strip()


def _slim_recipe(r):
    steps = []
    for block in r.get("analyzedInstructions") or []:
        if block.get("name"):
            steps.append({"head": block["name"]})
        steps += [{"text": st["step"].strip()} for st in block.get("steps", []) if st.get("step", "").strip()]
    if not steps and r.get("instructions"):
        steps = [{"text": x.strip()} for x in re.split(r"(?<=[.!?])\s+(?=[A-Z])", _strip_html(r["instructions"])) if x.strip()]
    seen, ings = set(), []
    for i in r.get("extendedIngredients") or []:
        line = (i.get("original") or i.get("name") or "").strip()
        if line and line.lower() not in seen:
            seen.add(line.lower()); ings.append(line)
    return {
        "id": r["id"], "title": r.get("title", "").strip(), "image": r.get("image"),
        "minutes": r.get("readyInMinutes"), "servings": r.get("servings"),
        "kind": "vegetarian" if r.get("vegetarian") else "pescatarian",
        "source": r.get("sourceName") or "", "url": r.get("sourceUrl") or "",
        "ingredients": ings, "steps": steps,
    }


def _fetch_recipes(rc, avoid):
    q = {
        "apiKey": rc["apiKey"], "diet": rc.get("diet", "pescetarian"),  # Spoonacular's pescetarian includes vegetarian
        "type": rc.get("type", "main course"), "maxReadyTime": rc.get("maxMinutes", 30),
        "instructionsRequired": "true", "sort": "random",
    }
    diets = [q["diet"]] + (["vegetarian"] if q["diet"] == "pescetarian" else [])  # a vegetarian search too, so it's not all fish
    results = []
    for diet in diets:
        found = json.loads(fetch(f"{SPOON}/complexSearch?{urllib.parse.urlencode(dict(q, diet=diet, number=8))}", timeout=15))
        results += [r["id"] for r in found.get("results", []) if r["id"] not in results]
    ids = [i for i in results if i not in avoid]
    if len(ids) < 3:
        ids += [i for i in results if i in avoid]
    # Interleave the two searches so the spares include both kinds.
    half = len(ids) // 2
    ids = [x for pair in zip(ids[:half], ids[half:]) for x in pair] + ids[2 * half:]
    ids = ids[:8]  # a few spares in case some come back without steps, and room for a veg/fish mix
    full = json.loads(fetch(f"{SPOON}/informationBulk?" + urllib.parse.urlencode({"apiKey": rc["apiKey"], "ids": ",".join(map(str, ids))}), timeout=15))
    out = [_slim_recipe(r) for r in full]
    out = [r for r in out if r["steps"] and r["ingredients"] and (r["minutes"] or 0) <= rc.get("maxMinutes", 30)]
    # Mix it up: vegetarian and fish dishes alternate (veg first) instead of three of one kind.
    veg = [r for r in out if r["kind"] == "vegetarian"]
    fish = [r for r in out if r["kind"] != "vegetarian"]
    mixed = []
    while veg or fish:
        for pool in (veg, fish):
            if pool:
                mixed.append(pool.pop(0))
    return mixed[:3]


def _read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(obj, f)
    os.replace(path + ".tmp", path)


def _with_votes(resp):
    ratings = _read_json(RECIPE_RATINGS, {})
    for r in resp.get("recipes", []):
        r["vote"] = (ratings.get(str(r["id"])) or {}).get("vote", 0)
    return resp


def rate_recipe(rid, vote):
    """vote 1 = show again (favourite), -1 = never again, 0 = clear."""
    with _recipe_lock:
        store = _read_json(RECIPE_CACHE, {})
        ratings = _read_json(RECIPE_RATINGS, {})
        recipe = next((r for r in store.get("recipes", []) if r["id"] == rid), None) or (ratings.get(str(rid)) or {}).get("recipe")
        if vote == 0:
            ratings.pop(str(rid), None)
        else:
            entry = ratings.get(str(rid)) or {}
            entry.update(vote=vote, at=int(time.time()))
            if vote > 0 and recipe:
                entry["recipe"] = {k: v for k, v in recipe.items() if k not in ("vote", "favourite")}
                entry.setdefault("lastShown", store.get("date"))
            else:
                entry.pop("recipe", None)
            ratings[str(rid)] = entry
        _write_json(RECIPE_RATINGS, ratings)
    return {"id": rid, "vote": vote}


def get_recipes(cfg):
    """Three dinner ideas per day, fetched once and kept on disk (the free plan allows ~150 points/day; this uses ~3)."""
    rc = cfg.get("recipes") or {}
    if not rc.get("apiKey"):
        return {"configured": False, "recipes": []}
    today = datetime.now(ZoneInfo(cfg["location"].get("tz", "America/Toronto"))).strftime("%Y-%m-%d")
    with _recipe_lock:
        store = _read_json(RECIPE_CACHE, {})
        if store.get("date") == today and store.get("recipes"):
            return _with_votes({"configured": True, "date": today, "recipes": store["recipes"]})
        if store.get("failedAt", 0) > time.time() - 1800:  # don't hammer the API after a failure
            return _with_votes({"configured": True, "date": store.get("date"), "recipes": store.get("recipes", []), "stale": True, "error": store.get("error")})
        ratings = _read_json(RECIPE_RATINGS, {})
        disliked = {int(k) for k, v in ratings.items() if v.get("vote", 0) < 0}
        # One favourite a day, the one that has waited longest, once it's been FAVOURITE_GAP_DAYS since it last showed.
        cutoff = datetime.strptime(today, "%Y-%m-%d").toordinal() - FAVOURITE_GAP_DAYS
        due = sorted((v.get("lastShown") or "", k) for k, v in ratings.items() if v.get("vote", 0) > 0 and v.get("recipe")
                     and (not v.get("lastShown") or datetime.strptime(v["lastShown"], "%Y-%m-%d").toordinal() <= cutoff))
        fav = dict(ratings[due[0][1]]["recipe"], favourite=True) if due else None
        try:
            fresh = _fetch_recipes(rc, set(store.get("recent", [])) | disliked | {int(k) for k in ratings})
            fresh = [r for r in fresh if r["id"] not in disliked]
            recipes = ([fav] if fav else []) + fresh[: 3 - (1 if fav else 0)]
            if not fresh:
                raise RuntimeError("no recipes matched")
            store = {"date": today, "recipes": recipes, "recent": ([r["id"] for r in recipes] + store.get("recent", []))[:90]}
            if fav:
                ratings[str(fav["id"])]["lastShown"] = today
                _write_json(RECIPE_RATINGS, ratings)
        except Exception as e:
            store.update(failedAt=time.time(), error=str(e))
        _write_json(RECIPE_CACHE, store)
        ok = store.get("date") == today
        return _with_votes({"configured": True, "date": store.get("date"), "recipes": store.get("recipes", []), **({} if ok else {"stale": True, "error": store.get("error")})})


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
                cfg = load_config()
                if isinstance(cfg.get("recipes"), dict):
                    cfg["recipes"] = {k: v for k, v in cfg["recipes"].items() if k != "apiKey"}  # keep the key server-side
                return self._json(cfg)
            if path == "/api/recipes":
                return self._json(get_recipes(load_config()))
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
        if self.path == "/api/recipes/rate":
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0) or b"{}")
                vote = int(body.get("vote", 0))
                return self._json(rate_recipe(int(body["id"]), max(-1, min(1, vote))))
            except Exception as e:
                return self._json({"error": str(e)}, 400)
        if self.path == "/api/wake":
            _wake_until = time.time() + 120
            _backlight_kick.set()
            return self._json({"awakeUntil": int(_wake_until)})
        self.send_error(404)


def main():
    threading.Thread(target=backlight_loop, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"morning-pi listening on http://127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
