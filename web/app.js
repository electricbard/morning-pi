'use strict';
/* Morning Pi — kitchen display UI.
 * Modes: "school" (school-day mornings: weather slots + bus), "discover" (rest of the time:
 * now-weather, art / question+word, countdowns) and a full-screen clock overlay. */
(() => {
  const S = {
    cfg: null, cal: [], wx: null, tr: null, trError: false,
    art: [], qs: [], words: { en: [], fr: [] },
    view: null, look: false, reveal: {}, revealDay: null, idleTimer: null,
    autoStep: -1, autoAt: 0, lastTouch: 0,
    clockOn: false, clockUpdate: null, clockMinute: null,
    recipes: [], recipeOpen: null, recipeDone: {},
  };

  // ---------------------------------------------------------------- helpers
  // Testing aid: ?at=2026-11-16T08:30 pretends the display started at that local time.
  const QS = new URLSearchParams(location.search);
  const AT = QS.get('at');
  const FORCE_MODE = QS.get('mode'); // testing aid: ?mode=school or ?mode=discover
  if (QS.get('art')) S.view = 'art';
  if (QS.get('view')) S.view = QS.get('view'); // testing aid: ?view=art|learn
  if (QS.get('full')) S.full = true; // testing aid: ?full=1 opens today's art full screen
  const FORCE_DINNER = QS.get('dinner') || QS.get('recipe'); // testing aid: ?dinner=1 shows dinner ideas; ?recipe=N opens idea N
  const T0 = Date.now();
  const clockNow = () => (AT ? new Date(new Date(AT).getTime() + (Date.now() - T0)) : new Date());
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getJSON = async (u) => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };
  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const minsOf = (d) => d.getHours() * 60 + d.getMinutes();
  const at = (base, s) => { const d = new Date(base); d.setHours(0, 0, 0, 0); d.setMinutes(hm(s)); return d; };
  const fmt = (d) => (d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0');
  const fmtHM = (s) => fmt(at(clockNow(), s));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayIndex = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const r0 = (n) => { const v = Math.round(n); return (v === 0 ? 0 : v); };
  const deg = (n) => (r0(n) < 0 ? '−' + Math.abs(r0(n)) : r0(n)) + '°';
  const minsBetween = (a, b) => Math.round((b - a) / 60000);

  // ---------------------------------------------------------------- icons
  const svg = (inner, size, stroke, extra = '') =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;
  const P = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    partly: '<path d="M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4" stroke="#FFC857"/><path d="M15.9 13A4 4 0 0 0 8.3 10.4" stroke="#FFC857"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z"/>',
    cloud: '<path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20 11.5 3.75 3.75 0 0 1 17.5 19z"/>',
    rain: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20 7.5 3.75 3.75 0 0 1 17.5 15z" stroke="#C5CEDB"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
    snow: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20 7.5 3.75 3.75 0 0 1 17.5 15z" stroke="#C5CEDB"/><path d="M8 18v.01M12 20v.01M16 18v.01M10 22.5v.01M14 22.5v.01" stroke-width="2.6"/>',
    storm: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20 7.5 3.75 3.75 0 0 1 17.5 15z" stroke="#C5CEDB"/><path d="M13 14l-3 4.5h4L12 23"/>',
    fog: '<path d="M4 8h16M4 12h16M6 16h12M8 20h8"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/>',
    drop: '<path d="M12 2.7l5.7 5.7a8 8 0 1 1-11.3 0z"/>',
    sunrise: '<path d="M17 18a5 5 0 0 0-10 0M12 3v6M8.5 6.5L12 3l3.5 3.5M2 21h20"/>',
    sunset: '<path d="M17 18a5 5 0 0 0-10 0M12 9V3M8.5 6.5L12 9l3.5-2.5M2 21h20"/>',
    bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17L9 9.5h7.5L12 17H5.5M9 9.5L8 6.5H6M14 6.5h2.5l2 10.5"/>',
    bus: '<rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 10h16M8 17v3M16 17v3"/>',
    shirt: '<path d="M8 3l-5 3 2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
    umbrella: '<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v7a2 2 0 0 0 4 0"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    up: '<path d="M7 10v12M15 5.9L14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z"/>',
    down: '<path d="M17 14V2M9 18.1L10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9z"/>',
  };
  const ICON_COLOR = { sun: '#FFC857', partly: '#C5CEDB', cloud: '#C5CEDB', rain: '#8CC8FF', snow: '#E6F0FF', storm: '#FFC857', fog: '#C5CEDB', moon: '#FFE3A3' };
  const LABEL = { sun: 'Sunny', partly: 'Partly cloudy', cloud: 'Cloudy', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorm', fog: 'Fog', moon: 'Clear night' };
  function wxKind(code, isDay) {
    if (code <= 1) return isDay ? 'sun' : 'moon';
    if (code === 2) return isDay ? 'partly' : 'moon';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'rain';
  }
  const wxIcon = (code, isDay, size) => { const k = wxKind(code, isDay); return svg(P[k], size, ICON_COLOR[k], `role="img" aria-label="${LABEL[k]}"`); };
  const badge = (route, cls = '') => `<span class="badge ${cls}" aria-label="Route ${esc(route)}">${esc(route)}</span>`;

  // ---------------------------------------------------------------- weather
  function hourIdx(d) {
    if (!S.wx) return -1;
    const key = `${ymd(d)}T${pad(d.getHours())}:00`;
    return S.wx.hourly.time.indexOf(key);
  }
  function wxAt(d) {
    const i = hourIdx(d);
    if (i < 0) return null;
    const h = S.wx.hourly;
    return { t: h.temperature_2m[i], f: h.apparent_temperature[i], p: h.precipitation_probability[i] ?? 0, mm: h.precipitation[i] ?? 0,
             code: h.weather_code[i], wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i], cloud: h.cloud_cover[i], day: h.is_day[i] === 1 };
  }
  function hoursBetween(a, b) {
    const out = []; const d = new Date(a); d.setMinutes(0, 0, 0);
    while (d <= b) { const w = wxAt(d); if (w) out.push(w); d.setHours(d.getHours() + 1); }
    return out;
  }
  const dayPrecip = (now) => { const hs = hoursBetween(at(now, '07:00'), at(now, '19:00')); return hs.length ? Math.max(...hs.map((h) => h.p)) : 0; };
  const sunTime = (key) => { try { return fmt(new Date(S.wx.daily[key][0])); } catch (e) { return '–'; } };

  function wearText(now) {
    const hs = hoursBetween(now, at(now, '15:30'));
    if (!hs.length) return null;
    const minF = Math.min(...hs.map((h) => h.f));
    const snow = hs.some((h) => wxKind(h.code, true) === 'snow' && h.p >= 40);
    let t;
    if (minF <= -10) t = 'Parka, hat, mitts & scarf';
    else if (minF <= 0) t = 'Winter coat, hat & gloves';
    else if (minF <= 8) t = 'Warm jacket';
    else if (minF <= 15) t = 'Light jacket or hoodie';
    else t = 'T-shirt weather';
    return snow ? t + ' · boots' : t;
  }

  function transitAdvice(now) {
    const r = S.cfg.transitRules;
    const hs = hoursBetween(at(now, r.windowFrom), at(now, r.windowTo));
    if (!hs.length) return null;
    const maxP = Math.max(...hs.map((h) => h.p));
    const mm = hs.reduce((a, h) => a + h.mm, 0);
    const minF = Math.min(...hs.map((h) => h.f));
    const gust = Math.max(...hs.map((h) => h.gust));
    const freezing = hs.some((h) => [56, 57, 66, 67].includes(h.code));
    const snowy = hs.some((h) => wxKind(h.code, true) === 'snow');
    const why = [];
    if (freezing) why.push('Freezing rain');
    if (maxP >= r.precipProbAtLeast || mm >= r.precipMmAtLeast) why.push(`${snowy ? 'Snow' : 'Rain'} ${maxP}% ${fmtHM(r.windowFrom)}–${fmtHM(r.windowTo)}`);
    if (minF <= r.feelsLikeAtOrBelow) why.push(`Feels ${deg(minF)}`);
    if (gust >= r.gustsAtLeast) why.push(`Gusts ${r0(gust)} km/h`);
    if (why.length) return { transit: true, title: 'Take transit today', sub: why.join(' · ') };
    return { transit: false, title: 'Walk or bike today', sub: `Dry morning · feels ${deg(minF)}${minF <= 0 ? ' · gloves on' : ''}` };
  }

  // ---------------------------------------------------------------- calendar
  function coversDay(e, d) {
    const k = ymd(d);
    return e.start && k >= e.start && k <= (e.end || e.start);
  }
  function isSchoolDay(d) {
    if (!S.cfg.school.days.includes(d.getDay())) return false;
    const off = ['holiday', 'pa-day', 'pa-day:sec', 'no-school'];
    if ((S.cfg.school.noSchoolDates || []).includes(ymd(d))) return false;
    return !S.cal.some((e) => off.includes(e.type) && coversDay(e, d));
  }
  function countdowns(now) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const items = [];
    for (const e of S.cal) {
      let date;
      if (e.type === 'birthday' && e.md) {
        const [m, d] = e.md.split('-').map(Number);
        date = new Date(today.getFullYear(), m - 1, d);
        if (date < today) date = new Date(today.getFullYear() + 1, m - 1, d);
        items.push({ kind: 'birthday', label: `${e.label}'s birthday`, date });
      } else if (e.start) {
        const [y, m, d] = e.start.split('-').map(Number);
        date = new Date(y, m - 1, d);
        const end = e.end ? new Date(...e.end.split('-').map((v, i) => (i === 1 ? v - 1 : +v))) : date;
        if (end < today) continue;
        const kind = e.type.startsWith('pa-day') ? 'pa' : e.type;
        items.push({ kind, label: e.label, date, during: date <= today });
      }
    }
    const pick = (kind) => items.filter((i) => i.kind === kind).sort((a, b) => a.date - b.date)[0];
    const chosen = [pick('pa'), pick('birthday'), pick('holiday')].filter(Boolean).sort((a, b) => a.date - b.date);
    return chosen.slice(0, 3).map((i) => {
      const days = Math.round((i.date - today) / 864e5);
      let label = i.label;
      if (i.kind === 'pa') label += ` · ${DAYS[i.date.getDay()].slice(0, 3)} ${MONTHS[i.date.getMonth()].slice(0, 3)} ${i.date.getDate()}`;
      const n = i.during || days === 0 ? '<strong>Today!</strong>' : days === 1 ? '<strong>Tomorrow</strong>' : `<strong>${days}</strong> days`;
      return { label, n };
    });
  }

  // ---------------------------------------------------------------- mode
  function mode(now) {
    if (FORCE_MODE) return FORCE_MODE;
    const sc = S.cfg.school;
    const m = minsOf(now);
    if (isSchoolDay(now) && m >= hm(sc.morningFrom) && m < hm(sc.transitUntil)) return 'school';
    return 'discover';
  }

  // ---------------------------------------------------------------- header
  function header(now, withClockBtn) {
    const sun = S.wx ? `<span class="sun">${svg(P.sunrise, 18, '#FFC857', 'role="img" aria-label="Sunrise"')}${sunTime('sunrise')}</span>` +
      `<span class="sun">${svg(P.sunset, 18, '#FFB066', 'role="img" aria-label="Sunset"')}${sunTime('sunset')}</span>` : '';
    const btn = withClockBtn ? `<button class="icon-btn" data-act="clock" aria-label="Next: art, question, clock">${svg(P.clock, 18, 'currentColor', 'aria-hidden="true"')}</button>` : '';
    return `<header class="hdr"><div class="hdr-l"><span class="hdr-time" id="hdrTime">${fmt(now)}</span>` +
      `<span class="hdr-date">${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}</span></div>` +
      `<div class="hdr-r">${sun}${btn}</div></header>`;
  }

  // ---------------------------------------------------------------- school mode
  function schoolView(now) {
    const c = S.wx && S.wx.current;
    const alertP = S.cfg.transitRules.rainAlertProbAtLeast;
    let nowCard = '<div class="now-card"><span class="now-label">Weather loading…</span></div>';
    if (c) {
      nowCard = `<div class="now-card">${wxIcon(c.weather_code, c.is_day === 1, 60)}
        <div class="now-big"><span class="now-label">OUTSIDE NOW</span><span class="now-temp">${deg(c.temperature_2m)}</span></div>
        <div class="now-side"><span class="now-feels">Feels like ${deg(c.apparent_temperature)}</span>
          <span class="now-line">${svg(P.wind, 16, 'currentColor', 'aria-hidden="true"')}Wind ${r0(c.wind_speed_10m)} · gusts ${r0(c.wind_gusts_10m)} km/h</span>
          <span class="now-line">${svg(P.drop, 16, 'currentColor', 'aria-hidden="true"')}${dayPrecip(now)}% chance · H ${deg(S.wx.daily.temperature_2m_max[0])} L ${deg(S.wx.daily.temperature_2m_min[0])}</span></div></div>`;
    }
    const wet = [];
    const slots = S.cfg.slots.school.map((s) => {
      const w = wxAt(at(now, s.time));
      if (!w) return `<div class="slot"><span class="slot-label">${esc(s.label)}</span><span class="slot-time">${fmtHM(s.time)}</span></div>`;
      const rainy = w.p >= alertP;
      if (rainy && at(now, s.time) > now) wet.push(s.label.toLowerCase());
      return `<div class="slot${rainy ? ' rain' : ''}"><span class="slot-label">${esc(s.label)}</span><span class="slot-time">${fmtHM(s.time)}</span>
        <span style="margin:4px 0">${wxIcon(w.code, w.day, 34)}</span><span class="slot-temp">${deg(w.t)}</span><span class="slot-feels">feels ${deg(w.f)}</span>
        <span class="slot-foot${rainy ? ' wet' : ''}">${rainy ? `${w.p}% ${wxKind(w.code, true) === 'snow' ? 'snow' : 'rain'}` : `${w.p}% · ${r0(w.wind)} km/h`}</span></div>`;
    }).join('');
    let strip = '';
    if (wet.length) {
      const list = [...new Set(wet)];
      const txt = list.length > 1 ? list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1] : list[0];
      strip = `<div class="strip alert">${svg(P.umbrella, 30, '#FFB066', 'aria-hidden="true"')}<span class="strip-text">Rain alert: wet at ${esc(txt)}</span></div>`;
    } else {
      const wt = wearText(now);
      if (wt) strip = `<div class="strip">${svg(P.shirt, 30, '#8CC8FF', 'aria-hidden="true"')}<span class="strip-text">${esc(wt)}</span></div>`;
    }

    const adv = transitAdvice(now);
    const rec = adv ? `<div class="rec${adv.transit ? ' transit' : ''}">${svg(adv.transit ? P.bus : P.bike, 30, adv.transit ? '#8CC8FF' : '#5FD99A', 'aria-hidden="true"')}
      <div style="display:flex;flex-direction:column;gap:1px;min-width:0"><span class="rec-title">${adv.title}</span><span class="rec-sub">${esc(adv.sub)}</span></div></div>` : '';

    const bus = busBlock(now);
    const lc = S.lastCall;
    if (lc && S.lastCallOk !== +lc.hero.depart) {
      const inMin = minsBetween(now, lc.hero.leave);
      return `<button class="lastcall" data-act="lastcall-ok" aria-label="Back to the dashboard">
        <span class="lc-pill">CATCH THIS BUS</span>
        <span class="lc-top">${badge(lc.route)}<span>LAST BUS THAT GETS YOU TO SCHOOL ON TIME</span></span>
        <span class="lc-title">${inMin <= 1 ? 'Leave now' : `Leave in ${inMin} min`}</span>
        <span class="lc-line">Leave ${fmt(lc.hero.leave)} → bus ${fmt(lc.hero.depart)} → seated ${fmt(lc.hero.seated)} · ${-lc.hero.late} min to spare</span>
        <span class="lc-next">Next bus ${fmt(lc.next.depart)} → seated ${fmt(lc.next.seated)} · <strong>${lc.next.late} min late</strong></span>
        <span class="lc-foot">Tap to go back</span></button>`;
    }
    return `<div class="school">${header(now, false)}<div class="school-body">
      <section class="wx-col" aria-label="Weather">${nowCard}<div class="slots">${slots}</div><div class="advice">${strip}${rec}</div></section>
      <section class="bus-col" aria-label="Getting to school">${bus}${otherStops(now)}</section></div></div>`;
  }

  function busBlock(now) {
    const sr = S.cfg.schoolRoute, sc = S.cfg.school;
    const top = `<div class="hero-top">${badge(sr.route)}<span>${esc((sr.direction || '').toUpperCase())} · OFF AT ${esc(sr.alightName.toUpperCase())} BY ${fmtHM(sc.offBusBy)}</span></div>`;
    if (!S.tr || !S.tr.school) {
      return `<div class="hero none">${top}<span class="hero-title">${S.trError ? 'No bus times' : 'Loading…'}</span><span class="hero-line">${S.trError ? 'Live TTC times are unavailable right now.' : ''}</span></div>`;
    }
    const bell = at(now, sc.bell);
    const walk = sc.walkToStopMin * 60000, toSeat = sc.stopToSeatMin * 60000;
    const buses = S.tr.school.buses.map((b) => {
      const depart = new Date(b.depart * 1000), arrive = new Date(b.arrive * 1000);
      const leave = new Date(depart - walk), seated = new Date(+arrive + toSeat);
      return { depart, arrive, leave, seated, missed: leave < now - 30000, late: minsBetween(bell, seated) };
    });
    const live = buses.filter((b) => !b.missed);
    const hero = live[0];
    // Last call: this bus still gets him there on time, the one after it doesn't.
    S.lastCall = hero && hero.late <= 0 && live[1] && live[1].late > 0 ? { hero, next: live[1], route: sr.route } : null;
    if (QS.get('lastcall') && hero && live[1]) S.lastCall = { hero, next: { ...live[1], late: 3 }, route: sr.route }; // testing aid: ?lastcall=1 forces the alert
    const line = (b) => `${fmt(b.leave)} → ${badge(sr.route, 'sm')} ${fmt(b.depart)} → seated ${fmt(b.seated)}`; // same order as the hero line: leave → bus → seated
    let heroHtml;
    if (!hero) {
      heroHtml = `<div class="hero none">${top}<span class="hero-title">No buses soon</span></div>`;
    } else {
      const inMin = minsBetween(now, hero.leave);
      const onTime = hero.late <= 0;
      const title = onTime ? (inMin <= 1 ? 'Leave now' : `Leave in ${inMin} min`) : 'Running late';
      const right = onTime && inMin <= 1 ? `<span class="hero-in">${inMin <= 0 ? 'go!' : 'in 1 min'}</span>` : '';
      const chip = onTime ? `${-hero.late} min to spare` : `${hero.late} min late · leave ${inMin <= 0 ? 'now' : `in ${inMin} min`}`;
      heroHtml = `<div class="hero ${onTime ? 'go' : 'late'}">${top}<div class="hero-main"><span class="hero-title">${title}</span>${right}</div>
        <span class="hero-line">Leave ${fmt(hero.leave)} → bus ${fmt(hero.depart)} → seated ${fmt(hero.seated)}</span><span class="chip">${chip}</span></div>`;
    }
    // The bus just before the hero, shown above it so the column reads in time order. Too late to walk to it,
    // but while it hasn't reached the stop yet it's "Hurry"; once it has, it's "missed" (struck through).
    let past = '';
    const prev = buses.filter((b) => b.missed && now - b.leave < 10 * 60000).pop();
    if (prev && prev.depart > now) {
      const m = Math.max(1, minsBetween(now, prev.depart));
      past = `<div class="rows"><div class="row hurry"><span class="row-main">${line(prev)}</span><span class="row-tag hurry">Hurry · ${m} min</span></div></div>`;
    } else if (prev) {
      past = `<div class="rows"><div class="row missed"><span class="row-main">${line(prev).replace(badge(sr.route, 'sm'), badge(sr.route, 'sm off'))}</span><span class="row-tag missed">missed</span></div></div>`;
    }
    const rows = [];
    for (const b of live.slice(1)) {
      if (rows.length >= 2) break;
      const tag = b.late > 0 ? `<span class="row-tag late">${b.late} min late</span>` : `<span class="row-tag ok">${-b.late} min spare</span>`;
      rows.push(`<div class="row"><span class="row-main">${line(b)}</span>${tag}</div>`);
    }
    return past + heroHtml + (rows.length ? `<div class="rows">${rows.join('')}</div>` : '');
  }

  function otherStops(now) {
    if (!S.tr || !S.tr.stops) return '';
    return S.tr.stops.map((s, i) => {
      const cfg = (S.cfg.otherStops || [])[i] || {};
      const times = s.times.map((t) => new Date(t * 1000)).filter((d) => d > now).slice(0, 2);
      const cells = times.length ? times.map((d) => `<span>${fmt(d)}</span>`).join('') : '<span style="font-size:14px;color:var(--muted)">No buses soon</span>';
      return `<div class="other"><div class="other-head">${badge(cfg.route || '')}<span>${esc(s.label)}</span></div><div class="other-times">${cells}</div></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- discover mode
  function defaultView(now) { return minsOf(now) < hm(S.cfg.discover.artUntil) ? 'art' : 'learn'; }

  function laterWeather(now) {
    const rows = [];
    for (let k = 1; k <= 4; k++) {
      const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + k * 2);
      const w = wxAt(d);
      if (!w) continue;
      const h = d.getHours();
      rows.push(`<div class="hr"><span class="hh">${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}</span>${wxIcon(w.code, w.day, 22)}<span class="ht">${deg(w.t)}</span>
        <span class="hp${w.p >= 40 ? ' wet' : ''}">${svg(P.drop, 12, 'currentColor', 'aria-hidden="true"')}${r0(w.p)}%</span></div>`);
    }
    const dl = S.wx.daily;
    return `<section class="wx-more" aria-label="Weather later"><span class="eyebrow" style="color:var(--muted)">LATER</span>${rows.join('')}
      <div class="wx-foot"><span>H ${deg(dl.temperature_2m_max[0])} · L ${deg(dl.temperature_2m_min[0])}</span>
      <span class="sun">${svg(P.sunset, 16, '#FFB066', 'role="img" aria-label="Sunset"')}${sunTime('sunset')}</span></div></section>`;
  }

  function wordSide(di) {
    const lang = di % 2 === 0 ? 'en' : 'fr';
    const list = S.words[lang] || [];
    const w = list.length ? list[Math.floor(di / 2) % list.length] : null;
    if (!w) return '';
    return `<section class="side" aria-label="Word of the day"><span class="eyebrow blue">${lang === 'fr' ? 'MOT DU JOUR · FRENCH' : 'WORD OF THE DAY'}</span>
          <span class="word serif${w.w.length > 10 ? ' long' : ''}">${esc(w.w)}</span><span class="word-say">${w.say ? `say “${esc(w.say)}” · ` : ''}${esc(w.pos)}</span>
          <span class="word-def">${esc(w.def)}</span><span class="word-ex" style="margin-top:auto">${lang === 'fr' ? `« ${esc(w.ex)} »` : esc(w.ex)}</span>
          ${w.exEn ? `<span class="word-en">${esc(w.exEn)}</span>` : ''}</section>`;
  }

  // Dinner ideas replace the questions in the late afternoon (config "recipes": from/until).
  function dinnerTime(now) {
    const rc = S.cfg.recipes;
    if (!S.recipes.length || !rc) return false;
    if (FORCE_DINNER) return true;
    const m = minsOf(now);
    return m >= hm(rc.from || '16:30') && m < hm(rc.until || '18:30');
  }
  const kindLabel = (r) => (r.kind === 'vegetarian' ? 'VEGETARIAN' : 'PESCATARIAN');
  const recipeImg = (r, cls) => (r.image ? `<img class="${cls}" src="${esc(r.image)}" alt="">` : `<div class="${cls} noimg" aria-hidden="true"></div>`);

  function dinnerCards() {
    const max = (S.cfg.recipes && S.cfg.recipes.maxMinutes) || 30;
    const card = (r, i) => `<button class="dish" data-act="recipe-${i}" aria-label="Open recipe: ${esc(r.title)}">${recipeImg(r, 'dish-img')}
      <span class="dish-kind ${r.kind}">${kindLabel(r)}${r.favourite ? ' · <b class="fav">FAVOURITE</b>' : ''}</span>${r.vote ? `<span class="dish-vote ${r.vote > 0 ? 'up' : 'down'}">${svg(P[r.vote > 0 ? 'up' : 'down'], 16, 'currentColor', 'aria-hidden="true"')}</span>` : ''}<span class="dish-title serif${r.title.length > 42 ? ' long' : ''}">${esc(r.title)}</span>
      <span class="dish-meta">${r.minutes ? r.minutes + ' min' : ''}${r.servings ? ' · serves ' + r.servings : ''}</span></button>`;
    return `<section class="main qcard" aria-label="Dinner ideas"><div class="qhead"><span class="eyebrow gold">DINNER IDEAS · ${max} MIN OR LESS</span><span class="dish-hint">Tap one for the recipe</span></div>
      <div class="dishes">${S.recipes.map(card).join('')}</div></section>`;
  }

  // Full-screen recipe: ingredients on the left, steps on the right. Tap a line to tick it off.
  function recipeView() {
    const r = S.recipes[S.recipeOpen];
    const done = (k) => (S.recipeDone[r.id + k] ? ' done' : '');
    let n = 0;
    const steps = r.steps.map((st, i) => (st.head ? `<li class="rc-head">${esc(st.head)}</li>`
      : `<li><button class="rc-line${done('s' + i)}" data-act="tick-s${i}"><span class="rc-n">${++n}</span><span>${esc(st.text)}</span></button></li>`)).join('');
    const ings = r.ingredients.map((x, i) => `<li><button class="rc-line${done('i' + i)}" data-act="tick-i${i}"><span class="rc-box" aria-hidden="true"></span><span>${esc(x)}</span></button></li>`).join('');
    const meta = [r.minutes && r.minutes + ' min', r.servings && 'serves ' + r.servings, kindLabel(r).toLowerCase()].filter(Boolean).join(' · ');
    return `<div class="recipe"><header class="rc-top"><div class="rc-tt"><span class="eyebrow gold">TONIGHT'S DINNER · ${esc(meta.toUpperCase())}</span>
        <h1 class="serif">${esc(r.title)}</h1></div>
        <div class="rc-acts"><button class="btn rc-vote${r.vote > 0 ? ' on up' : ''}" data-act="vote-up" aria-pressed="${r.vote > 0}" aria-label="Thumbs up: show this again">${svg(P.up, 22, 'currentColor', 'aria-hidden="true"')}</button>
        <button class="btn rc-vote${r.vote < 0 ? ' on down' : ''}" data-act="vote-down" aria-pressed="${r.vote < 0}" aria-label="Thumbs down: never show this again">${svg(P.down, 22, 'currentColor', 'aria-hidden="true"')}</button>
        <button class="btn rc-close" data-act="recipe-close">Close ✕</button></div></header>
      ${r.vote ? `<p class="rc-voted">${r.vote > 0 ? 'Saved as a favourite. It will come back now and then.' : 'Got it. This one won’t come back.'}</p>` : ''}
      <div class="rc-body"><section class="rc-ing" data-scroll="ing" aria-label="Ingredients">${recipeImg(r, 'rc-img')}<span class="eyebrow green">INGREDIENTS</span><ul>${ings}</ul>
        <p class="rc-src">${r.source ? 'Recipe: ' + esc(r.source) + ' · ' : ''}via Spoonacular</p></section>
        <section class="rc-steps" data-scroll="steps" aria-label="Steps"><span class="eyebrow blue">STEPS</span><ol>${steps}</ol></section></div></div>`;
  }

  function discoverView(now) {
    const view = S.view || defaultView(now);
    const di = dayIndex(now);
    if (S.revealDay !== di) { S.reveal = {}; S.revealDay = di; }
    const c = S.wx && S.wx.current;
    const windTxt = c ? (c.wind_gusts_10m >= 30 ? `gusts ${r0(c.wind_gusts_10m)} km/h` : `wind ${r0(c.wind_speed_10m)} km/h`) : '';
    let nowTile = c ? `<div class="now-tile">${wxIcon(c.weather_code, c.is_day === 1, 40)}<div style="display:flex;flex-direction:column;gap:2px">
        <span class="eyebrow" style="color:var(--muted);letter-spacing:1px;font-weight:700">NOW</span><span class="t">${deg(c.temperature_2m)}</span>
        <span class="f">feels ${deg(c.apparent_temperature)}</span><span class="w">${c.wind_gusts_10m >= 30 ? `gusts ${r0(c.wind_gusts_10m)} km/h` : `wind ${r0(c.wind_speed_10m)} km/h`}</span></div></div>`
      : '<div class="now-tile"><span class="w">Weather loading…</span></div>';
    let side = '', main = '', extra = '', layout = '';
    if (view === 'art' && S.art.length) {
      const n = S.art.length, ai = QS.get('art') ? Number(QS.get('art')) - 1 : di; // testing aid: ?art=N shows piece N
      const a = S.art[((ai % n) + n) % n];
      const port = a.w && a.h && a.h / a.w > 1.05;
      layout = port ? ' port' : ' land';
      // Landscape art: text on the left under a slim weather tile. Portrait art: text gets the full-height right column
      // and the left column has room for more weather.
      side = `<section class="side art-info" aria-label="About the art"><span class="eyebrow gold">ART OF THE DAY${a.tag ? ' · ' + esc(a.tag.toUpperCase()) : ''}</span>
        <span class="art-title serif">${esc(a.title)}</span><span class="art-meta">${esc(a.artist)} · ${esc(a.year)}${a.place ? ' · ' + esc(a.place) : ''}</span>
        <div class="art-more"><span class="eyebrow green">CAN YOU SPOT IT?</span><p class="spot">${esc(a.spot)}</p><p class="story">${esc(a.story)}</p></div>
        <button class="btn look-btn" data-act="look">${S.look ? 'Hide ▴' : 'Look closer ▾'}</button></section>`;
      if (!port && c) {
        nowTile = `<div class="now-tile slim">${wxIcon(c.weather_code, c.is_day === 1, 34)}<span class="t">${deg(c.temperature_2m)}</span>
          <div class="fw"><span class="f">feels ${deg(c.apparent_temperature)}</span><span class="w">${windTxt}</span></div></div>`;
      }
      if (port && S.wx) extra = laterWeather(now);
      main = `<section class="main art-frame" aria-label="Art of the day"><button class="art-tap" data-act="full" aria-label="Show full screen"><img src="content/art/${esc(a.file)}" alt="${esc(a.title)} by ${esc(a.artist)}"></button>
        ${S.full ? `<button class="art-full" data-act="unfull" aria-label="Back to dashboard"><img src="content/art/${esc(a.file)}" alt=""></button>` : ''}
        ${S.look ? `<div class="look"><span class="eyebrow green">CAN YOU SPOT IT?</span><p class="spot">${esc(a.spot)}</p><p class="story">${esc(a.story)}</p></div>` : ''}</section>`;
    } else if (dinnerTime(now)) {
      side = wordSide(di);
      main = dinnerCards();
    } else {
      // One question per school level each day. Each level's pool alternates subjects so days vary.
      const SUBJ = ['math', 'physics', 'biology'];
      const subj = ['primary', 'junior', 'senior'].map((lv) => {
        const lists = SUBJ.map((k) => ((S.qs && S.qs[k]) || []).filter((x) => x.lv === lv).map((x) => ({ ...x, subj: k })));
        const pool = [];
        for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) lists.forEach((l) => { if (l[i]) pool.push(l[i]); });
        return pool.length ? [lv, pool[di % pool.length]] : null;
      }).filter(Boolean);
      side = wordSide(di);
      if (subj.length) {
        const card = ([k, q]) => `<button class="q lv-${k}${S.reveal[k] ? ' open' : ''}" data-act="reveal-${k}" aria-label="${S.reveal[k] ? 'Show question' : 'Show answer'}">
          <span class="qlv">${k.toUpperCase()} · ${q.subj.toUpperCase()}${S.reveal[k] ? ' · ANSWER' : ''}</span>
          <span class="qq serif${!S.reveal[k] && q.q.length > 80 ? ' long' : ''}">${esc(S.reveal[k] ? q.a : q.q)}</span></button>`;
        main = `<section class="main qcard" aria-label="Question of the day"><div class="qhead"><span class="eyebrow gold">QUESTION OF THE DAY</span></div>
          <div class="qgrid">${subj.map(card).join('')}</div></section>`;
      }
    }
    const counts = countdowns(now).map((c2) => `<div class="count"><span class="l">${esc(c2.label)}</span><span class="n">${c2.n}</span></div>`).join('');
    return `<div class="disc${layout}">${header(now, true)}${nowTile}${extra}${side}${main}<section class="counts" aria-label="Countdowns">${counts}</section></div>`;
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (!S.cfg) return;
    if (S.clockOn) return;
    const now = clockNow();
    const keep = {};
    document.querySelectorAll('[data-scroll]').forEach((el) => { keep[el.dataset.scroll] = el.scrollTop; });
    if (S.recipeOpen !== null && !S.recipes[S.recipeOpen]) S.recipeOpen = null;
    $('#app').innerHTML = S.recipeOpen !== null ? recipeView() : mode(now) === 'school' ? schoolView(now) : discoverView(now);
    document.querySelectorAll('[data-scroll]').forEach((el) => { if (keep[el.dataset.scroll]) el.scrollTop = keep[el.dataset.scroll]; });
    const info = $('.art-info');
    if (info && info.scrollHeight > info.clientHeight + 1) info.classList.add('tight');
  }
  function tickHeader() {
    const el = $('#hdrTime');
    if (el) el.textContent = fmt(clockNow());
  }

  // ---------------------------------------------------------------- clock mode
  const CLOCKS = [
    (el) => { el.innerHTML = '<span class="c-aurora" id="ct"></span>'; return (d, t) => { $('#ct').textContent = t; }; },
    (el) => {
      el.innerHTML = `<svg width="440" height="440" viewBox="0 0 440 440" aria-hidden="true" style="position:absolute;left:180px;top:20px">
        <circle cx="220" cy="220" r="205" fill="none" stroke="#1C1712" stroke-width="2"/>
        <circle id="co" cx="220" cy="220" r="205" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-dasharray="1288.05" transform="rotate(-90 220 220)" style="transition:stroke-dashoffset 1s linear"/>
        <circle id="cd" r="9" fill="#F59E0B" style="filter:drop-shadow(0 0 10px #F59E0B)"/></svg><span class="c-orbit-t" id="ct"></span>`;
      return (d, t) => {
        const s = d.getSeconds(), a = (s / 60) * Math.PI * 2;
        $('#ct').textContent = t;
        $('#co').setAttribute('stroke-dashoffset', (1288.05 * (1 - s / 60)).toFixed(1));
        $('#cd').setAttribute('cx', (220 + 205 * Math.sin(a)).toFixed(1));
        $('#cd').setAttribute('cy', (220 - 205 * Math.cos(a)).toFixed(1));
      };
    },
    (el) => {
      el.innerHTML = '<div class="c-stack"><div class="h"><span class="n" id="ch" style="color:#FF6B4A"></span><span class="dot"></span></div><span class="n" id="cm" style="color:#F3E9DC"></span></div>';
      return (d) => { $('#ch').textContent = pad(d.getHours() % 12 || 12); $('#cm').textContent = pad(d.getMinutes()); };
    },
    (el) => {
      el.innerHTML = '<div class="c-fill"><span class="o" id="ct"></span><span class="s" id="cs"></span></div>';
      return (d, t) => { $('#ct').textContent = t; $('#cs').textContent = t; $('#cs').style.clipPath = `inset(${(12 + 76 * (1 - d.getSeconds() / 59)).toFixed(1)}% 0 0 0)`; };
    },
    (el) => { el.innerHTML = '<div class="c-breathe-g"><span class="c-breathe" id="ct"></span></div>'; return (d, t) => { $('#ct').textContent = t; }; },
    (el) => {
      const ring = (r, track, color, id, extra = '') => `<circle cx="230" cy="230" r="${r}" stroke="${track}"/><circle id="${id}" cx="230" cy="230" r="${r}" stroke="${color}" stroke-dasharray="${(2 * Math.PI * r).toFixed(1)}" ${extra}/>`;
      el.innerHTML = `<svg width="460" height="460" viewBox="0 0 460 460" aria-hidden="true" style="position:absolute;left:170px;top:10px"><g transform="rotate(-90 230 230)" fill="none" stroke-linecap="round" stroke-width="12">
        ${ring(214, '#1A1608', '#FBBF24', 'rh')}${ring(190, '#0A1A18', '#2DD4BF', 'rm')}${ring(166, '#0B1720', '#38BDF8', 'rs', 'style="transition:stroke-dashoffset 1s linear"')}</g></svg><span class="c-rings-t" id="ct"></span>`;
      return (d, t) => {
        const h = d.getHours() % 12, m = d.getMinutes(), s = d.getSeconds();
        const off = (r, frac) => (2 * Math.PI * r * (1 - frac)).toFixed(1);
        $('#ct').textContent = t;
        $('#rh').setAttribute('stroke-dashoffset', off(214, (h + m / 60) / 12));
        $('#rm').setAttribute('stroke-dashoffset', off(190, (m + s / 60) / 60));
        $('#rs').setAttribute('stroke-dashoffset', off(166, Math.max(s, 0.5) / 60));
      };
    },
    (el) => {
      const G = { 0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
        2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], 3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
        4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
        6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
        8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
        ':': ['0', '0', '1', '0', '1', '0', '0'] };
      el.innerHTML = '<div class="c-matrix" id="cx"></div>';
      let last = '';
      return (d, t) => {
        if (t === last) return; last = t;
        let html = '';
        for (let r = 0; r < 7; r++) {
          html += '<div class="r">'; let i = 0;
          t.split('').forEach((ch, ci) => {
            if (ci > 0) html += '<i></i>';
            for (const bit of G[ch][r]) {
              i++;
              html += bit === '1' ? `<i class="on" style="animation:tw ${(3 + ((i * 7 + r * 3) % 5) * 0.6).toFixed(1)}s ease-in-out ${(((i * 13 + r * 5) % 17) * 0.23).toFixed(2)}s infinite"></i>` : '<i></i>';
            }
          });
          html += '</div>';
        }
        $('#cx').innerHTML = html;
      };
    },
    (el) => { el.innerHTML = '<span class="c-stripes" id="ct"></span>'; return (d, t) => { $('#ct').textContent = t; }; },    // 9 · Pets: the time inside a dog, cat or mouse body (from the kids' sketches), a new animal every 15 s.
    (el) => {
      const PETS = [
        { k: 'dog', name: 'Dog', say: 'RRRuffff!', ac: '#F6A04D',
          back: `<path class="pl" d="M258,160 C236,104 232,58 246,30 C280,46 316,74 338,100 Z"/>
            <path class="pl" d="M468,86 C500,60 540,62 548,92 C552,118 530,140 506,128 Z"/>
            <path class="pl" d="M520,112 C532,72 560,40 590,30 C614,28 620,56 602,82 C586,104 568,122 556,136 Z"/>
            <g class="pt-wag"><path class="pl fur" d="M236,312 C200,300 170,286 150,272 C130,262 106,262 96,276 C84,288 94,300 82,312 C72,328 90,340 104,338 C118,352 140,352 156,344 C178,352 206,350 234,352"/>
              <path class="pl thin" d="M150,296 C130,300 118,306 110,318 M178,306 C160,316 150,326 146,336"/></g>`,
          front: `<ellipse cx="598" cy="38" rx="13" ry="9" class="nose"/><circle cx="566" cy="70" r="6" class="eye"/>` },
        { k: 'cat', name: 'Cat', say: 'Meowwww', ac: '#F48FB1',
          back: `<g class="pt-twitch"><path class="pl" d="M262,152 L270,26 L354,88 Z"/><path class="pl thin" d="M280,120 L284,62 L326,92"/></g>
            <path class="pl" d="M446,88 L530,26 L540,152 Z"/><path class="pl thin" d="M474,92 L522,62 L524,120"/>
            <g class="pt-swish"><path class="pl thin2" d="M262,392 C226,414 192,414 182,440 C176,460 196,472 212,460 C222,452 214,440 204,444"/></g>`,
          front: `<path class="bow" d="M500,100 C484,80 456,92 470,110 C478,120 494,108 500,100 C506,92 522,80 532,92 C544,106 518,116 500,100 Z"/><circle cx="500" cy="100" r="7" class="bow"/>` },
        { k: 'mouse', name: 'Mouse', say: 'Squeekkkk', ac: '#9EC9FF',
          back: `<g class="pt-twitch"><circle cx="282" cy="104" r="70" class="pl"/><circle cx="282" cy="104" r="42" class="inner"/></g>
            <circle cx="518" cy="104" r="70" class="pl"/><circle cx="518" cy="104" r="42" class="inner"/>
            <g class="pt-wiggle"><path class="pl thin2" d="M236,330 C190,320 172,290 132,300 C96,308 94,342 58,336 C40,334 30,322 26,310"/></g>`,
          front: '' },
      ];
      const tag = (p) => `<g transform="translate(${p.k === 'cat' ? 300 : 520} ${p.k === 'mouse' ? 128 : 120}) rotate(${p.k === 'cat' ? 8 : -8})">
        <path class="tag" d="M-52,-4 C-60,-26 -30,-34 -12,-26 C4,-38 36,-32 44,-18 C66,-14 64,14 44,18 C34,34 2,30 -10,22 C-30,32 -60,22 -52,-4 Z" transform="scale(${p.name.length > 3 ? 1.3 : 1} 1)"/>
        <text class="hand" text-anchor="middle" dominant-baseline="central" font-size="30">${p.name}</text></g>`;
      const bubble = (p) => `<g transform="translate(688 236) rotate(-62)"><g class="bub">
        <path class="pl bubl" d="M-112,-28 H100 A28,28 0 0 1 100,28 H-104 L-146,16 L-112,-4 Z"/>
        <text class="hand" x="-6" y="2" text-anchor="middle" dominant-baseline="central" font-size="34">${p.say}</text></g></g>`;
      el.innerHTML = `<svg class="c-pets" viewBox="0 0 800 480" width="800" height="480" aria-hidden="true">
        ${PETS.map((p) => `<g class="pet" data-p="${p.k}"><g class="breathe">${p.back}</g></g>`).join('')}
        <g class="breathe"><path class="pl head" d="M218,250 C214,140 300,72 410,72 C520,72 596,140 590,252 C586,370 510,438 400,440 C290,440 222,370 218,250 Z"/>
          <circle cx="400" cy="268" r="166" class="pl face"/>
          <text id="ph" class="num" y="272" dominant-baseline="central" font-size="136"></text>
          <circle id="pc1" cy="236" r="9" class="num"/><circle id="pc2" cy="306" r="9" class="num"/>
          <text id="pm" class="num" y="272" dominant-baseline="central" font-size="136"></text></g>
        ${PETS.map((p) => `<g class="pet" data-p="${p.k}"><g class="breathe">${p.front}${tag(p)}</g>${bubble(p)}</g>`).join('')}</svg>`;
      const svgEl = el.querySelector('svg');
      let lastT = '', lastPet = -1;
      const layout = (t) => {
        const [h, m] = t.split(':'), ph = $('#ph'), pm = $('#pm');
        ph.textContent = h; pm.textContent = m;
        let size = 136;
        ph.setAttribute('font-size', size); pm.setAttribute('font-size', size);
        const gap = 36, measure = () => ph.getComputedTextLength() + gap + pm.getComputedTextLength();
        let total = measure();
        if (total > 296) { size = Math.floor(size * 296 / total); ph.setAttribute('font-size', size); pm.setAttribute('font-size', size); total = measure(); }
        const x0 = 400 - total / 2, hw = ph.getComputedTextLength();
        ph.setAttribute('x', x0.toFixed(1)); pm.setAttribute('x', (x0 + hw + gap).toFixed(1));
        ['#pc1', '#pc2'].forEach((id) => $(id).setAttribute('cx', (x0 + hw + gap / 2).toFixed(1)));
      };
      if (document.fonts) document.fonts.ready.then(() => { if (lastT) layout(lastT); });
      return (d, t) => {
        const i = QS.get('pet') ? (Number(QS.get('pet')) - 1) % PETS.length : Math.floor(Date.now() / 15000) % PETS.length; // testing aid: ?pet=1|2|3
        if (i !== lastPet) {
          lastPet = i;
          svgEl.style.setProperty('--ac', PETS[i].ac);
          svgEl.querySelectorAll('.pet').forEach((g) => g.classList.toggle('on', g.dataset.p === PETS[i].k));
        }
        if (t !== lastT) { lastT = t; layout(t); }
        svgEl.classList.toggle('tick', d.getSeconds() % 2 === 0);
      };
    },
  ];
  function clockTick() {
    if (!S.clockOn || !S.clockUpdate) return;
    const d = new Date();
    S.clockUpdate(d, fmt(d));
  }
  function enterClock() {
    let idx = 0;
    const force = Number(QS.get('clock')); // testing aid: ?clock=N (1-9) opens that clock style
    if (force >= 1 && force <= CLOCKS.length) idx = force - 1;
    else try { idx = (parseInt(localStorage.getItem('mp.clock') || '-1', 10) + 1) % CLOCKS.length; localStorage.setItem('mp.clock', String(idx)); }
    catch (e) { idx = Math.floor(Math.random() * CLOCKS.length); }
    const el = $('#clock');
    el.hidden = false;
    S.clockOn = true;
    S.clockUpdate = CLOCKS[idx](el);
    clockTick();
  }
  function exitClock() {
    S.clockOn = false; S.clockUpdate = null;
    const el = $('#clock'); el.hidden = true; el.innerHTML = '';
    render();
  }

  // ---------------------------------------------------------------- interaction
  function touched() {
    S.lastTouch = Date.now();
    clearTimeout(S.idleTimer);
    S.idleTimer = setTimeout(idleReset, (S.cfg?.discover?.idleResetSec || 180) * 1000);
  }
  // An open recipe stays put while you cook (up to 2 hours without a touch); everything else resets after idleResetSec.
  const RECIPE_HOLD_MS = 2 * 3600e3;
  function idleReset() {
    if (S.recipeOpen !== null && Date.now() - S.lastTouch < RECIPE_HOLD_MS) { S.idleTimer = setTimeout(idleReset, RECIPE_HOLD_MS - (Date.now() - S.lastTouch)); return; }
    S.recipeOpen = null; S.view = null; S.look = false; S.full = false; S.autoAt = 0; render(); autoTick();
  }

  // Evenings and weekends: rotate full-screen art → question → full-screen clock on a timer.
  // Any touch pauses the rotation until the idle reset (idleResetSec) passes.
  function autoWindow(now) {
    if (!S.cfg || mode(now) !== 'discover') return false;
    return !isSchoolDay(now) || minsOf(now) >= hm(S.cfg.discover.cycleFrom || '17:00');
  }
  function autoTick() {
    if (QS.get('clock') || QS.get('art') || QS.get('view')) return; // ?clock / ?art / ?view hold still for testing
    if (S.recipeOpen !== null) return; // no art / clock rotation while a recipe is open
    const now = clockNow();
    if (!autoWindow(now)) { S.autoStep = -1; S.autoAt = 0; return; }
    const idleMs = (S.cfg.discover.idleResetSec || 180) * 1000;
    if (Date.now() - S.lastTouch < idleMs) return;
    if (S.autoAt && Date.now() - S.autoAt < (Number(QS.get('cycle')) || S.cfg.discover.cycleSec || 300) * 1000  /* testing aid: ?cycle=SECONDS */) return;
    S.autoAt = Date.now();
    S.autoStep = (S.autoStep + 1) % 3;
    S.look = false;
    if (S.autoStep === 2) { if (!S.clockOn) enterClock(); return; }
    S.view = S.autoStep === 0 ? 'art' : 'learn';
    S.full = S.autoStep === 0;
    if (S.clockOn) exitClock(); else render();
  }
  document.addEventListener('pointerdown', () => {
    touched();
    // At night the backlight is off; any touch wakes it for a couple of minutes.
    fetch('/api/wake', { method: 'POST' }).catch(() => {});
  }, true);
  $('#clock').addEventListener('click', exitClock);
  $('#app').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, now = clockNow();
    if (act === 'clock') {
      // One button cycles the Discover screens: art → question → clock → art.
      S.look = false; S.full = false;
      if ((S.view || defaultView(now)) === 'art') S.view = 'learn';
      else { S.view = 'art'; touched(); enterClock(); return; }
    }
    if (act === 'look') S.look = !S.look;
    if (act === 'lastcall-ok' && S.lastCall) S.lastCallOk = +S.lastCall.hero.depart; // hide until the next last call
    if (act === 'full') S.full = true;
    if (act === 'unfull') S.full = false;
    if (act.startsWith('reveal-')) S.reveal[act.slice(7)] = !S.reveal[act.slice(7)];
    if (/^recipe-\d+$/.test(act)) { S.recipeOpen = Number(act.slice(7)); S.full = false; }
    if (act === 'recipe-close') S.recipeOpen = null;
    if (act.startsWith('tick-') && S.recipeOpen !== null) { const k = S.recipes[S.recipeOpen].id + act.slice(5); S.recipeDone[k] = !S.recipeDone[k]; }
    if ((act === 'vote-up' || act === 'vote-down') && S.recipeOpen !== null) {
      const r = S.recipes[S.recipeOpen], want = act === 'vote-up' ? 1 : -1;
      r.vote = r.vote === want ? 0 : want; // tap again to undo
      fetch('/api/recipes/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, vote: r.vote }) }).catch((e) => console.warn(e));
    }
    touched();
    render();
  });

  // ---------------------------------------------------------------- data loops
  async function loadConfig() { S.cfg = await getJSON('/api/config'); S.cal = (await getJSON('/api/calendar')).entries || []; }
  async function loadWeather() { try { S.wx = await getJSON('/api/weather'); } catch (e) { console.warn(e); } }
  async function loadTransit() {
    if (!S.cfg || mode(clockNow()) !== 'school') return;
    try { S.tr = await getJSON('/api/transit'); S.trError = false; } catch (e) { S.trError = true; console.warn(e); }
  }
  async function loadRecipes() {
    try {
      const d = await getJSON('/api/recipes');
      const fresh = d.recipes || [];
      // Don't swap the list out from under an open recipe; pick it up once it's closed.
      if (S.recipeOpen === null) S.recipes = fresh;
    } catch (e) { console.warn(e); }
  }
  async function loadContent() {
    const [art, qs, words] = await Promise.all([getJSON('content/art.json'), getJSON('content/questions.json'), getJSON('content/words.json')]);
    S.art = art; S.qs = qs; S.words = words;
  }

  async function boot() {
    try { await Promise.all([loadConfig(), loadContent()]); }
    catch (e) { $('#app').innerHTML = `<div class="boot">Waiting for the Morning Pi server… (${esc(e.message)})</div>`; setTimeout(boot, 5000); return; }
    await Promise.all([loadWeather(), loadTransit(), loadRecipes()]);
    if (QS.get('recipe') && S.recipes[Number(QS.get('recipe')) - 1]) S.recipeOpen = Number(QS.get('recipe')) - 1;
    render();
    if (QS.get('clock')) enterClock();
    setInterval(tickHeader, 1000);
    setInterval(clockTick, 1000);
    setInterval(autoTick, 5000);
    setInterval(render, 15000);
    setInterval(async () => { await loadTransit(); render(); }, 30000);
    setInterval(async () => { await loadWeather(); render(); }, 10 * 60000);
    setInterval(async () => { await loadRecipes(); render(); }, 30 * 60000);
    setInterval(async () => { try { await loadConfig(); } catch (e) { console.warn(e); } }, 5 * 60000);
    // Reload once a night to pick up new code and content.
    const n = new Date(), reloadAt = new Date(n); reloadAt.setHours(3, 0, 0, 0); if (reloadAt <= n) reloadAt.setDate(reloadAt.getDate() + 1);
    setTimeout(() => location.reload(), reloadAt - n);
  }
  boot();
})();
