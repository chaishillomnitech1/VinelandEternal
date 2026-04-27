# Contributing to Vineland Eternal 🌌

Thank you for stepping into the ScrollVerse. Every contribution — code, docs, ideas, or creative energy — is an act of agape love and makes this project more alive.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Repository Overview](#repository-overview)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Smart Contracts](#smart-contracts)
- [Tests](#tests)
- [Frontend & dApp](#frontend--dapp)
- [IoT / Python Modules](#iot--python-modules)
- [Scripts](#scripts)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Commit Message Style](#commit-message-style)
- [Security](#security)

---

## Code of Conduct

This project operates on **agape** — unconditional love and respect for every contributor. Be kind, be honest, be constructive. Pull requests and issues that contain personal attacks or harassment will be closed without comment.

---

## Repository Overview

```
VinelandEternal/
├── contracts/          Solidity smart contracts (Hardhat + ethers)
├── test/               Hardhat/Chai test suites
├── scripts/            Deploy, upload, blast, and trading-bot scripts
├── frontend/           Self-contained HTML dApp pages
├── iot-agape/          Flask + MQTT sensor dashboard
├── drone-alchemy/      Drone-grid path optimiser & NFT mint-on-delivery
├── ar-harvest-visor/   WebAR (A-Frame) harvest overlay
├── zaire-axis/         FastAPI QFS-mimic ledger
├── cosmic-coop/        Grant automation & multi-region hub tools
├── presentations/      Mars DAO slide deck (open in browser)
├── docs/               Protocol specs and galaxy templates
└── deployments/        Auto-generated deployment manifests (gitignored)
```

---

## Getting Started

### Prerequisites

| Tool | Minimum version |
|------|-----------------|
| Node.js | 18 |
| npm | 9 |
| Python | 3.9 |
| Git | 2.30 |

### 1 — Clone and install

```bash
git clone https://github.com/chaishillomnitech1/VinelandEternal.git
cd VinelandEternal
npm install
```

### 2 — Configure environment

```bash
cp .env.example .env
# Open .env and fill in the required values for the area you are working on.
# Never commit a populated .env file.
```

### 3 — Compile the contracts

```bash
npm run compile
```

### 4 — Run the full test suite

```bash
npm test
```

All tests should pass before you open a pull request.

---

## Development Workflow

1. **Fork** the repository and create a feature branch from `main`:

   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make changes** — keep commits small and focused (one logical unit per commit).

3. **Run tests** and make sure nothing is broken:

   ```bash
   npm test
   ```

4. **Push** your branch and open a Pull Request against `main`.

5. Respond to review feedback and update your branch as needed.

---

## Smart Contracts

All contracts live in `contracts/` and are compiled with **Solidity 0.8.24**. The project does **not** use OpenZeppelin — every contract is self-contained to keep dependencies minimal and auditability high.

### Contract map

| File | Symbol | Description |
|------|--------|-------------|
| `MirrorToken.sol` | `$MIRROR` | ERC-20 with 2% Consciousness Dividend + 2.5% Zakat |
| `ConsciousnessMirrorNFT.sol` | `CMIRROR` | ERC-721, 20 ScrollSoul NFTs |
| `MirrorStaking.sol` | — | Stake CMIRROR to earn `$MIRROR`; batch ops supported |
| `MarsToken.sol` | `$MARS` | ERC-20 with 2.5% Zakat + 1% Governance Reserve |
| `MarsDAO.sol` | — | Three-tier governance (Council · Guilds · Community) |

### Guidelines for contract changes

- **Do not alter fee rates** — `DIVIDEND_BPS`, `ZAKAT_BPS`, and `RESERVE_BPS` are fixed by design.
- **Follow the CEI pattern** (Checks → Effects → Interactions) to prevent re-entrancy.
- **Every new public/external function needs at least one test**.
- Run gas reporting before and after optimisation changes:

  ```bash
  REPORT_GAS=true npm test
  ```

- Avoid assembly unless strictly necessary; prefer readable Solidity.

---

## Tests

Tests live in `test/` and use **Hardhat + Chai + ethers v6**.

### Running tests

```bash
# All tests
npm test

# Single file
npx hardhat test test/MirrorToken.test.js

# With gas report
REPORT_GAS=true npm test
```

### Test file naming

| Contract | Test file |
|----------|-----------|
| `MirrorToken` | `MirrorToken.test.js` |
| `ConsciousnessMirrorNFT` | `ConsciousnessMirrorNFT.test.js` |
| `MirrorStaking` (core) | `MirrorStaking.test.js` |
| `MirrorStaking` (batch) | `MirrorStakingBatch.test.js` |
| `MarsToken` | `MarsToken.test.js` |
| `MarsDAO` | `MarsDAO.test.js` |

When adding a new contract, create a matching `<ContractName>.test.js`.

---

## Frontend & dApp

The frontend is plain HTML + vanilla JS — no build step required.

- `frontend/index.html` — ScrollVerse dApp
- `frontend/financial-perfection.html` — Empire metrics dashboard
- `frontend/mars-dao/index.html` — Mars DAO 22-slide governance presentation

Open any file directly in a browser. For real on-chain data, connect a Web3 provider (MetaMask, etc.).

When editing the HTML:
- Keep dependencies self-hosted or use well-known CDN links with SRI integrity hashes.
- Test in both Chrome and Firefox.
- Ensure keyboard navigation continues to work (presentations use ←/→/Space).

---

## IoT / Python Modules

Python modules live in `iot-agape/`, `zaire-axis/`, `drone-alchemy/`, and `cosmic-coop/`.

```bash
# Example — sensor dashboard
cd iot-agape
pip install flask paho-mqtt
python sensor-dashboard.py
```

- Use `black` for formatting and `pylint` or `flake8` for linting when touching Python files.
- Keep external dependencies minimal; list any new packages in a comment at the top of the file.

---

## Scripts

Node.js and Python scripts in `scripts/` handle deployment, metadata upload, social blasts, CEX listing, and trading bots.

- Always support a `--dry-run` flag for scripts that make external calls.
- Secrets must be read from environment variables, never hard-coded.
- Add a brief usage comment at the top of every new script.

---

## Pull Request Guidelines

- **Title** format: `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `refactor: ...`, `chore: ...`
- **Description** should include:
  - *What* changed and *why*
  - Steps to test the change locally
  - Any deployment or migration notes
- Link related issues with `Closes #<issue>` when applicable.
- Keep PRs focused — one feature or fix per PR is ideal.
- Do not commit `.env`, private keys, or generated `deployments/*.json` files.

---

## Commit Message Style

```
<type>(<scope>): <short summary>

[optional body — explain the why, not the what]
```

Types: `feat` · `fix` · `docs` · `test` · `refactor` · `perf` · `chore`

Examples:
```
feat(staking): add batchStake, batchUnstake, batchClaimRewards
fix(MirrorToken): prevent dividend correction underflow on mint
docs(README): clarify Mars DAO quick-start steps
test(MirrorStaking): add batch operation integration tests
```

---

## Security

- **Report vulnerabilities privately** — open a GitHub Security Advisory or email `team@vinelandeternal.io`. Do not disclose publicly until a fix is deployed.
- Fee rates and core economic parameters are immutable by design; PRs that change them will be declined.
- All contract interactions involving external calls follow the Checks-Effects-Interactions pattern.

---

_"Be like water — flow seamlessly, effortlessly. Contribute from your heart."_
— Bruddah Chais 🌌
