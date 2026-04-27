"""
lunar_nexus.py — VinelandEternal Cosmic Co-Op: Lunar Nexus Graph Helper

Loads lunar.nexus.json, queries nodes/edges by body or type, evaluates the
dispatch-readiness of Earth surplus for lunar supply runs, and can merge the
lunar sub-graph into an existing networkx nexus graph produced by
gitnexus_mapper.py.

Usage (standalone):
    pip install networkx
    python lunar_nexus.py [--status] [--surplus-g 6000] [--avg-agape 93]

Usage (library):
    from cosmic-coop import lunar_nexus
    graph = lunar_nexus.load_lunar_graph()
    ready, reason = lunar_nexus.evaluate_dispatch_readiness(surplus_g=6000, avg_agape=93)
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import networkx as nx
    _NX_AVAILABLE = True
except ImportError:  # pragma: no cover
    _NX_AVAILABLE = False  # type: ignore

NEXUS_PATH = Path(__file__).resolve().parent / "lunar.nexus.json"


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_nexus_data(path: Path = NEXUS_PATH) -> dict:
    """Load and return the raw lunar.nexus.json dict."""
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


@dataclass
class LunarNode:
    """A single node from the lunar nexus graph."""
    id:               str
    label:            str
    node_type:        str
    body:             str
    location:         str
    altitude_km:      float
    surplus_capacity_g: int
    demand_g:         int
    launch_ready:     bool
    crops:            list[str]

    @classmethod
    def from_dict(cls, d: dict) -> "LunarNode":
        return cls(
            id=d["id"],
            label=d["label"],
            node_type=d["node_type"],
            body=d["body"],
            location=d["location"],
            altitude_km=float(d.get("altitude_km") or 0.0),
            surplus_capacity_g=int(d.get("surplus_capacity_g", 0)),
            demand_g=int(d.get("demand_g", 0)),
            launch_ready=bool(d.get("launch_ready", False)),
            crops=list(d.get("crops", [])),
        )


@dataclass
class LunarEdge:
    """A single edge (supply route or telemetry link) in the lunar nexus."""
    source:           str
    target:           str
    edge_type:        str
    transport:        str
    delta_v_km_s:     float
    transit_days:     float
    cost_per_kg_usd:  int
    payload_limit_g:  int

    @classmethod
    def from_dict(cls, d: dict) -> "LunarEdge":
        return cls(
            source=d["source"],
            target=d["target"],
            edge_type=d["edge_type"],
            transport=d["transport"],
            delta_v_km_s=float(d.get("delta_v_km_s", 0)),
            transit_days=float(d.get("transit_days", 0)),
            cost_per_kg_usd=int(d.get("cost_per_kg_usd", 0)),
            payload_limit_g=int(d.get("payload_limit_g", 0)),
        )


def load_lunar_nodes(path: Path = NEXUS_PATH) -> list[LunarNode]:
    """Return all nodes from the lunar nexus as LunarNode objects."""
    data = load_nexus_data(path)
    return [LunarNode.from_dict(n) for n in data["nodes"]]


def load_lunar_edges(path: Path = NEXUS_PATH) -> list[LunarEdge]:
    """Return all edges from the lunar nexus as LunarEdge objects."""
    data = load_nexus_data(path)
    return [LunarEdge.from_dict(e) for e in data["edges"]]


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def nodes_by_body(body: str, path: Path = NEXUS_PATH) -> list[LunarNode]:
    """Filter nodes by celestial body name (e.g. 'Moon', 'Earth')."""
    return [n for n in load_lunar_nodes(path) if n.body.lower() == body.lower()]


def nodes_by_type(node_type: str, path: Path = NEXUS_PATH) -> list[LunarNode]:
    """Filter nodes by type (earth_anchor | orbital_relay | lunar_surface)."""
    return [n for n in load_lunar_nodes(path) if n.node_type == node_type]


def supply_routes(path: Path = NEXUS_PATH) -> list[LunarEdge]:
    """Return edges whose type is 'supply_route'."""
    return [e for e in load_lunar_edges(path) if e.edge_type == "supply_route"]


def total_delta_v(source_id: str, target_id: str, path: Path = NEXUS_PATH) -> float:
    """
    Sum delta-v (km/s) along the shortest hop-chain from source to target.
    Returns 0.0 when source == target; raises ValueError if no path exists.
    """
    if source_id == target_id:
        return 0.0
    routes = {(e.source, e.target): e.delta_v_km_s for e in supply_routes(path)}
    # Simple BFS over supply-route edges
    from collections import deque
    queue: deque[tuple[str, float]] = deque([(source_id, 0.0)])
    visited: set[str] = {source_id}
    while queue:
        current, dv = queue.popleft()
        for (src, dst), leg_dv in routes.items():
            if src == current and dst not in visited:
                total = dv + leg_dv
                if dst == target_id:
                    return round(total, 4)
                visited.add(dst)
                queue.append((dst, total))
    raise ValueError(f"No supply route from '{source_id}' to '{target_id}'")


# ---------------------------------------------------------------------------
# Dispatch readiness
# ---------------------------------------------------------------------------

def evaluate_dispatch_readiness(
    surplus_g: float,
    avg_agape: float,
    path: Path = NEXUS_PATH,
) -> tuple[bool, str]:
    """
    Evaluate whether current Earth surplus meets the thresholds defined in
    lunar.nexus.json to trigger a lunar supply dispatch.

    Returns (ready: bool, reason: str).
    """
    data = load_nexus_data(path)
    logic = data["supply_logic"]
    threshold_agape   = float(logic["agape_threshold_for_lunar_dispatch"])
    threshold_surplus = float(logic["min_earth_surplus_g_before_lunar_dispatch"])

    surplus_ok = surplus_g >= threshold_surplus
    agape_ok   = avg_agape >= threshold_agape

    if surplus_ok and agape_ok:
        return True, (
            f"READY — surplus {surplus_g:.0f}g ≥ {threshold_surplus:.0f}g "
            f"and avg_agape {avg_agape:.1f} ≥ {threshold_agape:.1f}"
        )
    reasons = []
    if not surplus_ok:
        reasons.append(
            f"surplus {surplus_g:.0f}g < required {threshold_surplus:.0f}g"
        )
    if not agape_ok:
        reasons.append(
            f"avg_agape {avg_agape:.1f} < required {threshold_agape:.1f}"
        )
    return False, "NOT READY — " + "; ".join(reasons)


# ---------------------------------------------------------------------------
# networkx integration
# ---------------------------------------------------------------------------

def build_lunar_graph(path: Path = NEXUS_PATH) -> Any:
    """
    Build a networkx DiGraph from lunar.nexus.json.
    Raises ImportError if networkx is not installed.
    """
    if not _NX_AVAILABLE:
        raise ImportError("networkx is required: pip install networkx")

    nodes = load_lunar_nodes(path)
    edges = load_lunar_edges(path)

    G = nx.DiGraph()
    for n in nodes:
        G.add_node(
            n.id,
            label=n.label,
            node_type=n.node_type,
            body=n.body,
            location=n.location,
            altitude_km=n.altitude_km,
            surplus_capacity_g=n.surplus_capacity_g,
            demand_g=n.demand_g,
            launch_ready=n.launch_ready,
            crops=n.crops,
        )
    for e in edges:
        G.add_edge(
            e.source,
            e.target,
            edge_type=e.edge_type,
            transport=e.transport,
            delta_v_km_s=e.delta_v_km_s,
            transit_days=e.transit_days,
            cost_per_kg_usd=e.cost_per_kg_usd,
            payload_limit_g=e.payload_limit_g,
        )
    return G


def merge_into_nexus(main_graph: Any, path: Path = NEXUS_PATH) -> Any:
    """
    Merge lunar nodes/edges into an existing networkx nexus graph produced by
    gitnexus_mapper.py.  Returns the combined graph.
    """
    lunar_graph = build_lunar_graph(path)
    combined = nx.compose(main_graph, lunar_graph)
    return combined


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print_status(path: Path = NEXUS_PATH) -> None:
    data  = load_nexus_data(path)
    nodes = load_lunar_nodes(path)
    edges = load_lunar_edges(path)

    print(f"\n🌕 VinelandEternal Lunar Nexus — {data['description']}")
    print(f"   Schema: v{data['schema_version']}  |  Generated: {data['generated_at']}")
    print(f"   Nodes:  {len(nodes)}   Edges: {len(edges)}\n")

    earth_nodes = nodes_by_body("Earth", path)
    lunar_nodes = nodes_by_body("Moon", path)
    relay_nodes = nodes_by_type("orbital_relay", path)

    print(f"  Earth anchors  ({len(earth_nodes)}):")
    for n in earth_nodes:
        print(f"    [{n.id}]  {n.label}  surplus_cap={n.surplus_capacity_g}g")

    print(f"\n  Orbital relays ({len(relay_nodes)}):")
    for n in relay_nodes:
        print(f"    [{n.id}]  {n.label}  demand={n.demand_g}g")

    print(f"\n  Lunar surface  ({len(lunar_nodes)}):")
    for n in lunar_nodes:
        print(f"    [{n.id}]  {n.label}  demand={n.demand_g}g  crops={n.crops}")

    print()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="VinelandEternal Lunar Nexus — query interplanetary surplus graph",
    )
    parser.add_argument("--status",    action="store_true", help="Print full nexus status")
    parser.add_argument("--surplus-g", type=float, default=0.0,
                        help="Current Earth surplus in grams (for dispatch check)")
    parser.add_argument("--avg-agape", type=float, default=0.0,
                        help="Current average agape score (for dispatch check)")
    parser.add_argument("--delta-v", nargs=2, metavar=("FROM", "TO"),
                        help="Compute total delta-v between two node IDs")
    args = parser.parse_args()

    if args.status or (args.surplus_g == 0 and args.avg_agape == 0 and not args.delta_v):
        _print_status()

    if args.surplus_g or args.avg_agape:
        ready, reason = evaluate_dispatch_readiness(args.surplus_g, args.avg_agape)
        icon = "✅" if ready else "⛔"
        print(f"{icon} Dispatch check: {reason}\n")

    if args.delta_v:
        src, dst = args.delta_v
        try:
            dv = total_delta_v(src, dst)
            print(f"🚀 Δv {src} → {dst}: {dv} km/s\n")
        except ValueError as exc:
            print(f"❌ {exc}\n")


if __name__ == "__main__":
    main()
