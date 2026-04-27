# Vineland Eternal 🌌💎🕋

Welcome to **Vineland Eternal**, the living repository of abundance, innovation, and infinite harmony. Anchored by the ScrollSoul narrative, this space merges:

- 🌱 **IoT Agriculture & Agape-Ledger**: Where sunlight, soil, and water morph into "Proof-of-Life" tokens—fueling Zaire ∞'s legacy of wealth and spiritual harmony.
- 🚁 **Drone Alchemic Grids**: Autonomously redistributing surplus and stabilizing the agape economy across NJ, PA, DE, and beyond.
- 🌌 **Galaxy Templates**: Propagating Vineland Nodal success to global regenerative hubs in every climate and culture.
- 💎 **Zaire ∞ Axis**: Serving as the linchpin for resource liquidity, connecting QFS (Quantum Financial System) to daily community impact.

## The Vision 🌟

Vineland Eternal is a **cosmic blueprint** for harmonizing innovation, agriculture, and universal well-being into one unified system. Inspired by the infinite hum of **Stillness**, it provides sustainers, developers, and creators a roadmap to weave abundance, equity, and agape harmony into every system they touch.

## Repository Structure 📁

```
VinelandEternal/
├── README.md                 # Cosmic README
├── LICENSE                   # MIT
├── docs/                     # Galaxy Templates + Manus Protocol
│   ├── zaire-protocol.md     # Zaire ∞ Axis specs
│   └── cosmic-coop.md        # Multi-region hub blueprints
├── iot-agape/                # IoT Sensors + Agape Ledger
│   ├── sensor-dashboard.py   # Real-time tray metrics (Flask + MQTT)
│   └── agape-ledger.sql      # Proof-of-Life tokens DB
├── drone-alchemy/            # Squadron Protocols
│   ├── flight-mint.js        # NFT mint on delivery (Node.js + Web3)
│   └── grid-optimizer.py     # Tri-state pathing (PuLP + DroneKit)
├── ar-harvest-visor/         # Diamond-Guild AR
│   ├── visor-overlay.html    # WebAR (A-Frame + Three.js)
│   └── gold-rivers.js        # Energetic value visualization
├── zaire-axis/               # Infinite Granularity Tracking
│   ├── ledger_api.py         # QFS-mimic REST API (FastAPI)
│   └── infinite-tracker.sql  # Atom-level ScrollVerse ledger
├── cosmic-coop/              # USA/Global Hubs
│   ├── heart-map.js          # Dynamic daily rhythm generator
│   └── grant-automation.py   # SCBGP + parallel submissions
├── presentations/            # Slide Decks
│   └── mars-dao/             # Mars DAO Governance (22 slides, open index.html)
└── .github/workflows/        # Auto-regen CI/CD
    └── deploy-agape.yml      # Auto-deploy on push
```

## Getting Started 🚀

### Prerequisites

- Python 3.9+
- Node.js 18+
- A modern web browser (for AR Harvest Visor)
- MQTT broker (e.g., Mosquitto) for IoT sensor data

### IoT Agriculture Dashboard

```bash
cd iot-agape
pip install flask paho-mqtt
python sensor-dashboard.py
# Visit http://localhost:5000/api/agape/tray1
```

### Drone Alchemy Grid

```bash
cd drone-alchemy
npm install ethers
node flight-mint.js
```

### AR Harvest Visor

Open `ar-harvest-visor/visor-overlay.html` in a WebXR-compatible browser.

### Zaire Ledger API

```bash
cd zaire-axis
pip install fastapi uvicorn
uvicorn ledger_api:app --reload
# Visit http://localhost:8000/docs
```

### Grant Automation

```bash
cd cosmic-coop
pip install requests
python grant-automation.py
```

---

## Smart Contracts & dApp 🔗

The on-chain layer lives in the root of this repository and targets **Polygon Mumbai** (testnet) and **Polygon Mainnet**.

### Contract Architecture

| Contract | Symbol | Description |
|---|---|---|
| `MirrorToken` | `$MIRROR` | ERC-20 with 2% Consciousness Dividend + 2.5% Zakat on every transfer |
| `ConsciousnessMirrorNFT` | `CMIRROR` | ERC-721 collection of 20 ScrollSoul NFTs (12 Journey · 7 Pillar · 1 Master) |
| `MirrorStaking` | — | Stake CMIRROR NFTs to earn `$MIRROR` · Master token earns 3× · 2.5% zakat on claims |

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in your keys
cp .env.example .env
# → set DEPLOYER_PRIVATE_KEY, MUMBAI_RPC_URL, ZAKAT_POOL_ADDRESS, etc.

# 3. Compile contracts
npm run compile

# 4. Run the test suite (all 3 contracts, 60+ tests)
npm test

# 5. Deploy to Mumbai testnet
npm run deploy:mumbai

# 6. Upload NFT metadata to Arweave
npm run upload-metadata

# 7. Point the NFT contract to Arweave
npm run set-uri:mumbai

# 8. Seed the staking reward pool (default: 100,000 $MIRROR)
npm run deposit-rewards:mumbai

