"""
lunar_dispatch_sim.py — VinelandEternal Cosmic Co-Op: Lunar Surplus Dispatch Simulation

Connects live IoT tray data (from iot-agape/sensor-dashboard.py) to the
lunar nexus dispatch-readiness check (cosmic-coop/lunar_nexus.py).

Simulation steps:
  1. Load current sensor readings from the in-memory tray registry.
  2. Compute total surplus (g) using an agape-weighted harvest model.
  3. Compute the network-wide average agape score.
  4. Evaluate dispatch readiness against lunar.nexus.json thresholds.
  5. For each reachable lunar destination, build a manifest showing
     compressed-seed payload, estimated transit days, and cost.

Usage:
    python lunar_dispatch_sim.py [--verbose] [--tray-yield-g N]

Library:
    from cosmic_coop import lunar_dispatch_sim as lds
    result = lds.run_simulation()
    print(result['dispatch_ready'], result['reason'])
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Path wiring — works whether run from repo root or from cosmic-coop/
# ---------------------------------------------------------------------------

_THIS_DIR   = Path(__file__).resolve().parent
_IOT_DIR    = _THIS_DIR.parent / "iot-agape"
_NEXUS_JSON = _THIS_DIR / "lunar.nexus.json"

# Allow sibling imports regardless of working directory
for _p in (_THIS_DIR, _IOT_DIR):
    _ps = str(_p)
    if _ps not in sys.path:
        sys.path.insert(0, _ps)

# ---------------------------------------------------------------------------
# Harvest model constants
# ---------------------------------------------------------------------------

# Grams of harvestable greens produced per tray per simulation cycle
# when agape_value is at maximum (100).  Scales linearly with agape_value.
HARVEST_G_AT_MAX_AGAPE: float = 500.0

# Surplus threshold below which a tray is considered "at-consumption" (not surplus)
# expressed as a fraction of max harvest.
SURPLUS_FRACTION_THRESHOLD: float = 0.60


# ---------------------------------------------------------------------------
# Tray snapshot
# ---------------------------------------------------------------------------

@dataclass
class TraySnapshot:
    tray_id:         str
    crop:            str
    location:        str
    agape_value:     float
    harvest_g:       float        # estimated harvestable grams this cycle
    surplus_g:       float        # portion above consumption threshold
    is_surplus:      bool

    @classmethod
    def from_sensor(
        cls,
        tray_id: str,
        sensor: dict,
        yield_scale_g: float = HARVEST_G_AT_MAX_AGAPE,
    ) -> "TraySnapshot":
        agape = float(sensor.get("agape_value", 0))
        harvest_g = round(yield_scale_g * (agape / 100.0), 1)
        threshold_g = yield_scale_g * SURPLUS_FRACTION_THRESHOLD
        surplus_g = max(0.0, harvest_g - threshold_g)
        return cls(
            tray_id=tray_id,
            crop=str(sensor.get("crop", "Unknown")),
            location=str(sensor.get("location", "Unknown")),
            agape_value=agape,
            harvest_g=harvest_g,
            surplus_g=round(surplus_g, 1),
            is_surplus=surplus_g > 0,
        )


# ---------------------------------------------------------------------------
# Manifest entry for a single lunar destination
# ---------------------------------------------------------------------------

@dataclass
class DestinationManifest:
    destination_id:      str
    destination_label:   str
    demand_g:            int
    seed_package_g:      float        # compressed seed payload to send
    nutrient_package_g:  float        # compressed nutrient payload to send
    total_payload_g:     float
    within_limit:        bool
    payload_limit_g:     int
    transit_days:        float
    delta_v_km_s:        float
    cost_usd:            float
    notes:               str = ""


# ---------------------------------------------------------------------------
# Simulation result
# ---------------------------------------------------------------------------

@dataclass
class SimulationResult:
    simulated_at:       str
    tray_count:         int
    surplus_tray_count: int
    total_harvest_g:    float
    total_surplus_g:    float
    avg_agape:          float
    dispatch_ready:     bool
    reason:             str
    manifests:          list[DestinationManifest] = field(default_factory=list)
    snapshots:          list[TraySnapshot]        = field(default_factory=list)


# ---------------------------------------------------------------------------
# Core simulation
# ---------------------------------------------------------------------------

def _load_sensors() -> dict:
    """
    Import the sensors dict from iot-agape/sensor-dashboard.py.
    Falls back to an empty dict if the module cannot be loaded
    (e.g. Flask/paho not installed in the test environment).
    """
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "sensor_dashboard",
            _IOT_DIR / "sensor-dashboard.py",
        )
        if spec is None or spec.loader is None:
            return {}
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        return dict(mod.sensors)
    except Exception:
        return {}


def _load_nexus() -> dict:
    with open(_NEXUS_JSON, encoding="utf-8") as fh:
        return json.load(fh)


def run_simulation(
    sensors: dict | None = None,
    tray_yield_g: float = HARVEST_G_AT_MAX_AGAPE,
) -> SimulationResult:
    """
    Run the full surplus → lunar dispatch simulation.

    Parameters
    ----------
    sensors : dict, optional
        Tray sensor dict in the same format as iot-agape/sensor-dashboard.py.
        If None, loads live data from the dashboard module.
    tray_yield_g : float
        Maximum harvest grams per tray at agape_value=100.

    Returns
    -------
    SimulationResult
    """
    if sensors is None:
        sensors = _load_sensors()

    nexus = _load_nexus()
    supply_logic = nexus["supply_logic"]
    seed_ratio      = float(supply_logic["seed_compression_ratio"])
    nutrient_ratio  = float(supply_logic["nutrient_concentrate_ratio"])

    # ---- Step 1: snapshot every tray ----------------------------------------
    snapshots = [
        TraySnapshot.from_sensor(tid, data, yield_scale_g=tray_yield_g)
        for tid, data in sensors.items()
    ]

    # ---- Step 2: aggregate metrics ------------------------------------------
    total_harvest_g = round(sum(s.harvest_g for s in snapshots), 1)
    total_surplus_g = round(sum(s.surplus_g for s in snapshots), 1)
    avg_agape = (
        round(sum(s.agape_value for s in snapshots) / len(snapshots), 2)
        if snapshots else 0.0
    )

    # ---- Step 3: dispatch readiness -----------------------------------------
    sys.path.insert(0, str(_THIS_DIR))
    import lunar_nexus as ln
    dispatch_ready, reason = ln.evaluate_dispatch_readiness(
        surplus_g=total_surplus_g,
        avg_agape=avg_agape,
    )

    # ---- Step 4: manifests for reachable lunar surface nodes ----------------
    manifests: list[DestinationManifest] = []
    lunar_nodes = ln.nodes_by_type("lunar_surface")
    supply_routes = {
        (e.source, e.target): e for e in ln.supply_routes()
    }

    # Build a simple end-to-end route summary for each earth anchor → surface
    earth_anchors = [n.id for n in ln.nodes_by_type("earth_anchor")]

    for lnode in lunar_nodes:
        # Find the cheapest / first available Earth anchor that can reach this node
        best_edge: Any = None
        for anchor in earth_anchors:
            # Walk: anchor → LEO → gateway → surface (hardcoded 3-hop chain)
            # Collect all legs for this path
            leg1 = supply_routes.get((anchor, "leo_staging"))
            leg2 = supply_routes.get(("leo_staging", "lunar_gateway"))
            leg3 = supply_routes.get(("lunar_gateway", lnode.id))
            if leg1 and leg2 and leg3:
                if best_edge is None:
                    best_edge = (leg1, leg2, leg3)
                break  # first valid route is enough for the manifest

        if best_edge is None:
            # Fallback: try a direct 2-hop (anchor → gateway → surface)
            for anchor in earth_anchors:
                leg1 = supply_routes.get((anchor, "lunar_gateway"))
                leg3 = supply_routes.get(("lunar_gateway", lnode.id))
                if leg1 and leg3:
                    best_edge = (leg1, leg3)
                    break

        if best_edge is None:
            continue

        legs = best_edge
        payload_limit_g = min(leg.payload_limit_g for leg in legs)
        total_transit   = round(sum(leg.transit_days for leg in legs), 3)
        total_dv        = round(sum(leg.delta_v_km_s for leg in legs), 2)
        cost_per_kg     = max(leg.cost_per_kg_usd for leg in legs)

        # Payload = compressed seeds + nutrient concentrate
        seed_payload_g     = round(min(total_surplus_g * seed_ratio, lnode.demand_g * seed_ratio), 2)
        nutrient_payload_g = round(seed_payload_g * (nutrient_ratio / seed_ratio), 2)
        total_payload_g    = round(seed_payload_g + nutrient_payload_g, 2)

        cost_usd = round(total_payload_g / 1000.0 * cost_per_kg, 2)

        manifests.append(DestinationManifest(
            destination_id=lnode.id,
            destination_label=lnode.label,
            demand_g=lnode.demand_g,
            seed_package_g=seed_payload_g,
            nutrient_package_g=nutrient_payload_g,
            total_payload_g=total_payload_g,
            within_limit=total_payload_g <= payload_limit_g,
            payload_limit_g=payload_limit_g,
            transit_days=total_transit,
            delta_v_km_s=total_dv,
            cost_usd=cost_usd,
        ))

    return SimulationResult(
        simulated_at=datetime.now(timezone.utc).isoformat(),
        tray_count=len(snapshots),
        surplus_tray_count=sum(1 for s in snapshots if s.is_surplus),
        total_harvest_g=total_harvest_g,
        total_surplus_g=total_surplus_g,
        avg_agape=avg_agape,
        dispatch_ready=dispatch_ready,
        reason=reason,
        manifests=manifests,
        snapshots=snapshots,
    )


# ---------------------------------------------------------------------------
# Pretty-print report
# ---------------------------------------------------------------------------

def print_report(result: SimulationResult, verbose: bool = False) -> None:
    icon = "✅" if result.dispatch_ready else "⛔"
    print()
    print("═" * 66)
    print("  🌕  VinelandEternal — Lunar Surplus Dispatch Simulation")
    print(f"  {result.simulated_at}")
    print("═" * 66)
    print(f"  Trays monitored   : {result.tray_count}")
    print(f"  Surplus trays     : {result.surplus_tray_count}/{result.tray_count}")
    print(f"  Total harvest     : {result.total_harvest_g:,.1f} g")
    print(f"  Total surplus     : {result.total_surplus_g:,.1f} g")
    print(f"  Avg agape score   : {result.avg_agape:.2f}")
    print()
    print(f"  {icon} Dispatch status   : {result.reason}")
    print()

    if result.manifests:
        print("  ── Lunar Destination Manifests ──────────────────────────────")
        for m in result.manifests:
            limit_ok = "✓" if m.within_limit else "✗ OVER LIMIT"
            print(f"\n  📍 {m.destination_label}")
            print(f"     Demand              : {m.demand_g} g")
            print(f"     Seed package        : {m.seed_package_g} g")
            print(f"     Nutrient package    : {m.nutrient_package_g} g")
            print(f"     Total payload       : {m.total_payload_g} g  "
                  f"(limit {m.payload_limit_g} g)  [{limit_ok}]")
            print(f"     Δv to destination   : {m.delta_v_km_s} km/s")
            print(f"     Transit time        : {m.transit_days} days")
            print(f"     Estimated cost      : ${m.cost_usd:,.2f}")

    if verbose and result.snapshots:
        print("\n  ── Tray Snapshots ───────────────────────────────────────────")
        for s in sorted(result.snapshots, key=lambda x: x.agape_value, reverse=True):
            surplus_tag = "🟢 surplus" if s.is_surplus else "🔴 at-consumption"
            print(
                f"  {s.tray_id:12} {s.crop:18} agape={s.agape_value:5.1f}  "
                f"harvest={s.harvest_g:6.1f}g  surplus={s.surplus_g:6.1f}g  "
                f"{surplus_tag}"
            )

    print()
    print("═" * 66)
    print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="VinelandEternal Lunar Dispatch Simulation — IoT → Cislunar supply chain",
    )
    parser.add_argument(
        "--tray-yield-g", type=float, default=HARVEST_G_AT_MAX_AGAPE,
        help=f"Max harvest grams per tray at agape=100 (default: {HARVEST_G_AT_MAX_AGAPE})",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Print individual tray snapshots",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Emit machine-readable JSON instead of the human report",
    )
    args = parser.parse_args()

    result = run_simulation(tray_yield_g=args.tray_yield_g)

    if args.json:
        # Convert dataclasses to plain dict for JSON serialisation
        d = asdict(result)
        print(json.dumps(d, indent=2))
    else:
        print_report(result, verbose=args.verbose)


if __name__ == "__main__":
    main()
