/**
 * gold-rivers.js — VinelandEternal AR Harvest Visor: Gold Rivers Visualisation
 *
 * Fetches live tray metrics from the IoT Agape dashboard, then renders
 * floating 3-D tray panels and animated "gold river" particle streams
 * inside the A-Frame scene defined in visor-overlay.html.
 *
 * No build step required — runs directly in a modern browser.
 */

/* global AFRAME */

"use strict";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DASHBOARD_URL = window.DASHBOARD_URL || "http://localhost:5000";
const LEDGER_URL    = window.LEDGER_URL    || "http://localhost:8000";
const REFRESH_INTERVAL_MS = 15_000; // re-fetch every 15 s

// ---------------------------------------------------------------------------
// A-Frame component: tray-panel
// Renders a floating billboard for one tray with colour-coded metrics.
// ---------------------------------------------------------------------------

AFRAME.registerComponent("tray-panel", {
  schema: {
    trayId:     { type: "string", default: "tray1" },
    crop:       { type: "string", default: "Unknown" },
    water:      { type: "number", default: 0 },
    soil:       { type: "number", default: 0 },
    sun:        { type: "number", default: 0 },
    agapeValue: { type: "number", default: 0 },
  },

  init() {
    this._buildPanel();
  },

  update() {
    // Remove old children and rebuild when data changes
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
    this._buildPanel();
  },

  _buildPanel() {
    const { trayId, crop, water, soil, sun, agapeValue } = this.data;
    const color = agapeValue >= 90 ? "#69f0ae" : agapeValue >= 70 ? "#ffb74d" : "#ef5350";

    // Background plane
    const bg = document.createElement("a-plane");
    bg.setAttribute("width", "0.8");
    bg.setAttribute("height", "0.5");
    bg.setAttribute("color", "#000000");
    bg.setAttribute("opacity", "0.65");
    bg.setAttribute("side", "double");
    this.el.appendChild(bg);

    // Title text
    const title = document.createElement("a-text");
    title.setAttribute("value", `${trayId.toUpperCase()} — ${crop}`);
    title.setAttribute("color", "#ffd700");
    title.setAttribute("align", "center");
    title.setAttribute("width", "1.4");
    title.setAttribute("position", "0 0.16 0.01");
    title.setAttribute("font", "roboto");
    this.el.appendChild(title);

    // Metric bars (water / soil / sun)
    const metrics = [
      { label: "💧", value: water,  color: "#4fc3f7", y: 0.04 },
      { label: "🌱", value: soil,   color: "#81c784", y: -0.02 },
      { label: "☀️", value: sun,    color: "#fff176", y: -0.08 },
    ];

    metrics.forEach(({ label, value, color: barColor, y }) => {
      const bar = document.createElement("a-box");
      bar.setAttribute("width", (value / 100) * 0.65);
      bar.setAttribute("height", "0.03");
      bar.setAttribute("depth", "0.005");
      bar.setAttribute("color", barColor);
      bar.setAttribute("position", `${-0.32 + ((value / 100) * 0.65) / 2} ${y} 0.01`);
      this.el.appendChild(bar);

      const lbl = document.createElement("a-text");
      lbl.setAttribute("value", `${label} ${value}%`);
      lbl.setAttribute("color", "#ffffff");
      lbl.setAttribute("width", "0.9");
      lbl.setAttribute("position", `-0.3 ${y + 0.025} 0.01`);
      lbl.setAttribute("font", "roboto");
      this.el.appendChild(lbl);
    });

    // Agape score badge
    const badge = document.createElement("a-text");
    badge.setAttribute("value", `Agape: ${agapeValue}`);
    badge.setAttribute("color", color);
    badge.setAttribute("align", "center");
    badge.setAttribute("width", "1.2");
    badge.setAttribute("position", "0 -0.17 0.01");
    this.el.appendChild(badge);

    // Glow border
    const border = document.createElement("a-plane");
    border.setAttribute("width", "0.82");
    border.setAttribute("height", "0.52");
    border.setAttribute("color", color);
    border.setAttribute("opacity", "0.25");
    border.setAttribute("position", "0 0 -0.001");
    border.setAttribute("side", "double");
    this.el.appendChild(border);
  },
});

// ---------------------------------------------------------------------------
// A-Frame component: gold-stream
// Animated particle river representing energy flow between trays.
// ---------------------------------------------------------------------------