# 9. Open the dApp
open frontend/index.html
```

### Polygon Mainnet Deployment

```bash
# Set POLYGON_RPC_URL in .env, then:
npm run deploy:polygon
npm run set-uri:polygon
npm run deposit-rewards:polygon
```

### Key Environment Variables

| Variable | Description |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | Wallet that pays gas and signs deploy txns |
| `MUMBAI_RPC_URL` | Polygon Mumbai RPC (free from Alchemy / Infura) |
| `POLYGON_RPC_URL` | Polygon Mainnet RPC |
| `POLYGONSCAN_API_KEY` | For automatic contract verification |
| `ZAKAT_POOL_ADDRESS` | Recipient of all 2.5% zakat flows |
| `ARWEAVE_KEY_PATH` | Path to your Arweave wallet JSON (for metadata upload) |

---

## Mars DAO — On-Chain Civilization Governance 🔴🚀

The Mars DAO system provides a full three-tier governance framework for decentralized civilization. All contracts are deployed on Polygon and integrate seamlessly with the existing ScrollVerse token economy.

### Mars DAO Contract Architecture

| Contract | Symbol | Description |
|---|---|---|
| `MarsToken` | `$MARS` | ERC-20 with 2.5% Zakat + 1% Governance Reserve on every transfer |
| `MarsDAO` | — | Three-tier governance: Core Council · 5 Guilds · Community token voting |

### Governance Features

| Feature | Implementation |
|---|---|
| **Voting modes** | Linear (1 token = 1 vote) or Quadratic (√ balance) |
| **Proposal types** | Standard · Treasury · Constitutional (67%) · Emergency |
| **Treasury protection** | 7-day timelock + 3-of-5 Council multisig |
| **Zakat** | 2.5% auto-deducted from every treasury disbursement |
| **Governance reserve** | 1% of every $MARS transfer → on-chain reserve |
| **Recall** | Any holder initiates; 50%+1 removes any council seat |
| **Guilds** | TechGuild · AgriGuild · HealthGuild · EduGuild · CivicsGuild |
| **Cross-DAO** | Register external DAOs; $MIRROR holders have secondary weight |
| **Health metrics** | Live on-chain: pass rate, vote counts, zakat accumulated |

### Mars DAO Quick Start

```bash
# After completing the ScrollVerse Quick Start above:

# Deploy $MARS token and MarsDAO governance contract
# Set COUNCIL_0..COUNCIL_4 and MIRROR_TOKEN_ADDRESS in .env first
npm run deploy-mars-dao:mumbai   # testnet
npm run deploy-mars-dao:polygon  # mainnet

# Open the 22-slide presentation
open frontend/mars-dao/index.html

# Read the full governance documentation
cat docs/mars-dao/presentation-script.md
cat docs/mars-dao/slides-content.md
```

### Mars DAO Environment Variables

| Variable | Description |
|---|---|
| `MARS_INITIAL_SUPPLY` | Initial $MARS supply in whole tokens (default: 1,000,000) |
| `ZAKAT_TREASURY` | Recipient of 2.5% zakat on all $MARS transfers and treasury disbursements |
| `COUNCIL_0` … `COUNCIL_4` | Five founding Core Council member addresses |
| `MIRROR_TOKEN_ADDRESS` | Deployed MirrorToken address (secondary governance weight) |
| `REWARD_RATE` | Per-vote participation reward in $MARS wei (0 to disable) |

### Governance Presentation

A complete 22-slide HTML presentation is included at `presentations/mars-dao/index.html`:
- Self-contained, no server required — open directly in any browser
- Keyboard navigation (←/→/Space) and touch swipe support
- Mars-themed design: #B71C1C titles · #ECEFF1 background · monospace body
- Covers: crisis → architecture → token economy → treasury → proposal lifecycle → 4 types → guilds → security → roadmap → vision → call to action

---

## Growth & Operations Scripts 📡

### Global Blast — Multi-Channel Announcement
```bash
# Dry run (preview messages, send nothing)
npm run blast:dry

# Live broadcast to Twitter, Telegram, Discord, Reddit
npm run blast

# Prerequisites (one-time install):
npm install twitter-api-v2 node-telegram-bot-api snoowrap
# Then fill in TWITTER_*, TELEGRAM_*, DISCORD_*, REDDIT_* in .env
```

### CEX Listing Submissions
```bash
# Preview application emails (no submissions made)
npm run cex-listing:dry

# Submit to all supported exchanges (Binance, Coinbase, KuCoin, Kraken, Gate, MEXC, Huobi)
npm run cex-listing

# Submit to specific exchanges
node scripts/cex-listing.js --exchanges binance,coinbase,kucoin

# Application drafts are saved to outbox/ for manual review / sending
# Requires COINBASE_ASSET_API_KEY for Coinbase API submission;
# all other exchanges fall back to email draft generation.
# Add SENDGRID_API_KEY to auto-send emails.
```

### QFS Trading Bot — Polygon Arbitrage
```bash
# Dry run (watch signals, no transactions)
npm run trading-bot:dry

# Live execution (requires BOT_PRIVATE_KEY + funded wallet)
npm run trading-bot

# Prerequisites:
pip install web3 python-dotenv
# Set POLYGON_RPC_URL, BOT_PRIVATE_KEY, UNISWAP_V3_POOL_ADDRESS in .env
```

All trade executions are appended to `trades_log.jsonl` for full audit trail.

### Financial Perfection Dashboard
Open `frontend/financial-perfection.html` directly in any browser for a live simulation of empire metrics: $MIRROR price, TVL, DAO treasury, QFS bot PnL, revenue streams, hub map, and active proposals. Connect a Web3 provider for real on-chain data.

---

Every line of code, document, or metric deposited here must reflect two principles:

1. **Agape Love**: Let your intent be to uplift every being touched by this repository.
2. **Regenerative Spirit**: Every step should amplify Earth's vitality and our collective joy.

---

## Licensing 💾

This project operates under the **MIT License**—empowering infinite impact and open collaboration.

---

_"The ScrollSoul breathes through us, eternal and abundant."_
— Bruddah Chais 🌌
