'use strict';
/* Morning Pi — kitchen display UI.
 * Modes: "school" (school-day mornings: weather slots + bus), "discover" (rest of the time:
 * now-weather, art / question+word, countdowns) and a full-screen clock overlay. */
(() => {
  const S = {
    cfg: null, cal: [], wx: null, tr: null, trError: false,
    art: [], qs: [], words: { en: [], fr: [] },
    view: null, look: false, reveal: {}, revealDay: null, idleTimer: null,
    clockOn: false, clockUpdate: null, clockMinute: null,
  };

  // ---------------------------------------------------------------- helpers
  // Testing aid: ?at=2026-11-16T08:30 pretends the display started at that local time.
  const QS = new URLSearchParams(location.search);
  const AT = QS.get('at');
  const FORCE_MODE = QS.get('mode'); // testing aid: ?mode=school or ?mode=discover
  if (QS.get('full')) S.full = true; // testing aid: ?full=1 opens today's art full screen
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
    const btn = withClockBtn ? `<button class="icon-btn" data-act="clock" aria-label="Clock mode">${svg(P.clock, 18, 'currentColor', 'aria-hidden="true"')}</button>` : '';
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

    return `<div class="school">${header(now, false)}<div class="school-body">
      <section class="wx-col" aria-label="Weather">${nowCard}<div class="slots">${slots}</div>${strip}</section>
      <section class="bus-col" aria-label="Getting to school">${rec}${busBlock(now)}${otherStops(now)}</section></div></div>`;
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
    const line = (b) => `Leave ${fmt(b.leave)} → ${badge(sr.route, 'sm')} ${fmt(b.depart)} → Seated ${fmt(b.seated)}`;
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
    const rows = [];
    const lastMissed = buses.filter((b) => b.missed && now - b.leave < 10 * 60000).pop();
    if (lastMissed) rows.push(`<div class="row missed"><span class="row-main">${line(lastMissed).replace(badge(sr.route, 'sm'), badge(sr.route, 'sm off'))}</span><span class="row-tag missed">missed</span></div>`);
    for (const b of live.slice(1)) {
      if (rows.length >= 2) break;
      const tag = b.late > 0 ? `<span class="row-tag late">${b.late} min late</span>` : `<span class="row-tag ok">${-b.late} min spare</span>`;
      rows.push(`<div class="row"><span class="row-main">${line(b)}</span>${tag}</div>`);
    }
    return heroHtml + (rows.length ? `<div class="rows">${rows.join('')}</div>` : '');
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

  function discoverView(now) {
    const view = S.view || defaultView(now);
    const di = dayIndex(now);
    if (S.revealDay !== di) { S.reveal = {}; S.revealDay = di; }
    const c = S.wx && S.wx.current;
    const nowTile = c ? `<div class="now-tile">${wxIcon(c.weather_code, c.is_day === 1, 40)}<div style="display:flex;flex-direction:column;gap:2px">
        <span class="eyebrow" style="color:var(--muted);letter-spacing:1px;font-weight:700">NOW</span><span class="t">${deg(c.temperature_2m)}</span>
        <span class="f">feels ${deg(c.apparent_temperature)}</span><span class="w">${c.wind_gusts_10m >= 30 ? `gusts ${r0(c.wind_gusts_10m)} km/h` : `wind ${r0(c.wind_speed_10m)} km/h`}</span></div></div>`
      : '<div class="now-tile"><span class="w">Weather loading…</span></div>';
    const dots = (i) => `<div class="dots" aria-label="Item ${i + 1} of 2"><span class="${i === 0 ? 'on' : ''}"></span><span class="${i === 1 ? 'on' : ''}"></span></div>`;
    const next = '<button class="btn" data-act="next" style="height:36px">Next ›</button>';
    let side = '', main = '';
    if (view === 'art' && S.art.length) {
      const a = S.art[di % S.art.length];
      side = `<section class="side" aria-label="About the art"><span class="eyebrow gold">ART OF THE DAY${a.tag ? ' · ' + esc(a.tag.toUpperCase()) : ''}</span>
        <span class="art-title serif">${esc(a.title)}</span><span class="art-meta">${esc(a.artist)} · ${esc(a.year)}${a.place ? ' · ' + esc(a.place) : ''}</span>
        <button class="btn" data-act="look" style="align-self:flex-start">${S.look ? 'Hide ▴' : 'Look closer ▾'}</button>
        <div class="side-foot">${dots(0)}${next}</div></section>`;
      main = `<section class="main art-frame" aria-label="Art of the day"><button class="art-tap" data-act="full" aria-label="Show full screen"><img src="content/art/${esc(a.file)}" alt="${esc(a.title)} by ${esc(a.artist)}"></button>
        ${S.full ? `<button class="art-full" data-act="unfull" aria-label="Back to dashboard"><img src="content/art/${esc(a.file)}" alt=""></button>` : ''}
        ${S.look ? `<div class="look"><span class="eyebrow green">CAN YOU SPOT IT?</span><p class="spot">${esc(a.spot)}</p><p class="story">${esc(a.story)}</p></div>` : ''}</section>`;
    } else {
      const subj = ['math', 'physics', 'biology'].map((k) => { const l = (S.qs && S.qs[k]) || []; return l.length ? [k, l[di % l.length]] : null; }).filter(Boolean);
      const lang = di % 2 === 0 ? 'en' : 'fr';
      const list = S.words[lang] || [];
      const w = list.length ? list[Math.floor(di / 2) % list.length] : null;
      if (w) {
        side = `<section class="side" aria-label="Word of the day"><span class="eyebrow blue">${lang === 'fr' ? 'MOT DU JOUR · FRENCH' : 'WORD OF THE DAY'}</span>
          <span class="word serif${w.w.length > 10 ? ' long' : ''}">${esc(w.w)}</span><span class="word-say">${w.say ? `say “${esc(w.say)}” · ` : ''}${esc(w.pos)}</span>
          <span class="word-def">${esc(w.def)}</span><span class="word-ex" style="margin-top:auto">${lang === 'fr' ? `« ${esc(w.ex)} »` : esc(w.ex)}</span>
          ${w.exEn ? `<span class="word-en">${esc(w.exEn)}</span>` : ''}</section>`;
      }
      if (subj.length) {
        const card = ([k, q]) => `<button class="q${S.reveal[k] ? ' open' : ''}" data-act="reveal-${k}" aria-label="${S.reveal[k] ? 'Show question' : 'Show answer'}">
          <span class="qq serif${!S.reveal[k] && q.q.length > 80 ? ' long' : ''}">${esc(S.reveal[k] ? q.a : q.q)}</span></button>`;
        main = `<section class="main qcard" aria-label="Question of the day"><div class="qhead"><span class="eyebrow gold">QUESTION OF THE DAY</span>
          <div style="display:flex;align-items:center;gap:12px">${dots(1)}${next}</div></div>
          <div class="qgrid">${subj.map(card).join('')}</div></section>`;
      }
    }
    const counts = countdowns(now).map((c2) => `<div class="count"><span class="l">${esc(c2.label)}</span><span class="n">${c2.n}</span></div>`).join('');
    return `<div class="disc">${header(now, true)}${nowTile}${side}${main}<section class="counts" aria-label="Countdowns">${counts}</section></div>`;
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (!S.cfg) return;
    if (S.clockOn) return;
    const now = clockNow();
    $('#app').innerHTML = mode(now) === 'school' ? schoolView(now) : discoverView(now);
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
    (el) => { el.innerHTML = '<span class="c-breathe" id="ct"></span>'; return (d, t) => { $('#ct').textContent = t; }; },
    (el) => {
      const ring = (r, track, color, id, extra = '') => `<circle cx="230" cy="230" r="${r}" stroke="${track}"/><circle id="${id}" cx="230" cy="230" r="${r}" stroke="${color}" stroke-dasharray="${(2 * Math.PI * r).toFixed(1)}" ${extra}/>`;
      el.innerHTML = `<svg width="460" height="460" viewBox="0 0 460 460" aria-hidden="true" style="position:absolute;left:170px;top:10px"><g transform="rotate(-90 230 230)" fill="none" stroke-linecap="round" stroke-width="12">
        ${ring(214, '#1A0D14', '#F472B6', 'rh')}${ring(190, '#150F1F', '#A78BFA', 'rm')}${ring(166, '#0B1720', '#38BDF8', 'rs', 'style="transition:stroke-dashoffset 1s linear"')}</g></svg><span class="c-rings-t" id="ct"></span>`;
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
    (el) => { el.innerHTML = '<span class="c-stripes" id="ct"></span>'; return (d, t) => { $('#ct').textContent = t; }; },
  ];
  function clockTick() {
    if (!S.clockOn || !S.clockUpdate) return;
    const d = new Date();
    S.clockUpdate(d, fmt(d));
  }
  function enterClock() {
    let idx = 0;
    try { idx = (parseInt(localStorage.getItem('mp.clock') || '-1', 10) + 1) % CLOCKS.length; localStorage.setItem('mp.clock', String(idx)); }
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
    clearTimeout(S.idleTimer);
    S.idleTimer = setTimeout(() => { S.view = null; S.look = false; S.full = false; render(); }, (S.cfg?.discover?.idleResetSec || 180) * 1000);
  }
  document.addEventListener('pointerdown', () => {
    // At night the backlight is off; any touch wakes it for a couple of minutes.
    fetch('/api/wake', { method: 'POST' }).catch(() => {});
  }, true);
  $('#clock').addEventListener('click', exitClock);
  $('#app').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, now = clockNow();
    if (act === 'clock') { enterClock(); return; }
    if (act === 'next') { S.view = (S.view || defaultView(now)) === 'art' ? 'learn' : 'art'; S.look = false; }
    if (act === 'look') S.look = !S.look;
    if (act === 'full') S.full = true;
    if (act === 'unfull') S.full = false;
    if (act.startsWith('reveal-')) S.reveal[act.slice(7)] = !S.reveal[act.slice(7)];
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
  async function loadContent() {
    const [art, qs, words] = await Promise.all([getJSON('content/art.json'), getJSON('content/questions.json'), getJSON('content/words.json')]);
    S.art = art; S.qs = qs; S.words = words;
  }

  async function boot() {
    try { await Promise.all([loadConfig(), loadContent()]); }
    catch (e) { $('#app').innerHTML = `<div class="boot">Waiting for the Morning Pi server… (${esc(e.message)})</div>`; setTimeout(boot, 5000); return; }
    await Promise.all([loadWeather(), loadTransit()]);
    render();
    setInterval(tickHeader, 1000);
    setInterval(clockTick, 1000);
    setInterval(render, 15000);
    setInterval(async () => { await loadTransit(); render(); }, 30000);
    setInterval(async () => { await loadWeather(); render(); }, 10 * 60000);
    setInterval(async () => { try { await loadConfig(); } catch (e) { console.warn(e); } }, 5 * 60000);
    // Reload once a night to pick up new code and content.
    const n = new Date(), reloadAt = new Date(n); reloadAt.setHours(3, 0, 0, 0); if (reloadAt <= n) reloadAt.setDate(reloadAt.getDate() + 1);
    setTimeout(() => location.reload(), reloadAt - n);
  }
  boot();
})();
