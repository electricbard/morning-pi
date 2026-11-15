# Morning Pi

A kitchen-counter display for a Raspberry Pi with the official 7" touchscreen (800×480).

- **School mornings** (until 10:00): weather for recess, lunch, home time and the commute, what to wear,
  a walk/bike vs. transit call, and live TTC times turned into "Leave 8:39 → bus 8:44 → seated 9:01".
- **Rest of the day & weekends ("Discover")**: current weather, art of the day (public-domain, modern-leaning),
  a two-level question of the day, an English/French word of the day, and countdowns.
- **Clock mode** (evenings & weekends): eight animated full-screen clocks, a new one each time. Tap to exit.
- **Night**: the screen dims in the evening and the backlight turns off overnight; touch wakes it.

Weather: [Open-Meteo](https://open-meteo.com). Transit: TTC real-time feed (UmoIQ/NextBus).
Art: Wikimedia Commons, public domain.

## Setup

1. Flash Raspberry Pi OS (64-bit, with desktop) with SSH enabled.
2. `cp config.example.json config.json` and `cp calendar.example.txt calendar.txt`, then edit both.
   These two files hold your household details and are git-ignored.
3. `MORNING_PI_HOST=user@morning-pi.local ./deploy.sh`

### Finding TTC stop tags

`https://webservices.umoiq.com/service/publicXMLFeed?command=routeConfig&a=ttc&r=<route>` lists every stop
with its `tag` and the direction it belongs to.

### Calendar (`calendar.txt`)

One entry per line: `type | date | label`. Types: `birthday` (date `MM-DD`), `holiday`, `pa-day`,
`pa-day:elem`, `pa-day:sec`, `no-school`. Dates are `YYYY-MM-DD` or `YYYY-MM-DD to YYYY-MM-DD`.
The display re-reads it every few minutes.

## Layout

- `server.py` — standard-library Python: serves the UI, caches weather/transit, drives the backlight.
- `web/` — the display (plain HTML/CSS/JS) and `web/content/` (art, questions, words).
- `deploy/` — systemd service, kiosk launcher, install script.
