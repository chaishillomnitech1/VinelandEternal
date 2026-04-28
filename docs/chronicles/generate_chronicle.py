"""
generate_chronicle.py — VinelandEternal Omni-Pulse Daily Chronicle Generator

Reads the current IoT sensor state via the sensor-dashboard module and writes
a dated Markdown summary to docs/chronicles/YYYY-MM-DD.md.

Usage:
    python docs/chronicles/generate_chronicle.py
"""

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

# Resolve paths relative to this script so the file works from any CWD
SCRIPT_DIR = Path(__file__).resolve().parent          # docs/chronicles/
REPO_ROOT  = SCRIPT_DIR.parent.parent                  # repo root
OUT_DIR    = SCRIPT_DIR


# ---------------------------------------------------------------------------
# Sensor module loader
# ---------------------------------------------------------------------------

def _load_sensor_module():
    """Import sensor-dashboard.py without requiring it on sys.path."""
    sensor_path = REPO_ROOT / "iot-agape" / "sensor-dashboard.py"
    spec = importlib.util.spec_from_file_location("sensor_dashboard", str(sensor_path))
    module = importlib.util.module_from_spec(spec)
    sys.modules["sensor_dashboard"] = module
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Chronicle generation
# ---------------------------------------------------------------------------

def generate_chronicle(trays: list, date: datetime) -> str:
    """Return the full Markdown text for one day's chronicle."""
    total    = len(trays)
    surplus  = [t for t in trays if t.get("agape_value", 0) >= 90]
    growing  = [t for t in trays if 70 <= t.get("agape_value", 0) < 90]
    critical = [t for t in trays if t.get("agape_value", 0) < 70]
    avg_agape = (
        round(sum(t.get("agape_value", 0) for t in trays) / total, 1)
        if total else 0.0
    )

    # Overall state description
    if total == 0:
        state_line = "⚠️ **NO DATA** — No trays reported. Check IoT connection."
    elif len(surplus) == total:
        state_line = "🌊 **FULL FLOW** — All trays at surplus capacity. Redistribution recommended."
    elif len(surplus) > total // 2:
        state_line = "🌊 **STRONG FLOW** — Majority of trays at surplus. Agape Ocean is abundant."
    elif len(critical) > total // 2:
        state_line = "⚠️ **LOW TIDE** — Majority of trays need attention. Review water and soil."
    else:
        state_line = "🌱 **GROWING** — Sanctuary is in active growth phase."

    lines = [
        f"# VinelandEternal Daily Chronicle — {date.strftime('%Y-%m-%d')}",
        "",
        f"> Generated at {date.strftime('%Y-%m-%dT%H:%M:%SZ')} UTC "
        f"by the Omni-Pulse workflow.",
        "",
        "## Agape Ocean State",
        "",
        state_line,
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Trays Monitored | {total} |",
        f"| Surplus Ready (Agape ≥ 90) | {len(surplus)} |",
        f"| Growing (Agape 70–89) | {len(growing)} |",
        f"| Needs Attention (Agape < 70) | {len(critical)} |",
        f"| Average Agape Score | {avg_agape} |",
        "",
        "## Tray Status",
        "",
        "| Tray | Crop | Water | Soil | Sun | Agape | Status |",
        "|------|------|-------|------|-----|-------|--------|",
    ]

    for t in trays:
        av     = t.get("agape_value", 0)
        status = "🟢 Surplus" if av >= 90 else ("🟡 Growing" if av >= 70 else "🔴 Needs Attention")
        lines.append(
            f"| {t['tray_id']} | {t.get('crop', '?')} "
            f"| {t.get('water', 0)}% | {t.get('soil', 0)}% "
            f"| {t.get('sun', 0)}% | {av} | {status} |"
        )

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Entry-point
# ---------------------------------------------------------------------------

def main():
    now      = datetime.now(tz=timezone.utc)
    out_file = OUT_DIR / f"{now.strftime('%Y-%m-%d')}.md"

    module = _load_sensor_module()
    client = module.app.test_client()
    trays  = client.get("/api/agape").get_json()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    content = generate_chronicle(trays, now)

    with open(out_file, "w") as fh:
        fh.write(content)

    print(f"Chronicle written → {out_file}")


if __name__ == "__main__":
    main()
