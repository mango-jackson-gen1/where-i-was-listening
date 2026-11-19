/* where i was listening · 2014–2022
 *
 * single-file frontend. loads map_data.json + a small world-atlas land outline,
 * renders an Equal Earth map with hand-drawn (rough.js) circles per city, and
 * advances a day-by-day playhead that inks circles in proportion to accumulated
 * listening time. circles never fade.
 */

const LAND_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json";
const DATA_URL = "map_data.json";

// 1× speed = days advanced per real-time second. A nine-year span at 14 d/s
// completes in ~3:50, which is about right for the "watch it unfold" feel.
const BASE_DAYS_PER_SEC = 14;

// at full ink, fill-opacity caps here. anything above this for visual interest only.
const MAX_INK_OPACITY = 0.78;

let DATA = null;
let LAND = null;

// derived state
let dayIndexByISO = new Map();
let cityById = new Map();
let cumMsByCity = new Map();   // cityId -> Float32Array of length nDays (running total of ms_played up to and including each day)
let annotationsByDay = new Map(); // ISO -> array of annotations

// runtime
let currentDayIdx = 0;
let playing = false;
let speedMul = 2;
let lastFrameTime = 0;
let pulseUntil = new Map();    // cityId -> timestamp ms; circle pulses brighter briefly when active
let surfacedAnnotations = new Set(); // annotation indices already in the feed

// dom
let mapSvg, mapG, citiesG, labelsG, annotArrowsG;
let projection, geoPath;
let roughSvg;
let timelineSvg, timelineG, playheadEl;
let xScaleTime;
let dateDisplay, playBtn, annotationCard, cityListEl, annotationFeedEl;

const MAP_W = 980, MAP_H = 580;
const TL_PAD_L = 24, TL_PAD_R = 24, TL_H = 70;

// ---------- Boot ----------

(async function boot() {
  [DATA, LAND] = await Promise.all([
    d3.json(DATA_URL),
    d3.json(LAND_URL),
  ]);
  precompute();
  buildMap();
  buildTimeline();
  buildCityPanel();
  buildAnnotationFeed();
  wireControls();
  render();
  requestAnimationFrame(loop);
})();

// ---------- Precompute ----------

function precompute() {
  DATA.days.forEach((d, i) => dayIndexByISO.set(d.day, i));
  DATA.cities.forEach(c => cityById.set(c.id, c));

  const nDays = DATA.days.length;
  // initialize zero arrays for every city
  DATA.cities.forEach(c => cumMsByCity.set(c.id, new Float32Array(nDays)));

  // per-day delta into per-city running total
  DATA.days.forEach((d, i) => {
    d.plays.forEach(p => {
      const arr = cumMsByCity.get(p.city_id);
      if (arr) arr[i] = p.ms;
    });
  });
  // running sum
  for (const arr of cumMsByCity.values()) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) {
      s += arr[i];
      arr[i] = s;
    }
  }

  DATA.annotations.forEach(a => {
    if (!annotationsByDay.has(a.day)) annotationsByDay.set(a.day, []);
    annotationsByDay.get(a.day).push(a);
  });
}

// ---------- Map ----------

