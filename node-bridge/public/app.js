"use strict";

const API_RECORDS = "/records";
const REFRESH_MS = 30_000;

const FRUIT_LABEL = {
  freshapples:   "Apples",
  freshbanana:   "Bananas",
  freshoranges:  "Oranges",
  rottenapples:  "Apples",
  rottenbanana:  "Bananas",
  rottenoranges: "Oranges",
  unripeapples:  "Apples",
  unripebanana:  "Bananas",
  unripeoranges: "Oranges",
};

const CATEGORY_COLOR = {
  fresh:  "#4F8A3E",
  unripe: "#B68722",
  rotten: "#9B4A2B",
};

function category(fruitType) {
  const t = String(fruitType || "").toLowerCase();
  if (t.startsWith("fresh"))  return "fresh";
  if (t.startsWith("rotten")) return "rotten";
  if (t.startsWith("unripe")) return "unripe";
  return "unknown";
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 30)    return "just now";
  if (diff < 90)    return "1 min ago";
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
  if (diff < 7200)  return "1 hr ago";
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 172800) return "yesterday";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtAbsolute(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtCoords(lat, lng) {
  return `${Number(lat).toFixed(4)}°, ${Number(lng).toFixed(4)}°`;
}

/* ─── State ─────────────────────────────────────────────────── */

const state = {
  records: [],
  filter: "all",
  map: null,
  markerLayer: null,
  hasInitialFit: false,
  resetWatch: null,
};

/* ─── Data ──────────────────────────────────────────────────── */

async function fetchRecords({ silent = false } = {}) {
  const btn = document.getElementById("refreshBtn");
  if (!silent) btn.classList.add("is-loading");
  let networkOk = false;
  try {
    const res = await fetch(API_RECORDS, {
      headers: { "X-Trace-Id": "dashboard-" + Date.now().toString(36) },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data.records) ? data.records : [];
    state.records = list.sort((a, b) =>
      String(b.Timestamp || "").localeCompare(String(a.Timestamp || ""))
    );
    networkOk = true;
    render();
  } catch (err) {
    if (!state.resetWatch) toast(`Cannot load records: ${err.message}`);
    console.error("fetchRecords:", err);
  } finally {
    btn.classList.remove("is-loading");
    checkResetProgress(networkOk);
  }
}

/* ─── Render: stats / list / map ────────────────────────────── */

function render() {
  renderStats();
  renderList();
  renderMap();
}

function renderStats() {
  const counts = { total: state.records.length, fresh: 0, unripe: 0, rotten: 0 };
  for (const r of state.records) {
    const c = category(r.FruitType);
    if (c in counts) counts[c]++;
  }
  for (const k of ["total", "fresh", "unripe", "rotten"]) {
    const el = document.querySelector(`[data-stat="${k}"] [data-value]`);
    if (el) el.textContent = counts[k].toLocaleString();
  }
}

function renderList() {
  const list = document.getElementById("recordsList");
  const empty = document.getElementById("emptyState");
  const filter = state.filter;
  const filtered = state.records.filter(r =>
    filter === "all" ? true : category(r.FruitType) === filter
  );

  list.innerHTML = "";
  if (filtered.length === 0) {
    empty.hidden = false;
    empty.innerHTML = state.records.length === 0
      ? `No records yet — send your first harvest via <code>POST /api/predict-harvest</code>.`
      : `No <strong>${filter}</strong> records yet.`;
    return;
  }
  empty.hidden = true;

  const frag = document.createDocumentFragment();
  for (const rec of filtered) frag.appendChild(renderCard(rec));
  list.appendChild(frag);
}

function renderCard(rec) {
  const cat = category(rec.FruitType);
  const fruit = FRUIT_LABEL[rec.FruitType] || rec.FruitType || "Unknown";
  const confPct = Math.max(0, Math.min(100, Math.round((rec.Confidence || 0) * 100)));
  const hashShort = String(rec.ImageHash || "").slice(0, 16);

  const card = document.createElement("article");
  card.className = "record-card";
  card.dataset.id = rec.ID;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${fruit} record, ${cat}, ${confPct}% confidence`);

  card.innerHTML = `
    <div class="record-thumb">
      <img src="/images/${rec.ImageHash}" alt="${fruit}" loading="lazy" />
      <div class="record-thumb-missing">
        ${iconImage()}
        <span>No preview</span>
      </div>
    </div>
    <div class="record-body">
      <div class="record-head">
        <span class="fruit-badge is-${cat}"><span class="dot"></span>${cat}</span>
        <span class="record-time" title="${fmtAbsolute(rec.Timestamp)}">${fmtRelative(rec.Timestamp)}</span>
      </div>
      <div>
        <div class="record-fruit">${fruit}</div>
        <div class="confidence is-${cat}">
          <div class="confidence-track"><div class="confidence-fill" style="width:${confPct}%"></div></div>
          <span class="confidence-value">${confPct}%</span>
        </div>
      </div>
      <div class="record-meta">
        <div class="record-meta-row">${iconPin()}<span>${fmtCoords(rec.Latitude, rec.Longitude)}</span></div>
        <div class="record-meta-row">${iconHash()}<span class="hash-mono">${hashShort}…</span></div>
      </div>
    </div>
  `;
  const img = card.querySelector(".record-thumb img");
  const thumb = card.querySelector(".record-thumb");
  img.addEventListener("error", () => thumb.classList.add("is-missing"));
  card.addEventListener("click", () => openDetail(rec));
  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(rec); }
  });
  return card;
}

function iconPin() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
}
function iconHash() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`;
}
function iconImage() {
  return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
}

/* ─── Map ───────────────────────────────────────────────────── */

function renderMap() {
  if (typeof L === "undefined") return;

  if (!state.map) {
    state.map = L.map("leaflet-map", {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView([10.762, 106.660], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(state.map);
    state.markerLayer = L.layerGroup().addTo(state.map);
  }

  state.markerLayer.clearLayers();

  const valid = state.records.filter(r =>
    Number.isFinite(r.Latitude) && Number.isFinite(r.Longitude)
  );
  if (valid.length === 0) return;

  for (const r of valid) {
    const cat = category(r.FruitType);
    const color = CATEGORY_COLOR[cat] || "#2D4A21";
    const fruit = FRUIT_LABEL[r.FruitType] || r.FruitType;
    const confPct = Math.round((r.Confidence || 0) * 100);

    const marker = L.circleMarker([r.Latitude, r.Longitude], {
      radius: 9,
      fillColor: color,
      color: "#FFFFFF",
      weight: 2,
      fillOpacity: 0.95,
    });
    marker.bindPopup(`
      <strong>${fruit}</strong>
      <span style="display:inline-block;background:${color}22;color:${color};font-weight:700;
        text-transform:uppercase;font-size:10px;letter-spacing:0.06em;padding:2px 8px;
        border-radius:999px;">${cat}</span>
      &nbsp;<span style="color:#4A5547;">${confPct}%</span><br>
      <small style="color:#8A8F82;">${fmtRelative(r.Timestamp)}</small>
    `);
    marker.on("click", () => openDetail(r));
    marker.addTo(state.markerLayer);
  }

  if (!state.hasInitialFit && valid.length > 0) {
    const bounds = L.latLngBounds(valid.map(r => [r.Latitude, r.Longitude]));
    state.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    state.hasInitialFit = true;
  }
}

/* ─── Detail modal ──────────────────────────────────────────── */

function openDetail(rec) {
  const cat = category(rec.FruitType);
  const fruit = FRUIT_LABEL[rec.FruitType] || rec.FruitType;
  const confPct = ((rec.Confidence || 0) * 100).toFixed(2);

  document.getElementById("modalEyebrow").textContent = capitalize(cat) + " · Harvest";
  document.getElementById("modalTitle").textContent = fruit;

  const body = document.getElementById("modalBody");
  body.innerHTML = `
    <div class="detail-hero">
      <img src="/images/${rec.ImageHash}" alt="${fruit}" />
      <div class="detail-hero-missing">
        ${iconImage()}
        <span>No image stored for this record</span>
      </div>
    </div>
    <div class="detail-row">
      <span class="detail-label">Status</span>
      <span class="detail-value"><span class="fruit-badge is-${cat}"><span class="dot"></span>${cat}</span></span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Record ID</span>
      <span class="detail-value"><span class="hash-mono">${rec.ID || "—"}</span>${copyButton(rec.ID)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Classification</span>
      <span class="detail-value">${rec.FruitType || "—"} <span style="color:var(--ink-muted)">(${confPct}% confidence)</span></span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Captured</span>
      <span class="detail-value">${fmtAbsolute(rec.Timestamp)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Location</span>
      <span class="detail-value">${fmtCoords(rec.Latitude, rec.Longitude)}
        <a href="https://www.openstreetmap.org/?mlat=${rec.Latitude}&mlon=${rec.Longitude}#map=15/${rec.Latitude}/${rec.Longitude}"
           target="_blank" rel="noopener noreferrer"
           style="color:var(--brand);font-size:12px;font-weight:600;">View on map ↗</a>
      </span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Image Hash</span>
      <span class="detail-value"><span class="hash-mono">${rec.ImageHash || "—"}</span>${copyButton(rec.ImageHash)}</span>
    </div>
  `;

  const heroImg = body.querySelector(".detail-hero img");
  const hero = body.querySelector(".detail-hero");
  heroImg.addEventListener("error", () => hero.classList.add("is-missing"));

  body.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      if (!text) return;
      copyToClipboard(text).then(
        () => toast("Copied to clipboard"),
        () => toast("Copy failed")
      );
    });
  });

  document.getElementById("detailModal").hidden = false;
  document.body.style.overflow = "hidden";
}

function copyButton(value) {
  if (!value) return "";
  return `<button class="copy-btn" type="button" data-copy="${value}">Copy</button>`;
}

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      resolve();
    } catch (err) {
      reject(err);
    } finally {
      ta.remove();
    }
  });
}

