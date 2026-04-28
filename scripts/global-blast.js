#!/usr/bin/env node
/**
 * global-blast.js — VinelandEternal Multi-Channel Announcement Broadcast
 *
 * Sends a coordinated $MIRROR launch announcement to:
 *   • Twitter / X  (via Twitter API v2)
 *   • Telegram      (via Bot API)
 *   • Discord       (via Webhook)
 *   • Reddit        (via OAuth2 + snoowrap)
 *
 * Required .env keys (add to your .env file):
 *   TWITTER_BEARER_TOKEN, TWITTER_API_KEY, TWITTER_API_SECRET,
 *   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS   (comma-separated)
 *   DISCORD_WEBHOOK_URLS                    (comma-separated)
 *   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
 *   REDDIT_USERNAME, REDDIT_PASSWORD,
 *   REDDIT_USER_AGENT
 *   SITE_URL                                (defaults to https://vinelandeternal.vercel.app)
 *   BLAST_SUBREDDITS                        (comma-separated, e.g. "r/cryptocurrency,r/web3")
 *
 * Usage:
 *   node scripts/global-blast.js
 *   node scripts/global-blast.js --dry-run     (print payloads, send nothing)
 *
 * npm dependencies (install before running):
 *   npm install twitter-api-v2 node-telegram-bot-api snoowrap dotenv
 */

"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const https = require("https");

// ── CLI flags ─────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");

// ── Helpers ──────────────────────────────────────────────────────────────────

