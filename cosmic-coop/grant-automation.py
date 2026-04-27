"""
grant-automation.py — VinelandEternal Cosmic Co-Op: Grant Submission Automation

Prepares and submits grant applications for the Vineland Sanctuary Node.
Supports SCBGP (NJ), Northeast SARE, SADC, and Cumberland Ag Enhancement.

All sensitive credentials (API keys, applicant IDs) are read from environment
variables — never hard-coded.

Usage:
    pip install requests python-dotenv
    cp .env.example .env   # fill in your credentials
    python grant-automation.py --grant scbgp --action status
    python grant-automation.py --grant scbgp --action submit
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Optional

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
# Grant definitions
# ---------------------------------------------------------------------------

@dataclass
class GrantConfig:
    key:         str
    name:        str
    agency:      str
    deadline:    str                     # ISO date string
    amount_min:  int
    amount_max:  int
    api_base:    str
    env_app_id:  str                     # env var holding the application ID
    env_api_key: str                     # env var holding the API key / JWT
    focus:       list[str] = field(default_factory=list)
    status:      str = "in_preparation"  # in_preparation | submitted | awarded | declined


GRANTS: dict[str, GrantConfig] = {
    "scbgp": GrantConfig(
        key="scbgp",
        name="Specialty Crop Block Grant Program (SCBGP)",
        agency="NJ Department of Agriculture",
        deadline="2026-05-14",
        amount_min=10_000,
        amount_max=75_000,
        api_base=os.environ.get("SIMPLIGOV_API", "https://simpligov.com/api/v1"),
        env_app_id="SCBGP_APP_ID",
        env_api_key="SIMPLIGOV_API_KEY",
        focus=["IoT sensor kits", "AR Harvest Visor", "agape marketplace", "co-op workshops"],
        status="submission_ready",
    ),
    "sare": GrantConfig(
        key="sare",
        name="Northeast SARE Farmer Grant",
        agency="Northeast SARE",
        deadline="2026-06-01",
        amount_min=7_500,
        amount_max=30_000,
        api_base=os.environ.get("SARE_API", "https://northeast.sare.org/api"),
        env_app_id="SARE_APP_ID",
        env_api_key="SARE_API_KEY",
        focus=["regenerative microgreens", "drone redistribution", "community food security"],
    ),
    "sadc": GrantConfig(
        key="sadc",
        name="SADC Agriculture Development Grant",
        agency="NJ State Agriculture Development Committee",
        deadline="2026-07-01",
        amount_min=5_000,
        amount_max=20_000,
        api_base=os.environ.get("SADC_API", "https://sadc.nj.gov/api"),
        env_app_id="SADC_APP_ID",
        env_api_key="SADC_API_KEY",
        focus=["specialty crop expansion", "sustainable farming infrastructure"],
    ),
    "cumberland": GrantConfig(
        key="cumberland",
        name="Cumberland County Ag Enhancement Program",
        agency="Cumberland County Board of Agriculture",
        deadline="2026-07-15",
        amount_min=2_500,
        amount_max=10_000,
        api_base=os.environ.get("CUMBERLAND_API", "https://co.cumberland.nj.us/agenhancement/api"),
        env_app_id="CUMBERLAND_APP_ID",
        env_api_key="CUMBERLAND_API_KEY",
        focus=["local food system", "IoT agriculture", "youth ag education"],
    ),
    # --- West Coast regional grants ---
    "wa_scbgp": GrantConfig(
        key="wa_scbgp",
        name="WA Specialty Crop Block Grant Program",
        agency="WA State Department of Agriculture",
        deadline="2026-08-01",
        amount_min=10_000,
        amount_max=100_000,
        api_base=os.environ.get("WA_SCBGP_API", "https://agr.wa.gov/api/v1"),
        env_app_id="WA_SCBGP_APP_ID",
        env_api_key="WA_SCBGP_API_KEY",
        focus=["specialty crop expansion", "IoT sensors", "drone redistribution", "urban food security"],
        status="in_preparation",
    ),
    "or_scbgp": GrantConfig(
        key="or_scbgp",
        name="OR Specialty Crop Block Grant Program",
        agency="Oregon Department of Agriculture",
        deadline="2026-08-15",
        amount_min=5_000,
        amount_max=75_000,
        api_base=os.environ.get("OR_SCBGP_API", "https://oregon.gov/ODA/programs/MarketAccess/api"),
        env_app_id="OR_SCBGP_APP_ID",
        env_api_key="OR_SCBGP_API_KEY",
        focus=["regenerative microgreens", "AR harvest technology", "community food resilience"],
        status="in_preparation",
    ),
    "ca_cdfa": GrantConfig(
        key="ca_cdfa",
        name="CA CDFA Specialty Crop Block Grant",
        agency="CA Department of Food and Agriculture",
        deadline="2026-09-01",
        amount_min=25_000,
        amount_max=200_000,
        api_base=os.environ.get("CA_CDFA_API", "https://www.cdfa.ca.gov/grants/api/v1"),
        env_app_id="CA_CDFA_APP_ID",
        env_api_key="CA_CDFA_API_KEY",
        focus=["specialty crop competitiveness", "IoT agriculture", "drone delivery", "community resilience"],
        status="in_preparation",
    ),
}


# ---------------------------------------------------------------------------
# Application payload builder
# ---------------------------------------------------------------------------

@dataclass
class ApplicantProfile:
    name:         str = os.environ.get("APPLICANT_NAME", "Chais")
    org:          str = os.environ.get("APPLICANT_ORG",  "VinelandEternal Cosmic Co-Op")
    address:      str = os.environ.get("APPLICANT_ADDR", "Vineland, NJ 08360")
    email:        str = os.environ.get("APPLICANT_EMAIL", "")
    phone:        str = os.environ.get("APPLICANT_PHONE", "")
    ein:          str = os.environ.get("APPLICANT_EIN",   "")


def build_application_payload(grant: GrantConfig, profile: ApplicantProfile) -> dict:
    """Construct the JSON body for a grant submission API call."""
    return {
        "application_id": os.environ.get(grant.env_app_id, ""),
        "submitted_at":   datetime.now(timezone.utc).isoformat(),
        "applicant": asdict(profile),
        "grant": {
            "key":        grant.key,
            "name":       grant.name,
            "agency":     grant.agency,
            "amount_requested": grant.amount_max,
            "focus_areas": grant.focus,
        },
        "project": {
            "title":       "VinelandEternal Regenerative Ag Hub — IoT, AR & Drone-Alchemy Grid",
            "description": (
                "Establish a 30–60 tray indoor microgreens operation in Vineland, NJ "
                "equipped with IoT sensors, an AR Harvest Visor, and drone-alchemic "
                "surplus redistribution covering NJ/PA/DE. All produce sold via "
                "community auction and agape marketplace. Technology stack open-sourced "
                "at github.com/chaishillomnitech1/VinelandEternal."
            ),
            "location":    "Vineland, NJ 08360",
            "crops":       ["Basil", "Arugula", "Pea Shoots", "Cilantro", "Baby Bok Choy"],
            "budget_items": [
                {"item": "IoT sensor kits (10 racks)",       "cost": 8_000},
                {"item": "AR Harvest Visor hardware",        "cost": 3_500},
                {"item": "Drone delivery unit",              "cost": 6_000},
                {"item": "Grow rack infrastructure",         "cost": 12_000},
                {"item": "Community workshop facilitation",  "cost": 4_500},
                {"item": "Software / platform development",  "cost": 5_000},
            ],
            "timeline_months": 12,
            "beneficiaries": "Vineland community, tri-state food banks, NJ specialty crop sector",
        },
        "finalized": True,
    }


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def _headers(grant: GrantConfig) -> dict:
    api_key = os.environ.get(grant.env_api_key, "")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }


def check_status(grant: GrantConfig) -> dict:
    """Query the grant portal for the current application status."""
    app_id = os.environ.get(grant.env_app_id, "")
    if not app_id:
        return {"status": grant.status, "note": f"Set {grant.env_app_id} to query live status"}

    if requests is None:
        return {"error": "requests library not installed"}

    try:
        resp = requests.get(
            f"{grant.api_base}/applications/{app_id}",
            headers=_headers(grant),
            timeout=10,
        )
        return resp.json()
    except Exception as exc:
        return {"error": str(exc), "status": grant.status}


def submit_application(grant: GrantConfig, profile: ApplicantProfile, dry_run: bool = False) -> dict:
    """Submit the prepared application to the grant portal."""
    payload = build_application_payload(grant, profile)

    if dry_run:
        print(f"\n[DRY RUN] Would POST to {grant.api_base}/applications/submit")
        print(json.dumps(payload, indent=2))
        return {"dry_run": True, "payload_keys": list(payload.keys())}

    if not os.environ.get(grant.env_app_id) or not os.environ.get(grant.env_api_key):
        print(
            f"⚠️  Required environment variables not set.\n"
            f"   Set {grant.env_app_id} and {grant.env_api_key} to submit.\n"
            "   Use --dry-run to preview the payload."
        )
        sys.exit(1)

    app_id = os.environ.get(grant.env_app_id, "")
    api_key = os.environ.get(grant.env_api_key, "")

    if requests is None:
        print("❌  requests library not installed.  Run: pip install requests")
        sys.exit(1)

    resp = requests.post(
        f"{grant.api_base}/applications/submit",
        json=payload,
        headers=_headers(grant),
        timeout=30,
    )

    result = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"raw": resp.text}
    result["http_status"] = resp.status_code
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="VinelandEternal Grant Automation — prepare and submit grants",
    )
    parser.add_argument(
        "--grant", choices=list(GRANTS.keys()), default="scbgp",
        help="Which grant to act on (default: scbgp)",
    )
    parser.add_argument(
        "--action", choices=["status", "submit", "payload", "list"],
        default="status",
        help="Action: status | submit | payload (print JSON) | list (all grants)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print the submission payload without sending it",
    )
    args = parser.parse_args()

    if args.action == "list":
        print("\n📋 VinelandEternal — Active & Pipeline Grants\n")
        for g in GRANTS.values():
            print(f"  {g.key.upper():12} {g.deadline}   ${g.amount_min:,}–${g.amount_max:,}   {g.name}")
        print()
        return

    grant = GRANTS[args.grant]
    profile = ApplicantProfile()

    print(f"\n🌱 Grant: {grant.name}")
    print(f"   Agency:   {grant.agency}")
    print(f"   Deadline: {grant.deadline}")
    print(f"   Amount:   ${grant.amount_min:,} – ${grant.amount_max:,}")
    print(f"   Focus:    {', '.join(grant.focus)}\n")

    if args.action == "status":
        result = check_status(grant)
        print(json.dumps(result, indent=2))

    elif args.action == "payload":
        payload = build_application_payload(grant, profile)
        print(json.dumps(payload, indent=2))

    elif args.action == "submit":
        result = submit_application(grant, profile, dry_run=args.dry_run)
        print(json.dumps(result, indent=2))
        if result.get("http_status") in (200, 201) or result.get("dry_run"):
            print("\n✅ KUN FAYAKUN. Grant action completed. Zaire ∞ Funded.")
        else:
            print("\n⚠️  Unexpected response — review output above.")


if __name__ == "__main__":
    main()
