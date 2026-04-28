#!/usr/bin/env python3
"""
qfs-trading-bot.py — VinelandEternal QFS Arbitrage / Trading Bot

Monitors the $MIRROR/MATIC pool on Uniswap V3 (Polygon) and executes
price-deviation trades via the Swap Router when a configurable threshold
is breached.

Architecture:
  1. Price oracle  — reads the on-chain pool slot0 sqrtPriceX96 via Web3
  2. Signal engine — simple EMA cross-over + deviation threshold
  3. Executor      — submits a Uniswap V3 exactInputSingle swap tx
  4. Ledger        — appends every trade to trades_log.jsonl for auditing

Required .env keys (add to your .env file):
  POLYGON_RPC_URL          — Polygon mainnet RPC endpoint
  BOT_PRIVATE_KEY          — Signing wallet private key (NEVER commit a real key)
  MIRROR_TOKEN_ADDRESS     — $MIRROR ERC-20 contract address
  MATIC_WMATIC_ADDRESS     — Wrapped MATIC address (0x0d500...  on mainnet)
  UNISWAP_V3_POOL_ADDRESS  — $MIRROR/WMATIC V3 pool address
  UNISWAP_V3_ROUTER        — SwapRouter02 address on Polygon
  TRADE_AMOUNT_MIRROR      — Amount of $MIRROR per trade (in whole tokens)
  ARB_THRESHOLD_PCT        — Min % deviation to trigger a trade (default: 2.0)
  POLL_INTERVAL_SEC        — Sleep between polls in seconds (default: 12)
  MAX_GAS_GWEI             — Max gas price in Gwei (default: 200)
  SLIPPAGE_PCT             — Max acceptable slippage % (default: 0.5)

Usage:
  pip install web3 python-dotenv
  python scripts/qfs-trading-bot.py
  python scripts/qfs-trading-bot.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Optional

# ── Third-party imports (graceful missing-package message) ───────────────────
try:
    from dotenv import load_dotenv
    from web3 import Web3
    from web3.middleware import ExtraDataToPOAMiddleware
except ImportError as exc:
    print(f"❌  Missing dependency: {exc}")
    print("   Run:  pip install web3 python-dotenv")
    sys.exit(1)

# ── Load .env ─────────────────────────────────────────────────────────────────
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path)

# ── ABIs (minimal) ───────────────────────────────────────────────────────────
ERC20_ABI = json.loads('[{"inputs":[],"name":"decimals","outputs":[{"type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}],"name":"allowance","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"name":"approve","outputs":[{"type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"name":"account","type":"address"}],"name":"balanceOf","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"}]')

POOL_ABI = json.loads('[{"inputs":[],"name":"slot0","outputs":[{"name":"sqrtPriceX96","type":"uint160"},{"name":"tick","type":"int24"},{"name":"observationIndex","type":"uint16"},{"name":"observationCardinality","type":"uint16"},{"name":"observationCardinalityNext","type":"uint16"},{"name":"feeProtocol","type":"uint8"},{"name":"unlocked","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"token0","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"token1","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"fee","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]')

ROUTER_ABI = json.loads('[{"inputs":[{"components":[{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"fee","type":"uint24"},{"name":"recipient","type":"address"},{"name":"amountIn","type":"uint256"},{"name":"amountOutMinimum","type":"uint256"},{"name":"sqrtPriceLimitX96","type":"uint160"}],"name":"params","type":"tuple"}],"name":"exactInputSingle","outputs":[{"name":"amountOut","type":"uint256"}],"stateMutability":"payable","type":"function"}]')

# ── Configuration ─────────────────────────────────────────────────────────────

def _env(key: str, default: Optional[str] = None) -> str:
    v = os.getenv(key, default)
    if v is None:
        raise EnvironmentError(f"Missing required env var: {key}")
    return v

RPC_URL          = _env("POLYGON_RPC_URL",      "https://polygon-rpc.com")
MIRROR_ADDR      = _env("MIRROR_TOKEN_ADDRESS", "0x0000000000000000000000000000000000000000")
WMATIC_ADDR      = _env("MATIC_WMATIC_ADDRESS", "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270")
POOL_ADDR        = _env("UNISWAP_V3_POOL_ADDRESS","0x0000000000000000000000000000000000000000")
ROUTER_ADDR      = _env("UNISWAP_V3_ROUTER",    "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45")
TRADE_AMOUNT     = Decimal(_env("TRADE_AMOUNT_MIRROR",    "100"))
ARB_THRESHOLD    = float(_env("ARB_THRESHOLD_PCT",        "2.0"))
POLL_INTERVAL    = int(_env("POLL_INTERVAL_SEC",          "12"))
MAX_GAS_GWEI     = int(_env("MAX_GAS_GWEI",               "200"))
SLIPPAGE         = float(_env("SLIPPAGE_PCT",              "0.5"))

LOG_FILE = Path(__file__).parent.parent / "trades_log.jsonl"

# ── Web3 connection ───────────────────────────────────────────────────────────

def connect() -> Web3:
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to RPC: {RPC_URL}")
    return w3

# ── Price oracle ──────────────────────────────────────────────────────────────

def sqrt_price_x96_to_price(sqrt_price_x96: int, token0_decimals: int, token1_decimals: int, mirror_is_token0: bool) -> Decimal:
    """Convert Uniswap V3 sqrtPriceX96 → human-readable price of MIRROR in MATIC."""
    Q96 = Decimal(2 ** 96)
    sqrt_price = Decimal(sqrt_price_x96) / Q96
    price_raw = sqrt_price ** 2
    # Adjust for decimal difference
    adj = Decimal(10 ** (token1_decimals - token0_decimals))
    price_t0_in_t1 = price_raw * adj
    if mirror_is_token0:
        return price_t0_in_t1           # MIRROR price in MATIC
    else:
        return Decimal(1) / price_t0_in_t1

def get_pool_price(w3: Web3, pool, token0_addr: str, mirror_addr: str) -> Decimal:
    slot0 = pool.functions.slot0().call()
    sqrt_price_x96 = slot0[0]
    mirror_is_token0 = token0_addr.lower() == mirror_addr.lower()
    # On Polygon both MIRROR and WMATIC are 18 decimals
    return sqrt_price_x96_to_price(sqrt_price_x96, 18, 18, mirror_is_token0)

# ── EMA signal engine ─────────────────────────────────────────────────────────

class SignalEngine:
    """Dual-EMA cross-over + deviation gate.

    fast_ema (12 periods) > slow_ema (26 periods)  →  BUY signal
    fast_ema < slow_ema by threshold               →  SELL signal
    """
    def __init__(self, fast: int = 12, slow: int = 26):
        self.fast_k = Decimal(2) / (fast + 1)
        self.slow_k = Decimal(2) / (slow + 1)
        self.fast_ema: Optional[Decimal] = None
        self.slow_ema: Optional[Decimal] = None

    def update(self, price: Decimal) -> str:
        if self.fast_ema is None:
            self.fast_ema = price
            self.slow_ema = price
            return "HOLD"
        self.fast_ema = price * self.fast_k + self.fast_ema * (1 - self.fast_k)
        self.slow_ema = price * self.slow_k + self.slow_ema * (1 - self.slow_k)

        deviation_pct = float((self.fast_ema - self.slow_ema) / self.slow_ema * 100)

        if deviation_pct >= ARB_THRESHOLD:
            return "BUY"
        if deviation_pct <= -ARB_THRESHOLD:
            return "SELL"
        return "HOLD"

# ── Executor ──────────────────────────────────────────────────────────────────

def check_gas(w3: Web3) -> int:
    gas_gwei = w3.from_wei(w3.eth.gas_price, "gwei")
    if gas_gwei > MAX_GAS_GWEI:
        raise RuntimeError(f"Gas too high: {gas_gwei:.1f} Gwei > {MAX_GAS_GWEI} Gwei limit")
    return w3.eth.gas_price

def ensure_approval(w3: Web3, account, mirror_contract, router_addr: str, amount_wei: int):
    allowance = mirror_contract.functions.allowance(account.address, router_addr).call()
    if allowance < amount_wei:
        print(f"    Approving {router_addr[:10]}… for $MIRROR spend…")
        tx = mirror_contract.functions.approve(router_addr, 2**256 - 1).build_transaction({
            "from": account.address,
            "gas":  100_000,
            "gasPrice": w3.eth.gas_price,
            "nonce": w3.eth.get_transaction_count(account.address),
        })
        signed = account.sign_transaction(tx)
        w3.eth.send_raw_transaction(signed.raw_transaction)
        print("    ✅ Approval confirmed")

def execute_swap(
    w3: Web3,
    account,
    router,
    mirror_contract,
    pool,
    direction: str,
    current_price: Decimal,
    dry_run: bool = False,
) -> dict:
    """Execute a Uniswap V3 exactInputSingle swap."""
    gas_price = check_gas(w3)

    fee = pool.functions.fee().call()
    token0 = pool.functions.token0().call()
    mirror_is_token0 = token0.lower() == MIRROR_ADDR.lower()

    amount_in_wei = int(TRADE_AMOUNT * 10**18)
    slippage_mult = Decimal(1) - Decimal(str(SLIPPAGE)) / 100
    amount_out_min = int(TRADE_AMOUNT * current_price * slippage_mult * 10**18)

    if direction == "BUY":
        token_in  = WMATIC_ADDR
        token_out = MIRROR_ADDR
    else:  # SELL
        token_in  = MIRROR_ADDR
        token_out = WMATIC_ADDR
        ensure_approval(w3, account, mirror_contract, ROUTER_ADDR, amount_in_wei)

    params = (
        Web3.to_checksum_address(token_in),
        Web3.to_checksum_address(token_out),
        fee,
        account.address,
        amount_in_wei,
        amount_out_min,
        0,  # sqrtPriceLimitX96 = 0 (no price limit)
    )

    record = {
        "ts":         datetime.now(timezone.utc).isoformat(),
        "direction":  direction,
        "amount_in":  str(TRADE_AMOUNT),
        "price":      str(current_price),
        "gas_gwei":   str(w3.from_wei(gas_price, "gwei")),
        "tx_hash":    None,
        "dry_run":    dry_run,
    }

    if dry_run:
        print(f"    [DRY-RUN] Would swap {TRADE_AMOUNT} {direction} at {current_price:.6f} MATIC/$MIRROR")
        return record

    tx = router.functions.exactInputSingle(params).build_transaction({
        "from":     account.address,
        "gas":      300_000,
        "gasPrice": gas_price,
        "nonce":    w3.eth.get_transaction_count(account.address),
        "value":    amount_in_wei if direction == "BUY" else 0,
    })
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

    record["tx_hash"] = tx_hash.hex()
    record["status"]  = "success" if receipt.status == 1 else "reverted"

    print(f"    {'✅' if receipt.status == 1 else '❌'} Tx: {tx_hash.hex()}")
    return record

def append_log(record: dict):
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(record) + "\n")

# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VinelandEternal QFS Trading Bot")
    parser.add_argument("--dry-run", action="store_true", help="Print signals, execute no transactions")
    args = parser.parse_args()
    dry_run = args.dry_run

    print("\n════════════════════════════════════════════════════════════")
    print(" VinelandEternal — QFS Arbitrage / Trading Bot")
    if dry_run:
        print(" ⚠  DRY-RUN MODE — no transactions will be submitted")
    print("════════════════════════════════════════════════════════════\n")

    w3 = connect()
    print(f"  ✅ Connected to Polygon  (block #{w3.eth.block_number})")

    if not dry_run:
        pk = _env("BOT_PRIVATE_KEY")
        account = w3.eth.account.from_key(pk)
        print(f"  🔑 Wallet: {account.address}")
    else:
        account = None

    pool            = w3.eth.contract(address=Web3.to_checksum_address(POOL_ADDR),    abi=POOL_ABI)
    mirror_contract = w3.eth.contract(address=Web3.to_checksum_address(MIRROR_ADDR),  abi=ERC20_ABI)
    router          = w3.eth.contract(address=Web3.to_checksum_address(ROUTER_ADDR),  abi=ROUTER_ABI)
    token0_addr     = pool.functions.token0().call()

    engine = SignalEngine()
    tick   = 0

    print(f"\n  Polling every {POLL_INTERVAL}s | Threshold: ±{ARB_THRESHOLD}% | Trade: {TRADE_AMOUNT} $MIRROR\n")
    print("─" * 62)

    while True:
        try:
            price   = get_pool_price(w3, pool, token0_addr, MIRROR_ADDR)
            signal  = engine.update(price)
            ts      = datetime.now(timezone.utc).strftime("%H:%M:%S")
            fast    = engine.fast_ema or price
            slow    = engine.slow_ema or price
            dev_pct = float((fast - slow) / slow * 100)

            print(
                f"  [{ts}] tick={tick:>5} | price={float(price):.6f} MATIC | "
                f"EMA_f={float(fast):.6f} EMA_s={float(slow):.6f} | "
                f"dev={dev_pct:+.2f}% | 📡 {signal}"
            )

            if signal in ("BUY", "SELL"):
                print(f"\n  🤖 Signal: {signal} — executing swap…")
                record = execute_swap(
                    w3, account, router, mirror_contract, pool,
                    signal, price, dry_run=dry_run
                )
                append_log(record)
                print(f"  📝 Trade logged to {LOG_FILE.name}\n")

            tick += 1
            time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            print("\n\n  🛑 Bot stopped by user.")
            break
        except RuntimeError as e:
            # Gas too high, slippage, etc.
            print(f"  ⚠  Skipping tick: {e}")
            time.sleep(POLL_INTERVAL)
        except Exception as e:  # noqa: BLE001
            print(f"  ❌ Error: {e}")
            time.sleep(POLL_INTERVAL * 2)

if __name__ == "__main__":
    main()