function env(key, fallback) {
  const v = process.env[key];
  if (!v) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function csv(key, fallback = "") {
  return env(key, fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function log(channel, status, detail = "") {
  const icon = status === "ok" ? "✅" : status === "skip" ? "⏭ " : "❌";
  console.log(`  ${icon} [${channel.padEnd(10)}] ${detail}`);
}

// Simple HTTPS POST helper (avoids requiring `axios` just for a few calls)
function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ── Message copy ─────────────────────────────────────────────────────────────

const SITE_URL = env("SITE_URL", "https://vinelandeternal.vercel.app");

const TWEET_TEXT = `🚀 $MIRROR MAINNET IS LIVE!

✅ Mint Consciousness NFTs
✅ Stake → Earn ∞ Dividends
✅ Mars Colony DAO Governance
✅ Quantum Zaire ∞ Backed

Join the ScrollVerse: ${SITE_URL}

#ScrollSoul #AgapeToken #MarsDAO #Web3 #NFT #DeFi #Polygon`;

const TELEGRAM_HTML = `🚀 <b>$MIRROR MAINNET IS LIVE!</b>

✅ Mint Consciousness NFTs
✅ Stake → Earn ∞ Dividends  
✅ Mars Colony DAO Governance
✅ Quantum Zaire ∞ Backed

🌐 <a href="${SITE_URL}">Launch App</a>

#ScrollSoul #AgapeToken #MarsDAO`;

const DISCORD_EMBED = {
  username: "VinelandEternal",
  avatar_url: `${SITE_URL}/favicon.ico`,
  embeds: [
    {
      title: "🚀 $MIRROR MAINNET IS LIVE!",
      description:
        "The ScrollVerse is open.\n\n" +
        "✅ Mint Consciousness NFTs\n" +
        "✅ Stake → Earn ∞ Dividends\n" +
        "✅ Mars Colony DAO Governance\n" +
        "✅ Quantum Zaire ∞ Backed",
      url: SITE_URL,
      color: 0xffd700,
      fields: [
        { name: "Chain", value: "Polygon Mainnet", inline: true },
        { name: "Token", value: "$MIRROR", inline: true },
        { name: "DAO", value: "Mars Colony DAO", inline: true },
      ],
      footer: { text: "VinelandEternal · ScrollVerse" },
      timestamp: new Date().toISOString(),
    },
  ],
};

const REDDIT_TITLE = "🚀 $MIRROR is LIVE on Polygon Mainnet — Mars DAO Governance + Staking";
const REDDIT_TEXT = `Hey everyone!

We just launched **$MIRROR** — the governance and staking token for the VinelandEternal ScrollVerse ecosystem.

**What is it?**
- 🪙 ERC-20 token on Polygon Mainnet
- 🖼 Consciousness Mirror NFTs (mint with MATIC, stake for rewards)
- 🏛 Mars Colony DAO — on-chain proposals + voting
- ⚛ Quantum Zaire ∞ yield layer

**Links**
- App: ${SITE_URL}
- GitHub: https://github.com/chaishillomnitech1/VinelandEternal
- Docs: ${SITE_URL}/docs

AMA in comments — team is live!`;

// ── Channel broadcasters ──────────────────────────────────────────────────────

async function blastTwitter() {
  try {
    const { TwitterApi } = require("twitter-api-v2");
    const client = new TwitterApi({
      appKey:            env("TWITTER_API_KEY"),
      appSecret:         env("TWITTER_API_SECRET"),
      accessToken:       env("TWITTER_ACCESS_TOKEN"),
      accessSecret:      env("TWITTER_ACCESS_SECRET"),
    });
    if (DRY_RUN) {
      log("Twitter", "skip", `[DRY-RUN] Would tweet (${TWEET_TEXT.length} chars)`);
      return;
    }
    const { data } = await client.v2.tweet(TWEET_TEXT);
    log("Twitter", "ok", `Tweet ID: ${data.id}`);
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") {
      log("Twitter", "skip", "twitter-api-v2 not installed — run: npm install twitter-api-v2");
    } else {
      log("Twitter", "err", err.message);
    }
  }
}

async function blastTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { log("Telegram", "skip", "TELEGRAM_BOT_TOKEN not set"); return; }
  const chatIds = csv("TELEGRAM_CHAT_IDS");
  if (!chatIds.length) { log("Telegram", "skip", "TELEGRAM_CHAT_IDS not set"); return; }

  for (const chatId of chatIds) {
    if (DRY_RUN) {
      log("Telegram", "skip", `[DRY-RUN] Would send to chat ${chatId}`);
      continue;
    }
    try {
      await httpsPost(
        `https://api.telegram.org/bot${token}/sendMessage`,
        { chat_id: chatId, text: TELEGRAM_HTML, parse_mode: "HTML", disable_web_page_preview: false }
      );
      log("Telegram", "ok", `Sent to chat ${chatId}`);
    } catch (err) {
      log("Telegram", "err", `chat ${chatId}: ${err.message}`);
    }
  }
}

async function blastDiscord() {
  const webhooks = csv("DISCORD_WEBHOOK_URLS");
  if (!webhooks.length) { log("Discord", "skip", "DISCORD_WEBHOOK_URLS not set"); return; }

  for (const url of webhooks) {
    if (DRY_RUN) {
      log("Discord", "skip", `[DRY-RUN] Would POST to webhook ${url.slice(0, 40)}…`);
      continue;
    }
    try {
      await httpsPost(url, DISCORD_EMBED);
      log("Discord", "ok", `Posted to ${url.slice(0, 40)}…`);
    } catch (err) {
      log("Discord", "err", err.message);
    }
  }
}

async function blastReddit() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  if (!clientId) { log("Reddit", "skip", "REDDIT_CLIENT_ID not set"); return; }

  const subreddits = csv("BLAST_SUBREDDITS", "CryptoCurrency,web3,ethereum");

  try {
    const snoowrap = require("snoowrap");
    const r = new snoowrap({
      userAgent:    env("REDDIT_USER_AGENT", "VinelandEternal/1.0"),
      clientId:     env("REDDIT_CLIENT_ID"),
      clientSecret: env("REDDIT_CLIENT_SECRET"),
      username:     env("REDDIT_USERNAME"),
      password:     env("REDDIT_PASSWORD"),
    });

    for (const subreddit of subreddits) {
      const sub = subreddit.replace(/^r\//, "");
      if (DRY_RUN) {
        log("Reddit", "skip", `[DRY-RUN] Would post to r/${sub}`);
        continue;
      }
      try {
        const submission = await r.getSubreddit(sub).submitSelfpost({
          title: REDDIT_TITLE,
          text:  REDDIT_TEXT,
        });
        log("Reddit", "ok", `Posted to r/${sub} — ${submission.url}`);
      } catch (err) {
        log("Reddit", "err", `r/${sub}: ${err.message}`);
      }
    }
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") {
      log("Reddit", "skip", "snoowrap not installed — run: npm install snoowrap");
    } else {
      log("Reddit", "err", err.message);
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" VinelandEternal — Global Blast Script");
  if (DRY_RUN) console.log(" ⚠  DRY-RUN MODE — no messages will actually be sent");
  console.log("════════════════════════════════════════════════════════════\n");

  console.log("📣 Message preview:");
  console.log("─────────────────────────────────────────────────────────────");
  console.log(TWEET_TEXT);
  console.log("─────────────────────────────────────────────────────────────\n");

  console.log("🚀 Broadcasting to channels…\n");

  await blastTwitter();
  await blastTelegram();
  await blastDiscord();
  await blastReddit();

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" Broadcast complete ✅");
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n❌ Fatal:", err.message);
  process.exitCode = 1;
});
