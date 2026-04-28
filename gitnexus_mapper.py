"""
gitnexus_mapper.py — VinelandEternal GitNexus Semantic Graph Mapper

Uses gitpython to crawl the git log and networkx to build a directed semantic
graph where every commit is a node connected to IoT harvest events stored in
the Agape Ledger SQLite database.  Temporal edges link each commit to the
closest harvest event that occurred within ±1 hour.

The graph is serialised to nexus_graph.json in the repository root.

Usage:
    pip install gitpython networkx
    python gitnexus_mapper.py [--db PATH] [--output PATH] [--max-commits N]
"""

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import git
import networkx as nx

REPO_ROOT = Path(__file__).resolve().parent
DB_PATH   = REPO_ROOT / "zaire-ledger.db"
OUT_PATH  = REPO_ROOT / "nexus_graph.json"

# Maximum look-back window for temporal commit↔harvest links (seconds)
LINK_WINDOW_S = 3_600


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_harvest_events(db_path: Path) -> list:
    """Load harvest events from the SQLite ledger.  Returns [] if DB absent."""
    if not db_path.exists():
        return []
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT id, tray_id, harvest_g, agape_value, harvested_at "
            "FROM harvest_events"
        ).fetchall()
        return [dict(r) for r in rows]
    except sqlite3.OperationalError:
        return []
    finally:
        con.close()


def _parse_timestamp(dt_str: str) -> float:
    """Parse an ISO-8601 or SQLite datetime string to a UTC POSIX timestamp."""
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(str(dt_str), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        except ValueError:
            continue
    return 0.0


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_nexus_graph(repo_path: Path, db_path: Path, max_commits: int = 200) -> nx.DiGraph:
    """
    Build a directed graph with two node types:

      commit        — one node per git commit (SHA, message, author, timestamp)
      harvest_event — one node per IoT harvest entry (tray_id, harvest_g, agape_value)

    Edge types:
      parent           — commit → parent commit (code history flow)
      temporally_linked — commit → nearest harvest_event within LINK_WINDOW_S
    """
    repo = git.Repo(str(repo_path))
    G: nx.DiGraph = nx.DiGraph()

    # --- Commit nodes & parent edges ----------------------------------------
    commits = list(repo.iter_commits("HEAD", max_count=max_commits))
    for commit in commits:
        short = commit.hexsha[:12]
        G.add_node(
            short,
            node_type="commit",
            sha_full=commit.hexsha,
            message=commit.message.strip()[:120],
            author=str(commit.author),
            timestamp=float(commit.committed_date),
            committed_at=datetime.fromtimestamp(
                commit.committed_date, tz=timezone.utc
            ).isoformat(),
        )
        for parent in commit.parents:
            parent_short = parent.hexsha[:12]
            # Ensure parent node exists (may not be in the crawl window)
            if not G.has_node(parent_short):
                G.add_node(parent_short, node_type="commit", sha_full=parent.hexsha)
            G.add_edge(short, parent_short, edge_type="parent")

    # --- Harvest event nodes ------------------------------------------------
    events = _load_harvest_events(db_path)
    for ev in events:
        node_id = f"harvest_{ev['id']}"
        ev_ts   = _parse_timestamp(str(ev["harvested_at"]))
        G.add_node(
            node_id,
            node_type="harvest_event",
            tray_id=ev["tray_id"],
            harvest_g=float(ev["harvest_g"]),
            agape_value=float(ev["agape_value"]),
            timestamp=ev_ts,
            harvested_at=str(ev["harvested_at"]),
        )

    # --- Temporal edges: commit ↔ nearest harvest event --------------------
    harvest_nodes = [
        (nid, ndata)
        for nid, ndata in G.nodes(data=True)
        if ndata.get("node_type") == "harvest_event"
    ]

    if harvest_nodes:
        for commit in commits:
            short  = commit.hexsha[:12]
            c_ts   = float(commit.committed_date)
            best_id, best_delta = None, float("inf")
            for hid, hdata in harvest_nodes:
                delta = abs(c_ts - hdata.get("timestamp", 0))
                if delta < best_delta:
                    best_id, best_delta = hid, delta
            if best_id is not None and best_delta <= LINK_WINDOW_S:
                G.add_edge(
                    short,
                    best_id,
                    edge_type="temporally_linked",
                    delta_s=round(best_delta, 1),
                )

    return G


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------

def graph_to_dict(G: nx.DiGraph) -> dict:
    """Convert the NetworkX graph to a JSON-serialisable dictionary."""
    return {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "node_count": G.number_of_nodes(),
        "edge_count": G.number_of_edges(),
        "nodes": [
            {"id": n, **{k: v for k, v in attrs.items()}}
            for n, attrs in G.nodes(data=True)
        ],
        "edges": [
            {"source": u, "target": v, **{k: v for k, v in attrs.items()}}
            for u, v, attrs in G.edges(data=True)
        ],
    }


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Build the VinelandEternal GitNexus semantic graph."
    )
    parser.add_argument(
        "--db",
        default=str(DB_PATH),
        help="Path to the SQLite zaire-ledger database (default: %(default)s)",
    )
    parser.add_argument(
        "--output",
        default=str(OUT_PATH),
        help="Output JSON file path (default: %(default)s)",
    )
    parser.add_argument(
        "--max-commits",
        type=int,
        default=200,
        metavar="N",
        help="Maximum number of commits to crawl (default: %(default)s)",
    )
    args = parser.parse_args()

    db_path  = Path(args.db)
    out_path = Path(args.output)

    print(f"Scanning repo  : {REPO_ROOT}")
    print(f"Ledger DB      : {db_path} ({'found' if db_path.exists() else 'not found — harvest nodes skipped'})")

    G    = build_nexus_graph(REPO_ROOT, db_path, args.max_commits)
    data = graph_to_dict(G)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as fh:
        json.dump(data, fh, indent=2)

    print(f"Graph written  : {out_path}")
    print(f"  Nodes : {data['node_count']}")
    print(f"  Edges : {data['edge_count']}")


if __name__ == "__main__":
    main()
