# Morning Pi

A kitchen-counter display for a Raspberry Pi with the official 7" touchscreen (800×480).

- **School mornings** (until 10:00): weather for recess, lunch, home time and the commute, what to wear,
  a walk/bike vs. transit call, and live TTC times turned into "Leave 8:39 → bus 8:44 → seated 9:01".
- **Rest of the day & weekends ("Discover")**: current weather, art of the day (public-domain, modern-leaning),
  a two-level question of the day, an English/French word of the day, and countdowns.
- **Dinner ideas** (16:30–18:30): three vegetarian/pescatarian dinners ready in 30 minutes or less replace the
  questions. Tap one for the full recipe (tap lines to tick them off); art/clock rotation pauses while it's open.
  Thumbs down and it never comes back; thumbs up and it returns now and then as a favourite.
- **Clock mode** (evenings & weekends): eight animated full-screen clocks, a new one each time. Tap to exit.
- **Night**: the screen dims in the evening and the backlight turns off overnight; touch wakes it.

Weather: [Open-Meteo](https://open-meteo.com). Transit: UmoIQ/NextBus real-time feed (set up for the TTC).
Art: Wikimedia Commons, public domain. Recipes: [Spoonacular](https://spoonacular.com/food-api).

## Setup

1. Flash Raspberry Pi OS (64-bit, with desktop) with SSH enabled.
2. `cp config.example.json config.json` and `cp calendar.example.txt calendar.txt`, then edit both.
   These two files hold your household details and are git-ignored.
3. `MORNING_PI_HOST=user@morning-pi.local ./deploy.sh`

## Make it yours

Everything household-specific lives in `config.json` and `calendar.txt` (both git-ignored).

### Your bus to school

- `transitAgency`: the UmoIQ/NextBus agency tag (`ttc` for Toronto). The list of agencies is at
  `https://webservices.umoiq.com/service/publicXMLFeed?command=agencyList`. Agencies that only publish
  GTFS-realtime aren't supported yet.
- `schoolRoute`: `route` (route tag, e.g. `63`), `direction` (shown on screen), `board` (stop tag where you
  get on), `alight` (stop tag where you get off), `alightName` (its name on screen), `fallbackRideMin` (ride
  time to assume when the feed can't match the bus at both stops).
- `school`: `days` (0 = Sunday … 6 = Saturday), `bell`, `offBusBy` (latest time to be off the bus),
  `walkToStopMin` (door to stop), `stopToSeatMin` (stop to classroom), and when the school screen shows
  (`morningFrom` to `transitUntil`). The display works backwards from `offBusBy` to show when to leave.
- `otherStops`: other stops to show next arrivals for, each with a `label`, `route` and `stop` tag.

To find stop tags, open
`https://webservices.umoiq.com/service/publicXMLFeed?command=routeConfig&a=<agency>&r=<route>`: every stop
is listed with its `tag`, name and the direction it belongs to. Check a stop with
`…?command=predictions&a=<agency>&r=<route>&s=<tag>`.

### The rest of the day

- `location`: latitude, longitude and time zone for the weather.
- `slots.school`: the weather slots on the school screen (recess, lunch, home time…).
- `transitRules`: when the display says "take transit" instead of "walk or bike" (rain, cold, wind).
- `night`: screen brightness through the day. `onAt`/`brightAt`/`dimAt`/`offAt`, `earlyBrightness`,
  `dimBrightness`, and `sleep` windows that turn the screen off (`"schoolDays": true` or a list of `days`).
  A touch always wakes it.
- `discover`: when art gives way to the questions, and when the evening art/question/clock rotation starts.

### Dinner ideas (`recipes` in `config.json`)

Sign up for a free key at <https://spoonacular.com/food-api/console#Dashboard> and put it in `recipes.apiKey`.
The server fetches three picks once a day (about 7 of the free plan's 150 daily points) and keeps them in
`~/.cache/morning-pi/recipes.json`. Ratings live in `~/.local/share/morning-pi/recipe-ratings.json`.
Without a key the questions stay up all afternoon. `diet` is `pescetarian` (Spoonacular's spelling; it
includes vegetarian dishes) or `vegetarian`; `maxMinutes`, `from` and `until` set the time limit and window.

### Calendar (`calendar.txt`)

One entry per line: `type | date | label`. Types: `birthday` (date `MM-DD`), `holiday`, `pa-day`,
`pa-day:elem`, `pa-day:sec`, `no-school`. Dates are `YYYY-MM-DD` or `YYYY-MM-DD to YYYY-MM-DD`.
The display re-reads it every few minutes.

## Layout

- `server.py` — standard-library Python: serves the UI, caches weather/transit, drives the backlight.
- `web/` — the display (plain HTML/CSS/JS) and `web/content/` (art, questions, words).
- `deploy/` — systemd service, kiosk launcher, install script.
