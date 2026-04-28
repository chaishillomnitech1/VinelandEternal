/**
 * heart-map.js — VinelandEternal Cosmic Co-Op: Dynamic Daily Rhythm Generator
 *
 * Builds and renders a self-adapting daily schedule (the "Agape Heart Map")
 * based on live IoT surplus data, auction pricing windows, and energy levels.
 * Outputs both a console-friendly schedule and a JSON payload suitable for
 * integration with the React dashboard or any calendar/webhook system.
 *
 * Usage:
 *   node heart-map.js
 *   DASHBOARD_URL=http://localhost:5000 node heart-map.js
 */

"use strict";

const https = require("https");
const http  = require("http");
const url   = require("url");

// ---------------------------------------------------------------------------
// Base schedule — Vineland Sanctuary Sovereign Rhythm
// Each block has: start (24h), end (24h), label, emoji, domain, adjustable
// ---------------------------------------------------------------------------
const BASE_SCHEDULE = [
  { start: "05:00", end: "06:30", label: "Dawn Stillness + Dashboard Pulse",       emoji: "🌅", domain: "alignment",  adjustable: false },
  { start: "06:30", end: "08:30", label: "Bounty Harvest + IoT/Drone Checks",      emoji: "🚜", domain: "harvest",    adjustable: true  },
  { start: "08:30", end: "09:30", label: "Family Agape Nourishment",               emoji: "🍃", domain: "family",     adjustable: false },
  { start: "09:30", end: "12:30", label: "IdeaForge — AR Visor, Drone Scaling",    emoji: "💡", domain: "build",      adjustable: true  },
  { start: "12:30", end: "14:00", label: "Rest + Auction Integration",             emoji: "☁️", domain: "rest",       adjustable: true  },
  { start: "14:00", end: "17:00", label: "Governance — Grants, Co-Op Expansion",   emoji: "🏛️", domain: "governance", adjustable: true  },
  { start: "17:00", end: "19:30", label: "Harmony & Community Connection",         emoji: "🌊", domain: "community",  adjustable: false },
  { start: "19:30", end: "23:59", label: "Soul Restoration + Silence Breath",      emoji: "🌙", domain: "rest",       adjustable: false },
];

// Weekly anchor events
const WEEKLY_ANCHORS = [
  { day: "Monday",    time: "10:00", label: "Co-Op Sync — All Hub Stewards",    emoji: "🔗" },
  { day: "Wednesday", time: "14:00", label: "Grant Review + Submission Check",  emoji: "📋" },
  { day: "Friday",    time: "09:00", label: "Drone Grid Calibration",           emoji: "🚁" },
  { day: "Sunday",    time: "08:00", label: "Full Rest + Lineage Check-In",     emoji: "👨‍👩‍👧‍👦" },
];

// ---------------------------------------------------------------------------
// IoT data fetch
// ---------------------------------------------------------------------------

/**
 * Fetch surplus tray count from the IoT dashboard.
 * @returns {Promise<number>} number of surplus trays (agape_value >= 90)
 */
function fetchSurplusCount(dashboardUrl) {
  return new Promise((resolve) => {
    const parsed = url.parse(`${dashboardUrl}/api/agape/surplus`);
    const lib = parsed.protocol === "https:" ? https : http;

    const req = lib.get(parsed, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data).length);
        } catch {
          resolve(0);
        }
      });
    });
    req.on("error", () => resolve(0));
    req.setTimeout(3000, () => { req.destroy(); resolve(0); });
  });
}

// ---------------------------------------------------------------------------
// Schedule adjustment logic
// ---------------------------------------------------------------------------

/**
 * Adapt the base schedule based on live conditions.
 *
 * Rules:
 *  - High surplus (>= 3 trays)  → extend Harvest block by 30 min, shift rest blocks
 *  - Low surplus  (0 trays)     → extend IdeaForge by 30 min (planning mode)
 *  - Day of week Sunday         → collapse governance/build, expand rest blocks
 *
 * @param {object[]} schedule
 * @param {object}   conditions  { surplusCount, dayOfWeek }
 * @returns {object[]} adapted schedule
 */
function adaptSchedule(schedule, { surplusCount, dayOfWeek }) {
  // Deep clone
  const adapted = schedule.map((b) => ({ ...b }));

  if (dayOfWeek === 0 /* Sunday */) {
    // Collapse adjustable blocks, mark as rest
    return adapted.map((b) => ({
      ...b,
      label: b.adjustable ? `[Rest Day] ${b.label}` : b.label,
      emoji: b.adjustable ? "🌿" : b.emoji,
    }));
  }

  if (surplusCount >= 3) {
    // Extend harvest block
    const harvest = adapted.find((b) => b.domain === "harvest");
    if (harvest) {
      harvest.end = shiftTime(harvest.end, 30);
      harvest.label += ` (+30 min — HIGH SURPLUS: ${surplusCount} trays)`;
    }
    // Compress first adjustable rest block by 30 min
    const rest = adapted.find((b) => b.domain === "rest" && b.adjustable);
    if (rest) rest.start = shiftTime(rest.start, 30);
  } else if (surplusCount === 0) {
    // Extend IdeaForge
    const forge = adapted.find((b) => b.domain === "build");
    if (forge) {
      forge.end = shiftTime(forge.end, 30);
      forge.label += " (+30 min — low-surplus planning sprint)";
    }
  }

  return adapted;
}

/**
 * Shift a "HH:MM" string by +minutes, clamped to "23:59".
 */
function shiftTime(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderConsole(schedule, anchors, date) {
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const day = dayNames[date.getDay()];
  console.log(`\n💎 VinelandEternal — Agape Heart Map`);
  console.log(`   ${day}, ${date.toDateString()}\n`);
  console.log("   DAILY RHYTHM");
  console.log("   " + "─".repeat(56));
  schedule.forEach(({ start, end, label, emoji }) => {
    console.log(`   ${emoji}  ${start}–${end}   ${label}`);
  });
  console.log("\n   WEEKLY ANCHORS");
  console.log("   " + "─".repeat(56));
  anchors.forEach(({ day: d, time, label, emoji }) => {
    const marker = d === day ? " ← TODAY" : "";
    console.log(`   ${emoji}  ${d.padEnd(10)} ${time}   ${label}${marker}`);
  });
  console.log("");
}

function buildJSON(schedule, anchors, conditions, date) {
  return {
    generated_at: date.toISOString(),
    conditions,
    daily_rhythm: schedule,
    weekly_anchors: anchors,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:5000";
  const now = new Date();

  const surplusCount = await fetchSurplusCount(dashboardUrl);
  const conditions = { surplusCount, dayOfWeek: now.getDay() };

  const adapted = adaptSchedule(BASE_SCHEDULE, conditions);
  renderConsole(adapted, WEEKLY_ANCHORS, now);

  const output = buildJSON(adapted, WEEKLY_ANCHORS, conditions, now);
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");

  return output;
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { adaptSchedule, buildJSON, shiftTime, BASE_SCHEDULE, WEEKLY_ANCHORS };
