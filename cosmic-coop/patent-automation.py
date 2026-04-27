"""
patent-automation.py — VinelandEternal Cosmic Co-Op: Patent Filing Automation

Prepares and submits patent applications for VinelandEternal IP assets.
Supports USPTO Provisional, USPTO Plant Patent, and USPTO Utility filings via
the USPTO Patent Center REST API (EFS-Web successor).

All sensitive credentials (API keys, applicant IDs) are read from environment
variables — never hard-coded.

Usage:
    pip install requests python-dotenv
    cp .env.example .env   # fill in your credentials
    python patent-automation.py --patent iot_provisional --action status
    python patent-automation.py --patent iot_provisional --action submit --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Patent definitions
# ---------------------------------------------------------------------------

@dataclass
class PatentConfig:
    key:           str
    title:         str
    filing_type:   str        # "provisional" | "utility" | "plant"
    agency:        str
    deadline:      str        # ISO date or "rolling"
    claims_count:  int        # number of independent claims
    api_base:      str
    env_app_id:    str        # env var holding the application number
    env_api_key:   str        # env var holding the USPTO API key / JWT
    inventors:     list[str] = field(default_factory=list)
    ipc_classes:   list[str] = field(default_factory=list)  # IPC classification codes
    status:        str = "in_preparation"  # in_preparation | filed | published | granted | abandoned


PATENTS: dict[str, PatentConfig] = {
    "iot_provisional": PatentConfig(
        key="iot_provisional",
        title="Agape-Metric IoT Sensor Array for Regenerative Microgreens Cultivation",
        filing_type="provisional",
        agency="USPTO",
        deadline="2026-06-15",
        claims_count=5,
        api_base=os.environ.get("USPTO_API", "https://api.uspto.gov/patent/applications/v1"),
        env_app_id="USPTO_IOT_APP_NUM",
        env_api_key="USPTO_API_KEY",
        inventors=["Chais Hill"],
        ipc_classes=["A01G 31/02", "G01D 21/02", "H04W 4/38"],
        status="in_preparation",
    ),
    "drone_utility": PatentConfig(
        key="drone_utility",
        title="Linear-Programming Drone Grid Optimizer for Surplus Crop Redistribution",
        filing_type="utility",
        agency="USPTO",
        deadline="2026-09-01",
        claims_count=12,
        api_base=os.environ.get("USPTO_API", "https://api.uspto.gov/patent/applications/v1"),
        env_app_id="USPTO_DRONE_APP_NUM",
        env_api_key="USPTO_API_KEY",
        inventors=["Chais Hill"],
        ipc_classes=["G06Q 10/083", "B64C 39/02", "G05D 1/10"],
        status="in_preparation",
    ),
    "ar_visor_utility": PatentConfig(
        key="ar_visor_utility",
        title="Augmented-Reality Harvest Visor with Real-Time Agape-Score Overlay",
        filing_type="utility",
        agency="USPTO",
        deadline="2026-09-15",
        claims_count=10,
        api_base=os.environ.get("USPTO_API", "https://api.uspto.gov/patent/applications/v1"),
        env_app_id="USPTO_AR_APP_NUM",
        env_api_key="USPTO_API_KEY",
        inventors=["Chais Hill"],
        ipc_classes=["G02B 27/01", "A01D 91/04", "G06T 19/00"],
        status="in_preparation",
    ),
    "plant_microgreen": PatentConfig(
        key="plant_microgreen",
        title="VinelandEternal High-Agape Basil Cultivar — Indoor Microgreens Variety",
        filing_type="plant",
        agency="USPTO",
        deadline="rolling",
        claims_count=1,
        api_base=os.environ.get("USPTO_API", "https://api.uspto.gov/patent/applications/v1"),
        env_app_id="USPTO_PLANT_APP_NUM",
        env_api_key="USPTO_API_KEY",
        inventors=["Chais Hill"],
        ipc_classes=["A01H 5/02"],
        status="in_preparation",
    ),
    "zaire_token_utility": PatentConfig(
        key="zaire_token_utility",
        title="Blockchain-Anchored Harvest Token System for Transparent Agri-Supply Chains",
        filing_type="utility",
        agency="USPTO",
        deadline="2026-10-01",
        claims_count=15,
        api_base=os.environ.get("USPTO_API", "https://api.uspto.gov/patent/applications/v1"),
        env_app_id="USPTO_ZAIRE_APP_NUM",
        env_api_key="USPTO_API_KEY",
        inventors=["Chais Hill"],
        ipc_classes=["G06Q 20/06", "H04L 9/00", "A01G 31/00"],
        status="in_preparation",
    ),
}


# ---------------------------------------------------------------------------
# Applicant / inventor profile
# ---------------------------------------------------------------------------

@dataclass
class InventorProfile:
    name:        str = os.environ.get("INVENTOR_NAME",  "Chais Hill")
    org:         str = os.environ.get("INVENTOR_ORG",   "VinelandEternal Cosmic Co-Op")
    address:     str = os.environ.get("INVENTOR_ADDR",  "Vineland, NJ 08360")
    email:       str = os.environ.get("INVENTOR_EMAIL", "")
    citizenship: str = os.environ.get("INVENTOR_CITIZENSHIP", "US")


# ---------------------------------------------------------------------------
# Payload builder
# ---------------------------------------------------------------------------

def build_filing_payload(patent: PatentConfig, inventor: InventorProfile) -> dict:
    """Construct the JSON body for a USPTO patent filing API call."""
    return {
        "application_number": os.environ.get(patent.env_app_id, ""),
        "submitted_at":       datetime.now(timezone.utc).isoformat(),
        "filing_type":        patent.filing_type,
        "inventor":           asdict(inventor),
        "patent": {
            "key":         patent.key,
            "title":       patent.title,
            "agency":      patent.agency,
            "claims_count": patent.claims_count,
            "ipc_classes": patent.ipc_classes,
            "inventors":   patent.inventors,
        },
        "abstract": (
            f"A system and method for {patent.title.lower()}. "
            "The invention integrates regenerative agriculture technology, "
            "community-benefit (agape) metrics, and open-source software "
            "developed under the VinelandEternal project "
            "(github.com/chaishillomnitech1/VinelandEternal)."
        ),
        "technology_field":    "Agricultural Technology / Precision Agriculture",
        "background": (
            "Conventional crop monitoring and distribution systems lack real-time "
            "community-impact scoring and automated surplus redistribution. "
            "This invention addresses that gap."
        ),
        "finalized": True,
    }


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def _headers(patent: PatentConfig) -> dict:
    api_key = os.environ.get(patent.env_api_key, "")
    return {
        "Authorization": f"Bearer {api_key}" if api_key else "Bearer <not-set>",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }


def check_status(patent: PatentConfig) -> dict:
    """Query the USPTO portal for the current application status."""
    app_num = os.environ.get(patent.env_app_id, "")
    if not app_num:
        return {"status": patent.status, "note": f"Set {patent.env_app_id} to query live status"}

    if requests is None:
        return {"error": "requests library not installed"}

    try:
        resp = requests.get(
            f"{patent.api_base}/{app_num}",
            headers=_headers(patent),
            timeout=10,
        )
        return resp.json()
    except Exception as exc:
        return {"error": str(exc), "status": patent.status}


def submit_filing(patent: PatentConfig, inventor: InventorProfile, dry_run: bool = False) -> dict:
    """Submit the prepared patent filing to the USPTO portal."""
    payload = build_filing_payload(patent, inventor)

    if dry_run:
        print(f"\n[DRY RUN] Would POST to {patent.api_base}/applications/submit")
        print(json.dumps(payload, indent=2))
        return {"dry_run": True, "payload_keys": list(payload.keys())}

    if not os.environ.get(patent.env_app_id) or not os.environ.get(patent.env_api_key):
        print(
            f"⚠️  Required environment variables not set.\n"
            f"   Set {patent.env_app_id} and {patent.env_api_key} to submit.\n"
            "   Use --dry-run to preview the payload."
        )
        sys.exit(1)

    if requests is None:
        print("❌  requests library not installed.  Run: pip install requests")
        sys.exit(1)

    resp = requests.post(
        f"{patent.api_base}/applications/submit",
        json=payload,
        headers=_headers(patent),
        timeout=30,
    )

    result = (
        resp.json()
        if resp.headers.get("content-type", "").startswith("application/json")
        else {"raw": resp.text}
    )
    result["http_status"] = resp.status_code
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="VinelandEternal Patent Automation — prepare and file patents",
    )
    parser.add_argument(
        "--patent", choices=list(PATENTS.keys()), default="iot_provisional",
        help="Which patent application to act on (default: iot_provisional)",
    )
    parser.add_argument(
        "--action", choices=["status", "submit", "payload", "list"],
        default="status",
        help="Action: status | submit | payload (print JSON) | list (all patents)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print the filing payload without sending it",
    )
    args = parser.parse_args()

    if args.action == "list":
        print("\n📋 VinelandEternal — Patent Portfolio\n")
        for p in PATENTS.values():
            print(
                f"  {p.key:25} {p.filing_type:12} {p.deadline:12}  "
                f"claims={p.claims_count:2}  {p.title[:55]}"
            )
        print()
        return

    patent = PATENTS[args.patent]
    inventor = InventorProfile()

    print(f"\n🔬 Patent: {patent.title}")
    print(f"   Type:      {patent.filing_type.upper()}")
    print(f"   Agency:    {patent.agency}")
    print(f"   Deadline:  {patent.deadline}")
    print(f"   Claims:    {patent.claims_count}")
    print(f"   IPC:       {', '.join(patent.ipc_classes)}\n")

    if args.action == "status":
        result = check_status(patent)
        print(json.dumps(result, indent=2))

    elif args.action == "payload":
        payload = build_filing_payload(patent, inventor)
        print(json.dumps(payload, indent=2))

    elif args.action == "submit":
        result = submit_filing(patent, inventor, dry_run=args.dry_run)
        print(json.dumps(result, indent=2))
        if result.get("http_status") in (200, 201) or result.get("dry_run"):
            print("\n✅ KUN FAYAKUN. Patent action completed. IP secured.")
        else:
            print("\n⚠️  Unexpected response — review output above.")


if __name__ == "__main__":
    main()