function closeDetail() {
  document.getElementById("detailModal").hidden = true;
  document.body.style.overflow = "";
}

/* ─── Reset modal ───────────────────────────────────────────── */

function openResetModal() {
  state.resetWatch = {
    phase: "armed",
    baseline: state.records.length,
    sawDown: false,
  };
  const status = document.getElementById("resetStatus");
  const statusText = document.getElementById("resetStatusText");
  status.hidden = true;
  status.removeAttribute("data-state");
  statusText.textContent = "Waiting for network to come back…";
  document.getElementById("resetModal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeResetModal() {
  document.getElementById("resetModal").hidden = true;
  document.body.style.overflow = "";
  state.resetWatch = null;
}

function checkResetProgress(networkOk) {
  const watch = state.resetWatch;
  if (!watch) return;

  const status = document.getElementById("resetStatus");
  const statusText = document.getElementById("resetStatusText");

  if (!networkOk) {
    watch.sawDown = true;
    status.hidden = false;
    status.removeAttribute("data-state");
    statusText.textContent = "Network is down — restarting…";
    return;
  }

  if (watch.sawDown && state.records.length < watch.baseline) {
    status.hidden = false;
    status.setAttribute("data-state", "done");
    statusText.textContent = "Demo reset complete · network is back up.";
    toast("Demo ready — ledger is empty again");
    state.resetWatch = null;
    setTimeout(() => {
      if (!document.getElementById("resetModal").hidden) closeResetModal();
    }, 2400);
  } else if (watch.sawDown) {
    status.hidden = false;
    statusText.textContent = "Network back · waiting for ledger to clear…";
  }
}

/* ─── Toast ─────────────────────────────────────────────────── */

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2400);
}

/* ─── Bind ──────────────────────────────────────────────────── */

function bind() {
  document.getElementById("refreshBtn").addEventListener("click", () => fetchRecords());

  document.querySelectorAll("#filterChips .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#filterChips .chip").forEach(b => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      chip.classList.add("is-active");
      chip.setAttribute("aria-selected", "true");
      state.filter = chip.dataset.filter;
      renderList();
    });
  });

  document.querySelectorAll("[data-close]").forEach(el =>
    el.addEventListener("click", closeDetail)
  );

  document.getElementById("resetBtn").addEventListener("click", openResetModal);
  document.querySelectorAll("[data-close-reset]").forEach(el =>
    el.addEventListener("click", closeResetModal)
  );
  document.getElementById("resetCopyBtn").addEventListener("click", () => {
    copyToClipboard("./stop.sh --purge && ./start.sh").then(
      () => toast("Command copied — paste it in your terminal"),
      () => toast("Copy failed")
    );
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeDetail();
      closeResetModal();
    }
  });
}

/* ─── Init ──────────────────────────────────────────────────── */

bind();
fetchRecords();
setInterval(() => fetchRecords({ silent: true }), REFRESH_MS);
