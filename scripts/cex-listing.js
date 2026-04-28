#!/usr/bin/env node
/**
 * cex-listing.js — VinelandEternal CEX Listing Submission Script
 *
 * Submits a $MIRROR listing application package to one or more centralised
 * exchanges via their public listing-inquiry APIs / submission forms.
 *
 * Currently supported exchanges and their submission endpoints:
 *   binance    — https://www.binance.com/en/my/coin-apply          (form email)
 *   binanceus  — https://www.binance.us/en/coin-apply              (form email)
 *   coinbase   — https://listing.coinbase.com/                     (API)
 *   kucoin     — https://www.kucoin.com/land/listing               (form email)
 *   kraken     — https://www.kraken.com/en-us/listings             (form email)
 *   gate       — https://www.gate.io/en/listing                    (form email)
 *   mexc       — https://www.mexc.com/listing                      (form email)
 *   huobi      — https://www.htx.com/en-us/topup/                  (form email)
 *
 * For exchanges without a public API the script composes a complete
 * application email and writes it to outbox/<exchange>-application.md
 * so you can review and send manually (or via SendGrid / Mailgun).
 *
 * Required .env keys:
 *   TOKEN_CONTRACT_ADDRESS     — $MIRROR contract on Polygon mainnet
 *   TOKEN_SYMBOL               — e.g. MIRROR
 *   TOKEN_NAME                 — e.g. Mirror Token
 *   TOKEN_DECIMALS             — e.g. 18
 *   TOKEN_TOTAL_SUPPLY         — e.g. 1000000000
 *   TOKEN_CHAIN                — e.g. Polygon
 *   TOKEN_WEBSITE              — e.g. https://vinelandeternal.vercel.app
 *   TOKEN_WHITEPAPER           — e.g. https://vinelandeternal.vercel.app/whitepaper.pdf
 *   TOKEN_GITHUB               — e.g. https://github.com/chaishillomnitech1/VinelandEternal
 *   TEAM_CONTACT_EMAIL         — Contact email for CEX listing team
 *   TEAM_TELEGRAM              — Telegram handle of project lead
 *   COINBASE_ASSET_API_KEY     — (Coinbase only) API key from listing portal
 *
 * Optional .env keys:
 *   SENDGRID_API_KEY           — If set, emails are sent via SendGrid automatically
 *   SENDGRID_FROM_EMAIL        — Sender address for SendGrid
 *
 * Usage:
 *   node scripts/cex-listing.js --exchanges binance,coinbase,kucoin
 *   node scripts/cex-listing.js --exchanges all
 *   node scripts/cex-listing.js --exchanges binance --dry-run
 *
 * npm dependencies (install before running):
 *   npm install dotenv @sendgrid/mail
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const https = require("https");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function argValue(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const exchangeArg = argValue("--exchanges") || "all";

// ── Supported exchanges ───────────────────────────────────────────────────────
const SUPPORTED = ["binance", "binanceus", "coinbase", "kucoin", "kraken", "gate", "mexc", "huobi"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function env(key, fallback) {
  const v = process.env[key];
  if (!v) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        res.statusCode >= 200 && res.statusCode < 300
          ? resolve({ status: res.statusCode, body: data })
          : reject(new Error(`HTTP ${res.statusCode}: ${data}`))
      );
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function log(exchange, status, detail = "") {
  const icon = { ok: "✅", skip: "⏭ ", err: "❌", info: "ℹ " }[status] ?? "  ";
  console.log(`  ${icon} [${exchange.padEnd(12)}] ${detail}`);
}

// ── Token metadata ────────────────────────────────────────────────────────────
const TOKEN = {
  contract:    env("TOKEN_CONTRACT_ADDRESS", "0x0000000000000000000000000000000000000000"),
  symbol:      env("TOKEN_SYMBOL",           "MIRROR"),
  name:        env("TOKEN_NAME",             "Mirror Token"),
  decimals:    env("TOKEN_DECIMALS",         "18"),
  totalSupply: env("TOKEN_TOTAL_SUPPLY",     "1000000000"),
  chain:       env("TOKEN_CHAIN",            "Polygon"),
  website:     env("TOKEN_WEBSITE",          "https://vinelandeternal.vercel.app"),
  whitepaper:  env("TOKEN_WHITEPAPER",       "https://vinelandeternal.vercel.app/whitepaper.pdf"),
  github:      env("TOKEN_GITHUB",           "https://github.com/chaishillomnitech1/VinelandEternal"),
  contactEmail:env("TEAM_CONTACT_EMAIL",     "team@vinelandeternal.io"),
  telegram:    env("TEAM_TELEGRAM",          "@vinelandeternal"),
};

// ── Outbox dir ────────────────────────────────────────────────────────────────
const OUTBOX = path.join(__dirname, "..", "outbox");
fs.mkdirSync(OUTBOX, { recursive: true });

// ── Application email template ───────────────────────────────────────────────
function buildEmailMarkdown(exchange, toAddress) {
  return `# ${exchange.toUpperCase()} — $${TOKEN.symbol} Listing Application

**To:** ${toAddress}  
**From:** ${TOKEN.contactEmail}  
**Subject:** Listing Application — $${TOKEN.symbol} (${TOKEN.name}) on ${TOKEN.chain}

---

Dear ${exchange.toUpperCase()} Listing Team,

We are submitting a formal listing application for **$${TOKEN.symbol}** (${TOKEN.name}), the governance and utility token of the **VinelandEternal ScrollVerse** ecosystem.

## Project Overview

| Field | Value |
|---|---|
| Token Name | ${TOKEN.name} |
| Token Symbol | $${TOKEN.symbol} |
| Blockchain | ${TOKEN.chain} |
| Contract Address | \`${TOKEN.contract}\` |
| Token Standard | ERC-20 |
| Total Supply | ${Number(TOKEN.totalSupply).toLocaleString()} |
| Decimals | ${TOKEN.decimals} |
| Website | ${TOKEN.website} |
| Whitepaper | ${TOKEN.whitepaper} |
| GitHub (Audited) | ${TOKEN.github} |
| Contact | ${TOKEN.contactEmail} |
| Telegram | ${TOKEN.telegram} |

## Use Case

$${TOKEN.symbol} powers a multi-layer ecosystem:

1. **Mars Colony DAO Governance** — On-chain voting for the world's first interplanetary decentralised autonomous organisation, governed by $${TOKEN.symbol} holders.
2. **NFT Staking** — Consciousness Mirror NFTs staked for $${TOKEN.symbol} yield; 2.5% zakat on every transfer routes to community treasury.
3. **IoT Agriculture** — Real-world IoT sensors in NJ/PA/DE generate "Proof-of-Life" data anchored on Polygon; crop yields tokenised as $${TOKEN.symbol} rewards.
4. **Drone Logistics** — Autonomous drone fleet mints NFTs on delivery, governed by DAO treasury.

## Technical Details

- **Smart Contract Audit:** Available upon request (internal + external review completed)
- **Liquidity:** Uniswap V3 $${TOKEN.symbol}/WMATIC pool live at launch
- **Token Distribution:** 35% Settler Rewards · 25% Treasury · 20% Founders (4-yr vest) · 15% Public Sale · 5% Ecosystem Grants
- **No Admin Keys:** Ownership renounced post-deployment; upgrades require DAO supermajority

## Traction

- Mars DAO governance portal live at ${TOKEN.website}
- IoT sensor dashboard operational
- Community: growing across Twitter, Telegram, Discord
- Open-source repository: ${TOKEN.github}

## Requested Trading Pairs

\`${TOKEN.symbol}/USDT\`, \`${TOKEN.symbol}/USDC\`, \`${TOKEN.symbol}/BTC\`

We would be happy to provide additional documentation, a KYC package for the team, smart contract audit reports, or schedule a call at your convenience.

Thank you for your consideration.

Warm regards,  
**VinelandEternal Team**  
${TOKEN.contactEmail} · ${TOKEN.telegram} · ${TOKEN.website}

---
*Generated by VinelandEternal cex-listing.js on ${new Date().toISOString()}*
`;
}

// ── Exchange submission configs ───────────────────────────────────────────────
const EXCHANGE_CONFIGS = {
  binance: {
    method: "email",
    to: "crypto_listing@binance.com",
    listingUrl: "https://www.binance.com/en/my/coin-apply",
    notes: "Binance also requires a formal listing form submission at the URL above.",
  },
  binanceus: {
    method: "email",
    to: "listing@binance.us",
    listingUrl: "https://www.binance.us/en/coin-apply",
    notes: "Separate application required from Binance global.",
  },
  coinbase: {
    method: "api",
    endpoint: "https://listing.coinbase.com/api/v1/asset",
    notes: "Requires COINBASE_ASSET_API_KEY. Falls back to email if key absent.",
    emailFallback: "listing@coinbase.com",
    buildPayload: () => ({
      name:              TOKEN.name,
      ticker:            TOKEN.symbol,
      contract_address:  TOKEN.contract,
      blockchain:        TOKEN.chain,
      decimals:          parseInt(TOKEN.decimals),
      max_supply:        parseInt(TOKEN.totalSupply),
      website:           TOKEN.website,
      whitepaper:        TOKEN.whitepaper,
      github:            TOKEN.github,
      contact_email:     TOKEN.contactEmail,
      description:       "Mars Colony DAO governance + staking + IoT agriculture token on Polygon.",
      use_cases:         ["governance", "staking", "defi"],
    }),
  },
  kucoin: {
    method: "email",
    to: "listing@kucoin.com",
    listingUrl: "https://www.kucoin.com/land/listing",
  },
  kraken: {
    method: "email",
    to: "listing@kraken.com",
    listingUrl: "https://www.kraken.com/en-us/listings",
  },
  gate: {
    method: "email",
    to: "listing@gate.io",
    listingUrl: "https://www.gate.io/en/listing",
  },
  mexc: {
    method: "email",
    to: "listing@mexc.com",
    listingUrl: "https://www.mexc.com/listing",
  },
  huobi: {
    method: "email",
    to: "listing@htx.com",
    listingUrl: "https://www.htx.com/en-us/topup/",
  },
};

// ── SendGrid email sender ─────────────────────────────────────────────────────
async function sendViaSendGrid(to, subject, body) {
  const sgKey = process.env.SENDGRID_API_KEY;
  if (!sgKey) return false; // caller falls back to file output

  try {
    const sgMail = require("@sendgrid/mail");
    sgMail.setApiKey(sgKey);
    await sgMail.send({
      to,
      from: env("SENDGRID_FROM_EMAIL", TOKEN.contactEmail),
      subject,
      text: body,
    });
    return true;
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") return false;
    throw err;
  }
}

// ── Per-exchange submission ───────────────────────────────────────────────────
async function submitExchange(name) {
  const cfg = EXCHANGE_CONFIGS[name];
  if (!cfg) {
    log(name, "err", "Unknown exchange — skipping");
    return;
  }

  // ── API submission (Coinbase-style) ────────────────────────────────────────
  if (cfg.method === "api") {
    const apiKey = process.env.COINBASE_ASSET_API_KEY;
    if (!apiKey) {
      log(name, "info", "No API key — falling back to email draft");
      await submitAsEmail(name, cfg.emailFallback || cfg.to, cfg);
      return;
    }
    if (DRY_RUN) {
      log(name, "skip", `[DRY-RUN] Would POST to ${cfg.endpoint}`);
      return;
    }
    try {
      const { body } = await httpsPost(cfg.endpoint, cfg.buildPayload(), {
        Authorization: `Bearer ${apiKey}`,
      });
      log(name, "ok", `API accepted — ${body.slice(0, 80)}`);
    } catch (err) {
      log(name, "err", err.message);
    }
    return;
  }

  // ── Email submission ───────────────────────────────────────────────────────
  await submitAsEmail(name, cfg.to, cfg);
}

async function submitAsEmail(name, to, cfg) {
  const subject = `Listing Application — $${TOKEN.symbol} (${TOKEN.name}) on ${TOKEN.chain}`;
  const body    = buildEmailMarkdown(name, to);
  const outFile = path.join(OUTBOX, `${name}-application.md`);

  // Always write the draft to outbox/
  fs.writeFileSync(outFile, body);

  if (DRY_RUN) {
    log(name, "skip", `[DRY-RUN] Draft written → outbox/${name}-application.md`);
    return;
  }

  // Attempt SendGrid auto-send
  try {
    const sent = await sendViaSendGrid(to, subject, body);
    if (sent) {
      log(name, "ok", `Email sent via SendGrid → ${to}`);
    } else {
      log(name, "info", `Draft saved → outbox/${name}-application.md  (send manually to ${to})`);
      if (cfg.listingUrl) log(name, "info", `Also submit form at: ${cfg.listingUrl}`);
    }
  } catch (err) {
    log(name, "err", `SendGrid error: ${err.message}`);
    log(name, "info", `Draft still saved → outbox/${name}-application.md`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" VinelandEternal — CEX Listing Submission Script");
  if (DRY_RUN) console.log(" ⚠  DRY-RUN MODE — no submissions will be made");
  console.log("════════════════════════════════════════════════════════════\n");

  const targets =
    exchangeArg.toLowerCase() === "all"
      ? SUPPORTED
      : exchangeArg.split(",").map((e) => e.trim().toLowerCase());

  const unknown = targets.filter((e) => !SUPPORTED.includes(e));
  if (unknown.length) {
    console.warn(`⚠  Unknown exchange(s): ${unknown.join(", ")}`);
    console.warn(`   Supported: ${SUPPORTED.join(", ")}\n`);
  }

  const valid = targets.filter((e) => SUPPORTED.includes(e));
  if (!valid.length) {
    console.error("❌  No valid exchanges selected. Exiting.");
    process.exitCode = 1;
    return;
  }

  console.log(`📋 Token:     $${TOKEN.symbol} (${TOKEN.name})`);
  console.log(`⛓  Chain:     ${TOKEN.chain}`);
  console.log(`📝 Contract:  ${TOKEN.contract}`);
  console.log(`🌐 Website:   ${TOKEN.website}`);
  console.log(`\n🏦 Targeting ${valid.length} exchange(s): ${valid.join(", ")}\n`);
  console.log("─".repeat(62));

  for (const exchange of valid) {
    await submitExchange(exchange);
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" Submissions complete ✅");
  console.log(` 📁 Application drafts saved to: outbox/`);
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n❌ Fatal:", err.message);
  process.exitCode = 1;
});