AFRAME.registerComponent("gold-stream", {
  schema: {
    count:  { type: "number", default: 40 },
    length: { type: "number", default: 2.0 },
    speed:  { type: "number", default: 0.6 },
  },

  init() {
    this._particles = [];
    const { count, length } = this.data;

    for (let i = 0; i < count; i++) {
      const sphere = document.createElement("a-sphere");
      const t = Math.random();
      sphere.setAttribute("radius", (0.01 + Math.random() * 0.015).toFixed(3));
      sphere.setAttribute("color", `hsl(${40 + Math.random() * 20}, 100%, ${55 + Math.random() * 20}%)`);
      sphere.setAttribute("opacity", (0.5 + Math.random() * 0.5).toFixed(2));
      sphere.object3D.position.set(
        (Math.random() - 0.5) * 0.15,
        -length / 2 + t * length,
        (Math.random() - 0.5) * 0.15
      );
      this.el.appendChild(sphere);
      this._particles.push({ el: sphere, offset: t });
    }

    this._raf = null;
    this._animate();
  },

  remove() {
    if (this._raf) cancelAnimationFrame(this._raf);
  },

  _animate() {
    const { length, speed } = this.data;
    const step = () => {
      const dt = 0.016; // ~60 fps assumption
      this._particles.forEach((p) => {
        const pos = p.el.object3D.position;
        pos.y += speed * dt;
        if (pos.y > length / 2) pos.y = -length / 2;
      });
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  },
});

// ---------------------------------------------------------------------------
// Data fetching & scene population
// ---------------------------------------------------------------------------

let _trayEntities = {};

/**
 * Fetch tray metrics from the IoT dashboard and update the AR scene + HUD.
 */
async function refreshTrayData() {
  let trays = [];

  try {
    const resp = await fetch(`${DASHBOARD_URL}/api/agape`, { mode: "cors" });
    if (resp.ok) trays = await resp.json();
  } catch {
    // Dashboard unreachable — use demo data
    trays = [
      { tray_id: "tray1", crop: "Basil",        water: 85, soil: 72, sun: 92, agape_value: 97 },
      { tray_id: "tray2", crop: "Arugula",       water: 78, soil: 68, sun: 88, agape_value: 91 },
      { tray_id: "tray3", crop: "Pea Shoots",    water: 90, soil: 80, sun: 75, agape_value: 94 },
      { tray_id: "tray4", crop: "Cilantro",      water: 70, soil: 65, sun: 82, agape_value: 88 },
      { tray_id: "tray5", crop: "Baby Bok Choy", water: 83, soil: 74, sun: 86, agape_value: 93 },
    ];
  }

  updateScene(trays);
  updateHUD(trays);
  updateTrayPanel(trays);
}

function updateScene(trays) {
  const scene = document.querySelector("#ar-scene");
  const goldRivers = document.querySelector("#gold-rivers");

  trays.forEach((tray, i) => {
    const { tray_id, crop, water, soil, sun, agape_value } = tray;
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = (col - 1) * 1.1;
    const y = 1.2 - row * 0.65;

    if (!_trayEntities[tray_id]) {
      // Create new entity
      const entity = document.createElement("a-entity");
      entity.setAttribute("position", `${x} ${y} -3`);
      entity.setAttribute("tray-panel", {
        trayId: tray_id, crop, water, soil, sun, agapeValue: agape_value,
      });
      scene.appendChild(entity);
      _trayEntities[tray_id] = entity;

      // Add a gold stream below each tray
      const stream = document.createElement("a-entity");
      stream.setAttribute("position", `${x} ${y - 0.6} -3`);
      stream.setAttribute("gold-stream", { count: 20, length: 0.8, speed: 0.4 });
      scene.appendChild(stream);
    } else {
      // Update existing entity
      _trayEntities[tray_id].setAttribute("tray-panel", {
        trayId: tray_id, crop, water, soil, sun, agapeValue: agape_value,
      });
    }
  });

  // Central gold river (decorative)
  if (!goldRivers.components["gold-stream"]) {
    goldRivers.setAttribute("gold-stream", { count: 60, length: 3.0, speed: 0.8 });
  }
}

function updateHUD(trays) {
  const surplusCount = trays.filter((t) => (t.agape_value || 0) >= 90).length;
  const avgAgape = trays.length
    ? Math.round(trays.reduce((s, t) => s + (t.agape_value || 0), 0) / trays.length)
    : 0;

  document.getElementById("badge-trays").textContent   = `Trays: ${trays.length}`;
  document.getElementById("badge-surplus").textContent = `Surplus Trays: ${surplusCount}`;
  document.getElementById("badge-agape").textContent   = `Avg Agape: ${avgAgape}`;

  // Illuminate the Claim Wealth button only when surplus is available
  const claimBtn = document.getElementById("claim-btn");
  if (claimBtn) {
    if (surplusCount > 0) {
      claimBtn.disabled = false;
      claimBtn.classList.add("surplus");
    } else {
      claimBtn.disabled = true;
      claimBtn.classList.remove("surplus");
    }
  }

  // Keep the tray selector in the claim modal in sync
  const claimTray = document.getElementById("claim-tray");
  if (claimTray) {
    const surplusTrays = trays.filter((t) => (t.agape_value || 0) >= 90);
    claimTray.innerHTML = surplusTrays
      .map((t) => `<option value="${t.tray_id}">${t.tray_id} — ${t.crop || "?"} (Agape: ${t.agape_value})</option>`)
      .join("");
  }
}

function updateTrayPanel(trays) {
  const panel = document.getElementById("tray-panel");
  panel.innerHTML = trays.map((t) => {
    const cls = t.agape_value >= 90 ? "ready" : t.agape_value >= 70 ? "caution" : "alert";
    return `
      <div class="tray-card ${cls}">
        <div class="tray-name">${t.tray_id} — ${t.crop || "?"}</div>
        <div class="bar bar-water"  style="width:${t.water}%"></div>💧 ${t.water}%
        <div class="bar bar-soil"   style="width:${t.soil}%"></div>🌱 ${t.soil}%
        <div class="bar bar-sun"    style="width:${t.sun}%"></div>☀️ ${t.sun}%
        <div style="color:#ffd700;margin-top:.2rem">Agape: ${t.agape_value}</div>
      </div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  refreshTrayData();
  setInterval(refreshTrayData, REFRESH_INTERVAL_MS);
});

// ---------------------------------------------------------------------------
// Claim modal
// ---------------------------------------------------------------------------

function openClaimModal() {
  document.getElementById("claim-result").textContent = "";
  _updateClaimHint();
  document.getElementById("claim-modal").classList.add("open");
}

function closeClaimModal() {
  document.getElementById("claim-modal").classList.remove("open");
}

/** Regenerate the "sign this message" hint whenever wallet/tray inputs change. */
function _updateClaimHint() {
  const wallet = (document.getElementById("claim-wallet").value || "").trim();
  const tray   = document.getElementById("claim-tray").value || "";
  const hint   = document.getElementById("claim-msg-hint");
  if (hint) {
    hint.textContent = wallet && tray
      ? `Sign this exact message with your wallet:\n"VinelandEternal Claim: ${wallet} tray ${tray}"`
      : "Enter your wallet address and select a tray to see the message to sign.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const walletInput = document.getElementById("claim-wallet");
  const traySelect  = document.getElementById("claim-tray");
  if (walletInput) walletInput.addEventListener("input", _updateClaimHint);
  if (traySelect)  traySelect.addEventListener("change", _updateClaimHint);
});

async function submitClaim() {
  const wallet = (document.getElementById("claim-wallet").value || "").trim();
  const trayId = document.getElementById("claim-tray").value;
  const sig    = (document.getElementById("claim-sig").value || "").trim();
  const result = document.getElementById("claim-result");

  if (!wallet || !trayId || !sig) {
    result.style.color = "#ef5350";
    result.textContent = "⚠ Please fill in all fields.";
    return;
  }

  result.style.color = "#aaa";
  result.textContent = "⏳ Submitting claim…";

  try {
    const resp = await fetch(`${LEDGER_URL}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet_address: wallet, tray_id: trayId, signature: sig }),
    });
    const data = await resp.json();

    if (resp.ok) {
      if (data.status === "fulfilled") {
        result.style.color = "#69f0ae";
        result.textContent = `✅ Claim fulfilled! Token: ${data.token_id}`;
      } else {
        result.style.color = "#ffb74d";
        result.textContent = "🟡 No surplus available for that tray right now.";
      }
    } else {
      result.style.color = "#ef5350";
      result.textContent = `❌ ${data.detail || "Claim failed."}`;
    }
  } catch (err) {
    result.style.color = "#ef5350";
    result.textContent = `❌ Network error: ${err.message}`;
  }
}