function buildMap() {
  mapSvg = d3.select("#map")
    .attr("viewBox", `0 0 ${MAP_W} ${MAP_H}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  projection = d3.geoEqualEarth()
    .scale(190)
    .translate([MAP_W / 2, MAP_H / 2 + 14]);
  geoPath = d3.geoPath(projection);

  const land = topojson.feature(LAND, LAND.objects.land);

  mapG = mapSvg.append("g").attr("class", "map-layer");

  // soft tinted ocean? leave the paper showing through for the journal feel.
  // hand-drawn land outline via rough.js
  roughSvg = rough.svg(mapSvg.node());
  const landNode = roughSvg.path(geoPath(land), {
    roughness: 1.6,
    bowing: 0.6,
    stroke: "rgba(58, 46, 39, 0.32)",
    strokeWidth: 0.5,
    fill: "rgba(58, 46, 39, 0.04)",
    fillStyle: "solid",
    seed: 7,
  });
  mapG.node().appendChild(landNode);

  annotArrowsG = mapG.append("g").attr("class", "annotation-arrows");
  citiesG = mapG.append("g").attr("class", "cities");
  labelsG = mapG.append("g").attr("class", "labels");

  // build one rough.js circle per city, keyed
  for (const c of DATA.cities) {
    const [cx, cy] = projection([c.lon, c.lat]) || [-9999, -9999];
    if (!isFinite(cx) || !isFinite(cy)) continue;

    const r = radiusForCity(c);

    const seed = stringHash(c.id);
    const circleNode = roughSvg.circle(cx, cy, r * 2, {
      roughness: 1.4,
      bowing: 1,
      stroke: "rgb(58, 46, 39)",
      strokeWidth: 0.9,
      fill: "rgb(58, 46, 39)",
      fillStyle: "solid",
      seed,
    });
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "city-circle");
    g.setAttribute("data-city", c.id);
    g.appendChild(circleNode);
    citiesG.node().appendChild(g);

    g.addEventListener("mouseenter", () => highlightCity(c.id, true));
    g.addEventListener("mouseleave", () => highlightCity(c.id, false));

    // label
    const lab = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lab.setAttribute("class", "city-label");
    lab.setAttribute("x", cx + r + 3);
    lab.setAttribute("y", cy + 4);
    lab.setAttribute("data-city", c.id);
    lab.textContent = c.name;
    labelsG.node().appendChild(lab);
  }
}

function radiusForCity(c) {
  // hours total. 3 buckets, lightly varied so it feels drawn.
  const hr = c.total_ms / 3_600_000;
  let base;
  if (hr >= 100) base = 13;
  else if (hr >= 1) base = 8;
  else base = 4.5;
  // tiny per-city wobble seeded by name hash
  const j = (stringHash(c.id) % 100) / 100;
  return base + j * 1.4 - 0.7;
}

function highlightCity(cityId, on) {
  const li = cityListEl.querySelector(`li[data-city="${cssEscape(cityId)}"]`);
  if (li) li.classList.toggle("highlight", on);
  const g = citiesG.node().querySelector(`g[data-city="${cssEscape(cityId)}"]`);
  if (g) g.style.filter = on ? "drop-shadow(0 0 1px rgba(58,46,39,0.4))" : "";
}

// ---------- Timeline ----------

function buildTimeline() {
  timelineSvg = d3.select("#timeline");
  const w = timelineSvg.node().clientWidth || 1100;
  timelineSvg.attr("viewBox", `0 0 ${w} ${TL_H}`);

  const days = DATA.days.map(d => new Date(d.day));
  const dailyTotals = DATA.daily_total_ms.map(([_, ms]) => ms);

  xScaleTime = d3.scaleTime()
    .domain([days[0], days[days.length - 1]])
    .range([TL_PAD_L, w - TL_PAD_R]);

  const yScale = d3.scaleSqrt()
    .domain([0, d3.max(dailyTotals)])
    .range([TL_H - 18, 4]);

  // smooth area chart
  const area = d3.area()
    .x((_, i) => xScaleTime(days[i]))
    .y0(TL_H - 18)
    .y1(d => yScale(d))
    .curve(d3.curveMonotoneX);

  timelineG = timelineSvg.append("g");
  timelineG.append("path")
    .datum(dailyTotals)
    .attr("class", "area-fill")
    .attr("d", area);

  // axis baseline
  timelineG.append("line")
    .attr("class", "timeline-axis")
    .attr("x1", TL_PAD_L)
    .attr("x2", w - TL_PAD_R)
    .attr("y1", TL_H - 18)
    .attr("y2", TL_H - 18);

  // year ticks
  const years = d3.timeYear.range(d3.timeYear.floor(days[0]), d3.timeYear.ceil(days[days.length - 1]));
  for (const yr of years) {
    const x = xScaleTime(yr);
    timelineG.append("line")
      .attr("class", "year-tick")
      .attr("x1", x).attr("x2", x)
      .attr("y1", TL_H - 18).attr("y2", TL_H - 12);
    timelineG.append("text")
      .attr("class", "year-label")
      .attr("x", x).attr("y", TL_H - 2)
      .attr("text-anchor", "middle")
      .text(yr.getFullYear());
  }

  // annotation tick marks
  for (const a of DATA.annotations) {
    const x = xScaleTime(new Date(a.day));
    timelineG.append("circle")
      .attr("class", "annotation-mark")
      .attr("cx", x)
      .attr("cy", TL_H - 18)
      .attr("r", 2.5)
      .append("title").text(`${a.title} — ${a.day}`);
  }

  // playhead
  playheadEl = timelineG.append("line")
    .attr("class", "playhead")
    .attr("y1", 2)
    .attr("y2", TL_H - 4);

  // scrubbing
  const surface = timelineSvg.node();
  let dragging = false;
  function setFromPointer(evt) {
    const rect = surface.getBoundingClientRect();
    const xPx = (evt.clientX - rect.left) / rect.width * w;
    const t = xScaleTime.invert(xPx);
    setDayByDate(t);
  }
  surface.addEventListener("pointerdown", e => {
    dragging = true;
    surface.setPointerCapture(e.pointerId);
    setPlaying(false);
    setFromPointer(e);
  });
  surface.addEventListener("pointermove", e => { if (dragging) setFromPointer(e); });
  surface.addEventListener("pointerup", e => { dragging = false; });
}

function setDayByDate(date) {
  const iso = date.toISOString().slice(0, 10);
  const idx = dayIndexByISO.get(iso);
  if (idx != null) currentDayIdx = idx;
  else {
    // closest valid index
    let lo = 0, hi = DATA.days.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (DATA.days[m].day < iso) lo = m + 1; else hi = m;
    }
    currentDayIdx = lo;
  }
  // re-render rebuilds annotation feed against new playhead history
  rebuildAnnotationStateOnScrub();
  render();
}

// ---------- City panel ----------

function buildCityPanel() {
  cityListEl = document.getElementById("city-list");
}

function refreshCityPanel() {
  const rows = [];
  for (const c of DATA.cities) {
    const arr = cumMsByCity.get(c.id);
    const ms = arr[currentDayIdx];
    if (ms <= 0) continue;
    rows.push({ city: c, ms });
  }
  rows.sort((a, b) => b.ms - a.ms);

  // efficient minimal-rebuild: keep top 30 visible to avoid clutter / scroll runaway
  const top = rows.slice(0, 40);
  const maxHr = top[0] ? top[0].ms / 3_600_000 : 1;
  cityListEl.innerHTML = top.map(({ city, ms }) => {
    const hr = ms / 3_600_000;
    const opacity = Math.min(MAX_INK_OPACITY, ms / DATA.meta.residency_threshold_ms + 0.08);
    return `<li data-city="${escapeHtml(city.id)}">
      <span class="dot" style="opacity:${opacity.toFixed(2)}"></span>
      <span class="city-name">${escapeHtml(city.name)}</span>
      <span class="hours">${hr.toFixed(1)} hr</span>
    </li>`;
  }).join("");

  // wire hover handlers
  cityListEl.querySelectorAll("li").forEach(li => {
    const cid = li.dataset.city;
    li.addEventListener("mouseenter", () => highlightCity(cid, true));
    li.addEventListener("mouseleave", () => highlightCity(cid, false));
  });
}

// ---------- Annotation feed ----------

function buildAnnotationFeed() {
  annotationFeedEl = document.getElementById("annotation-feed");
  annotationCard = document.getElementById("annotation-card");
}

function rebuildAnnotationStateOnScrub() {
  surfacedAnnotations.clear();
  const currentDay = DATA.days[currentDayIdx].day;
  DATA.annotations.forEach((a, i) => {
    if (a.day <= currentDay) surfacedAnnotations.add(i);
  });
  refreshAnnotationFeed();
  hideAnnotationCard();
}

function refreshAnnotationFeed() {
  const items = [];
  DATA.annotations.forEach((a, i) => {
    if (!surfacedAnnotations.has(i)) return;
    items.push({ a, i });
  });
  // newest first
  items.reverse();
  annotationFeedEl.innerHTML = items.map(({ a, i }) =>
    `<li data-idx="${i}"><span class="feed-title">${escapeHtml(a.title)}</span><span class="feed-day">${formatLongDate(a.day)}</span></li>`
  ).join("");
  annotationFeedEl.querySelectorAll("li").forEach(li => {
    li.addEventListener("click", () => {
      const idx = +li.dataset.idx;
      const a = DATA.annotations[idx];
      const dayIdx = dayIndexByISO.get(a.day);
      if (dayIdx != null) {
        currentDayIdx = dayIdx;
        rebuildAnnotationStateOnScrub();
        showAnnotationCard(a);
        render();
      }
    });
  });
}

let annotationCardHideTimer = null;
function showAnnotationCard(a) {
  annotationCard.innerHTML = `
    <span class="title">${escapeHtml(a.title)}</span>
    <span class="body">${escapeHtml(a.body)}</span>
    <span class="day">${formatLongDate(a.day)}</span>`;
  annotationCard.classList.add("visible");
  if (annotationCardHideTimer) clearTimeout(annotationCardHideTimer);
  annotationCardHideTimer = setTimeout(hideAnnotationCard, 6500);
}
function hideAnnotationCard() {
  annotationCard.classList.remove("visible");
  if (annotationCardHideTimer) { clearTimeout(annotationCardHideTimer); annotationCardHideTimer = null; }
}

// ---------- Controls ----------

function wireControls() {
  dateDisplay = document.getElementById("date-display");
  playBtn = document.getElementById("play-btn");
  playBtn.addEventListener("click", () => setPlaying(!playing));

  document.getElementById("step-back").addEventListener("click", () => {
    setPlaying(false);
    currentDayIdx = Math.max(0, currentDayIdx - 1);
    rebuildAnnotationStateOnScrub();
    render();
  });
  document.getElementById("step-fwd").addEventListener("click", () => {
    setPlaying(false);
    currentDayIdx = Math.min(DATA.days.length - 1, currentDayIdx + 1);
    rebuildAnnotationStateOnScrub();
    render();
  });

  document.querySelectorAll(".speed-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".speed-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      speedMul = parseFloat(btn.dataset.speed);
    });
  });

  window.addEventListener("keydown", e => {
    if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === "ArrowLeft") {
      setPlaying(false);
      currentDayIdx = Math.max(0, currentDayIdx - 1);
      rebuildAnnotationStateOnScrub();
      render();
    } else if (e.key === "ArrowRight") {
      setPlaying(false);
      currentDayIdx = Math.min(DATA.days.length - 1, currentDayIdx + 1);
      rebuildAnnotationStateOnScrub();
      render();
    }
  });
}

function setPlaying(on) {
  playing = on;
  playBtn.textContent = playing ? "❚❚" : "▶";
  if (playing && currentDayIdx >= DATA.days.length - 1) {
    currentDayIdx = 0;
    rebuildAnnotationStateOnScrub();
  }
  lastFrameTime = 0;
}

// ---------- Animation ----------

function loop(t) {
  if (!lastFrameTime) lastFrameTime = t;
  const dt = (t - lastFrameTime) / 1000;
  lastFrameTime = t;

  if (playing) {
    const advance = BASE_DAYS_PER_SEC * speedMul * dt;
    let prev = currentDayIdx;
    currentDayIdx += advance;

    // surface any annotations crossed since last frame
    const prevDay = DATA.days[Math.floor(prev)].day;
    const nowDay = DATA.days[Math.min(DATA.days.length - 1, Math.floor(currentDayIdx))].day;
    DATA.annotations.forEach((a, i) => {
      if (!surfacedAnnotations.has(i) && a.day > prevDay && a.day <= nowDay) {
        surfacedAnnotations.add(i);
        showAnnotationCard(a);
        refreshAnnotationFeed();
      }
    });

    // record pulse for cities active *today* (the integer day we're on)
    const todayPlays = DATA.days[Math.floor(currentDayIdx)].plays;
    for (const p of todayPlays) {
      pulseUntil.set(p.city_id, t + 1100);
    }

    if (currentDayIdx >= DATA.days.length - 1) {
      currentDayIdx = DATA.days.length - 1;
      setPlaying(false);
    }
    render(t);
  } else {
    // still update pulse decay even when paused so it fades out
    if (pulseUntil.size) renderPulse(t);
  }
  requestAnimationFrame(loop);
}

// ---------- Render ----------

let lastRenderedDay = -1;
function render(t) {
  const di = Math.floor(currentDayIdx);
  const dayISO = DATA.days[di].day;

  // city circle ink + label visibility
  for (const c of DATA.cities) {
    const arr = cumMsByCity.get(c.id);
    const ms = arr[di];
    const g = citiesG.node().querySelector(`g[data-city="${cssEscape(c.id)}"]`);
    const lab = labelsG.node().querySelector(`text[data-city="${cssEscape(c.id)}"]`);
    if (!g) continue;
    if (ms > 0) {
      const o = Math.min(MAX_INK_OPACITY, ms / DATA.meta.residency_threshold_ms + 0.08);
      g.style.setProperty("--ink-density", o.toFixed(3));
      g.classList.add("visited");
      if (lab) {
        const labelOpacity = Math.min(0.9, 0.35 + ms / (DATA.meta.residency_threshold_ms * 0.5));
        if (ms / 3_600_000 < 1) lab.classList.add("faint"); else lab.classList.remove("faint");
        lab.classList.add("visible");
        lab.style.fillOpacity = labelOpacity.toFixed(2);
      }
    } else {
      g.classList.remove("visited");
      g.style.setProperty("--ink-density", "0");
      if (lab) { lab.classList.remove("visible"); lab.style.fillOpacity = 0; }
    }
  }

  // playhead
  if (xScaleTime) {
    const x = xScaleTime(new Date(dayISO));
    playheadEl.attr("x1", x).attr("x2", x);
  }

  // date display
  dateDisplay.textContent = formatLongDate(dayISO);

  // city panel (only rebuild when the day index moved by at least 1)
  if (di !== lastRenderedDay) {
    refreshCityPanel();
    lastRenderedDay = di;
  }

  if (t != null) renderPulse(t);
}

function renderPulse(t) {
  for (const [cid, until] of pulseUntil) {
    const g = citiesG.node().querySelector(`g[data-city="${cssEscape(cid)}"]`);
    if (!g) { pulseUntil.delete(cid); continue; }
    const remaining = until - t;
    if (remaining <= 0) {
      g.classList.remove("pulse");
      pulseUntil.delete(cid);
      continue;
    }
    g.classList.add("pulse");
    const k = remaining / 1100;
    const baseOpacity = parseFloat(g.style.getPropertyValue("--ink-density") || 0);
    g.style.setProperty("--pulse-fill", (baseOpacity + 0.18 * k).toFixed(3));
  }
}

// ---------- Helpers ----------

function stringHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return Math.abs(h);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
}
function cssEscape(s) { return s.replace(/(["\\])/g, "\\$1"); }
function formatLongDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}

/* ---------- Year-by-year section ----------
 * Independent of the map. Loads web/year_data.json, renders a tab strip of
 * nine years, an active-year card, and a longitudinal artist heatmap.
 */

const YEAR_DATA_URL = "year_data.json";

(async function bootYearPane() {
  let yd;
  try {
    yd = await d3.json(YEAR_DATA_URL);
  } catch (err) {
    console.warn("year_data.json missing — run scripts/build_year_data.py", err);
    return;
  }

  const tabsEl = document.getElementById("year-tabs");
  if (!tabsEl) return;

  let activeYear = yd.years[0].year;

  function buildTabs() {
    tabsEl.innerHTML = yd.years.map(y => `
      <button data-year="${y.year}" class="${y.year === activeYear ? 'active' : ''}">
        <span class="yr-num">${y.year}</span>
        <span class="yr-hr">${Math.round(y.hours)} hr</span>
      </button>`).join("");
    tabsEl.querySelectorAll("button").forEach(b => {
      b.addEventListener("click", () => {
        activeYear = +b.dataset.year;
        tabsEl.querySelectorAll("button").forEach(x =>
          x.classList.toggle("active", +x.dataset.year === activeYear));
        renderYearCard();
        markLongitudinalActiveCol();
      });
    });
  }

  function renderYearCard() {
    const y = yd.years.find(x => x.year === activeYear);
    if (!y) return;

    document.getElementById("year-card-title").textContent = y.year;
    const stats = document.getElementById("year-card-stats");
    stats.innerHTML = [
      `<li><b>${y.hours.toLocaleString(undefined,{maximumFractionDigits:1})}</b>hours</li>`,
      `<li><b>${y.plays.toLocaleString()}</b>plays</li>`,
      `<li><b>${y.active_days}</b>active days</li>`,
      `<li><b>${y.distinct_artists.toLocaleString()}</b>distinct artists</li>`,
    ].join("");

    document.getElementById("year-card-headline").textContent =
      y.headline || "—";

    fillBucket("bucket-tracks", y.top_tracks.slice(0, 6), t => ({
      label: t.name,
      sub: t.artist,
      count: t.plays,
    }));
    fillBucket("bucket-artists", y.top_artists.slice(0, 6), a => ({
      label: a.name,
      sub: `${Math.round(a.ms / 3_600_000)} hr`,
      count: a.plays,
    }));
    fillBucket("bucket-albums", y.top_albums.slice(0, 6), a => ({
      label: a.name,
      sub: a.artist,
      count: a.plays,
    }));
    fillBucket("bucket-places", y.top_locations.slice(0, 6), p => ({
      label: p.city,
      sub: p.country,
      count: `${p.hours.toLocaleString(undefined,{maximumFractionDigits:1})} hr`,
    }));
    fillCountries(y.countries);
  }

  function fillBucket(bucketId, items, mapFn) {
    const ol = document.querySelector(`#${bucketId} .bucket-list`);
    if (!ol) return;
    if (!items.length) { ol.innerHTML = `<li class="empty"><span class="label">—</span></li>`; return; }
    ol.innerHTML = items.map((d, i) => {
      const r = mapFn(d);
      const sub = r.sub ? `<span class="sub">${escapeHtml(r.sub)}</span>` : "";
      return `<li>
        <span class="rank">${i + 1}</span>
        <span class="label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}${sub}</span>
        <span class="count">${typeof r.count === "number" ? r.count.toLocaleString() : escapeHtml(r.count)}</span>
      </li>`;
    }).join("");
  }

  function fillCountries(countries) {
    const ol = document.querySelector(`#bucket-countries .bucket-list`);
    if (!ol) return;
    const max = countries.reduce((m, c) => Math.max(m, c.share), 0) || 1;
    ol.innerHTML = countries.map(c => `
      <li>
        <span class="country-code">${escapeHtml(c.code)}</span>
        <span class="label">${c.plays.toLocaleString()} plays · ${c.hours.toLocaleString(undefined,{maximumFractionDigits:1})} hr</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(c.share / max * 100).toFixed(1)}%"></span></span>
        <span class="country-share">${c.share.toFixed(1)}%</span>
      </li>`).join("");
  }

  function buildLongitudinal() {
    const tbl = document.getElementById("year-longitudinal-table");
    if (!tbl || !yd.longitudinal) return;
    const { years, artists } = yd.longitudinal;

    // max per-cell value to scale density
    const cellMax = artists.reduce((m, a) =>
      Math.max(m, ...a.per_year), 0) || 1;

    const head = `
      <thead>
        <tr>
          <th class="artist-col">artist</th>
          ${years.map(y => `<th class="year-col" data-year="${y}">${y}</th>`).join("")}
          <th class="total-col">total</th>
        </tr>
      </thead>`;

    const body = `<tbody>${artists.map(a => {
      const peakIdx = a.per_year.indexOf(Math.max(...a.per_year));
      return `<tr>
        <td class="artist-col" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</td>
        ${a.per_year.map((v, i) => {
          const yr = years[i];
          const density = v === 0 ? 0
            : Math.min(0.78, 0.08 + (v / cellMax) * 0.7);
          const cls = ["year-cell"];
          if (v === 0) cls.push("faded");
          if (i === peakIdx) cls.push("peak");
          return `<td class="${cls.join(" ")}" data-year="${yr}"
            style="--cell-density:${density.toFixed(3)}"
            title="${a.name} · ${yr}: ${v} plays">
            ${v || "·"}
          </td>`;
        }).join("")}
        <td class="total-col">${a.total_plays.toLocaleString()}</td>
      </tr>`;
    }).join("")}</tbody>`;

    tbl.innerHTML = head + body;

    // year-column hover/click jumps to active year
    tbl.querySelectorAll("th.year-col").forEach(th => {
      th.addEventListener("click", () => {
        activeYear = +th.dataset.year;
        tabsEl.querySelectorAll("button").forEach(x =>
          x.classList.toggle("active", +x.dataset.year === activeYear));
        renderYearCard();
        markLongitudinalActiveCol();
      });
    });
  }

  function markLongitudinalActiveCol() {
    const tbl = document.getElementById("year-longitudinal-table");
    if (!tbl) return;
    tbl.querySelectorAll("th.year-col").forEach(th =>
      th.classList.toggle("active", +th.dataset.year === activeYear));
    tbl.querySelectorAll("td.year-cell").forEach(td =>
      td.classList.toggle("active-col", +td.dataset.year === activeYear));
  }

  buildTabs();
  renderYearCard();
  buildLongitudinal();
  markLongitudinalActiveCol();
})();
