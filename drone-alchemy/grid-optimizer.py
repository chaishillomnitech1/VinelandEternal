"""
grid-optimizer.py — VinelandEternal Drone Alchemy: Tri-State Grid Path Optimizer

Computes optimal drone delivery routes across the NJ / PA / DE surplus nodes
using a linear-programming formulation (PuLP). Integrates with the IoT Agape
dashboard to discover surplus trays and dispatches the flight plan to the
DroneKit-compatible flight controller.

Usage:
    pip install pulp requests
    python grid-optimizer.py
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from typing import Optional

try:
    import pulp
except ImportError:  # pragma: no cover
    pulp = None  # type: ignore

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class Node:
    """A supply or demand location in the drone grid."""
    node_id: str
    name: str
    lat: float
    lon: float
    surplus_g: float = 0.0      # grams available to send
    demand_g: float = 0.0       # grams needed
    node_type: str = "hub"      # "supply", "demand", or "hub"


@dataclass
class FlightLeg:
    """A single drone leg between two nodes."""
    origin: str
    destination: str
    distance_km: float
    payload_g: float
    agape_value: float = 0.0


@dataclass
class FlightPlan:
    """Complete optimized flight plan for one dispatch cycle."""
    legs: list[FlightLeg] = field(default_factory=list)
    total_distance_km: float = 0.0
    total_payload_g: float = 0.0
    carbon_saved_g: float = 0.0

    def summary(self) -> dict:
        return {
            "legs": len(self.legs),
            "total_distance_km": round(self.total_distance_km, 2),
            "total_payload_g": round(self.total_payload_g, 2),
            "carbon_saved_g": round(self.carbon_saved_g, 2),
            "route": [f"{l.origin} → {l.destination}" for l in self.legs],
        }


# ---------------------------------------------------------------------------
# Seed nodes — Tri-state Vineland grid
# ---------------------------------------------------------------------------

EAST_COAST_NODES: list[Node] = [
    Node("vineland",    "Vineland Sanctuary, NJ",      39.4862, -75.0255, surplus_g=0.0,   demand_g=0.0,   node_type="hub"),
    Node("camden",      "Camden Community Hub, NJ",    39.9259, -75.1196, surplus_g=0.0,   demand_g=300.0, node_type="demand"),
    Node("trenton",     "Trenton Food Bank, NJ",       40.2171, -74.7429, surplus_g=0.0,   demand_g=200.0, node_type="demand"),
    Node("philadelphia","Philadelphia Co-Op, PA",       39.9526, -75.1652, surplus_g=0.0,   demand_g=400.0, node_type="demand"),
    Node("wilmington",  "Wilmington Node, DE",          39.7447, -75.5484, surplus_g=0.0,   demand_g=150.0, node_type="demand"),
    Node("atlantic",    "Atlantic City Hub, NJ",        39.3643, -74.4229, surplus_g=0.0,   demand_g=100.0, node_type="demand"),
]

WEST_COAST_NODES: list[Node] = [
    Node("seattle",       "Seattle Sanctuary, WA",           47.6062, -122.3321, surplus_g=0.0,  demand_g=0.0,   node_type="hub"),
    Node("seattle-south", "South Seattle Community Hub, WA", 47.5437, -122.2929, surplus_g=0.0,  demand_g=250.0, node_type="demand"),
    Node("tacoma",        "Tacoma Food Bank, WA",            47.2529, -122.4443, surplus_g=0.0,  demand_g=180.0, node_type="demand"),
    Node("portland",      "Portland Sanctuary, OR",          45.5051, -122.6750, surplus_g=0.0,  demand_g=0.0,   node_type="hub"),
    Node("portland-east", "East Portland Co-Op, OR",         45.5231, -122.5957, surplus_g=0.0,  demand_g=220.0, node_type="demand"),
    Node("sf",            "San Francisco Sanctuary, CA",     37.7749, -122.4194, surplus_g=0.0,  demand_g=0.0,   node_type="hub"),
    Node("oakland",       "Oakland Community Hub, CA",       37.8044, -122.2712, surplus_g=0.0,  demand_g=350.0, node_type="demand"),
    Node("san-jose",      "San José Food Bank, CA",          37.3382, -121.8863, surplus_g=0.0,  demand_g=200.0, node_type="demand"),
]

# Backward-compatible alias (keeps existing callers working)
DEFAULT_NODES: list[Node] = EAST_COAST_NODES

# Registry of all supported deployment regions
REGIONS: dict[str, list[Node]] = {
    "east-coast": EAST_COAST_NODES,
    "west-coast": WEST_COAST_NODES,
}


def get_nodes_for_region(region: str) -> list[Node]:
    """Return a deep copy of the node list for *region* (case-insensitive)."""
    import copy
    key = region.lower().replace("_", "-")
    if key not in REGIONS:
        raise ValueError(f"Unknown region '{region}'. Valid options: {list(REGIONS.keys())}")
    return copy.deepcopy(REGIONS[key])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in kilometres between two coordinates."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def carbon_saved_g(distance_km: float, payload_g: float) -> float:
    """
    Estimate carbon saved vs. van delivery.
    Assumption: van emits ~271 g CO₂/km; drone emits ~10 g CO₂/km.
    """
    return max(0.0, (271 - 10) * distance_km * (payload_g / 1000))


# ---------------------------------------------------------------------------
# Surplus discovery via IoT dashboard
# ---------------------------------------------------------------------------

DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:5000")


def fetch_surplus_from_dashboard(nodes: list[Node], region: str = "east-coast") -> list[Node]:
    """
    Call the IoT Agape dashboard surplus endpoint and update node surplus_g.
    Falls back to sample values when the dashboard is unreachable.
    """
    hub_id = next((n.node_id for n in nodes if n.node_type == "hub"), None)
    sample_surplus = {hub_id: 800.0} if hub_id else {}

    if requests is not None:
        try:
            resp = requests.get(f"{DASHBOARD_URL}/api/agape/surplus", timeout=3)
            if resp.ok:
                for tray in resp.json():
                    # Each surplus tray contributes 100 g of deliverable surplus to the hub
                    if hub_id:
                        sample_surplus[hub_id] = sample_surplus.get(hub_id, 0) + 100
        except Exception:
            pass

    node_map = {n.node_id: n for n in nodes}
    for nid, surplus in sample_surplus.items():
        if nid in node_map:
            node_map[nid].surplus_g = surplus
            node_map[nid].node_type = "supply"

    return nodes


# ---------------------------------------------------------------------------
# LP-based route optimizer
# ---------------------------------------------------------------------------

MAX_DRONE_PAYLOAD_G = 500.0  # grams per flight leg


def optimize_routes(nodes: list[Node]) -> FlightPlan:
    """
    Solve a minimum-distance transportation problem using PuLP.
    Falls back to a greedy nearest-neighbour heuristic when PuLP is unavailable.
    """
    supply_nodes = [n for n in nodes if n.node_type == "supply" and n.surplus_g > 0]
    demand_nodes = [n for n in nodes if n.node_type == "demand" and n.demand_g > 0]

    if not supply_nodes or not demand_nodes:
        return FlightPlan()

    if pulp is None:
        return _greedy_routes(supply_nodes, demand_nodes, nodes)

    # Build cost matrix
    node_map = {n.node_id: n for n in nodes}
    prob = pulp.LpProblem("DroneGrid", pulp.LpMinimize)

    routes = [
        (s.node_id, d.node_id)
        for s in supply_nodes
        for d in demand_nodes
    ]

    flow = pulp.LpVariable.dicts(
        "flow",
        routes,
        lowBound=0,
        upBound=MAX_DRONE_PAYLOAD_G,
        cat="Continuous",
    )

    dist = {
        (s, d): haversine_km(node_map[s].lat, node_map[s].lon, node_map[d].lat, node_map[d].lon)
        for s, d in routes
    }

    # Minimise total distance weighted by payload
    prob += pulp.lpSum(dist[(s, d)] * flow[(s, d)] for s, d in routes)

    # Supply constraints
    for s in supply_nodes:
        prob += pulp.lpSum(flow[(s.node_id, d.node_id)] for d in demand_nodes) <= s.surplus_g

    # Demand constraints
    for d in demand_nodes:
        prob += pulp.lpSum(flow[(s.node_id, d.node_id)] for s in supply_nodes) <= d.demand_g

    prob.solve(pulp.PULP_CBC_CMD(msg=False))

    plan = FlightPlan()
    for (s_id, d_id), var in flow.items():
        payload = var.varValue or 0.0
        if payload > 0.1:
            d_km = dist[(s_id, d_id)]
            leg = FlightLeg(
                origin=s_id,
                destination=d_id,
                distance_km=round(d_km, 2),
                payload_g=round(payload, 1),
                agape_value=min(100, round(payload / 10)),
            )
            plan.legs.append(leg)
            plan.total_distance_km += d_km
            plan.total_payload_g += payload
            plan.carbon_saved_g += carbon_saved_g(d_km, payload)

    return plan


def _greedy_routes(supply_nodes: list[Node], demand_nodes: list[Node], all_nodes: list[Node]) -> FlightPlan:
    """Simple greedy nearest-neighbour fallback when PuLP is not installed."""
    plan = FlightPlan()
    remaining_supply = {n.node_id: n.surplus_g for n in supply_nodes}
    remaining_demand = {n.node_id: n.demand_g for n in demand_nodes}
    node_map = {n.node_id: n for n in all_nodes}

    for s_id, avail in remaining_supply.items():
        s = node_map[s_id]
        sorted_demand = sorted(
            [(d_id, haversine_km(s.lat, s.lon, node_map[d_id].lat, node_map[d_id].lon))
             for d_id in remaining_demand],
            key=lambda x: x[1],
        )
        for d_id, d_km in sorted_demand:
            if avail <= 0:
                break
            payload = min(avail, remaining_demand[d_id], MAX_DRONE_PAYLOAD_G)
            if payload <= 0:
                continue
            plan.legs.append(FlightLeg(
                origin=s_id,
                destination=d_id,
                distance_km=round(d_km, 2),
                payload_g=round(payload, 1),
                agape_value=min(100, round(payload / 10)),
            ))
            plan.total_distance_km += d_km
            plan.total_payload_g += payload
            plan.carbon_saved_g += carbon_saved_g(d_km, payload)
            avail -= payload
            remaining_demand[d_id] -= payload

    return plan


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse as _argparse

    _parser = _argparse.ArgumentParser(description="VinelandEternal Drone Grid Optimizer")
    _parser.add_argument(
        "--region",
        choices=list(REGIONS.keys()),
        default="east-coast",
        help="Deployment region to optimise (default: east-coast)",
    )
    _args = _parser.parse_args()

    nodes = get_nodes_for_region(_args.region)
    nodes = fetch_surplus_from_dashboard(nodes, region=_args.region)
    plan = optimize_routes(nodes)
    print(f"\n🚁 VinelandEternal Drone Grid — {_args.region.title()} — Optimized Flight Plan")
    print(json.dumps(plan.summary(), indent=2))
    print(f"\n✅ {len(plan.legs)} leg(s) | "
          f"{plan.total_payload_g:.0f} g delivered | "
          f"{plan.carbon_saved_g:.0f} g CO₂ saved")
