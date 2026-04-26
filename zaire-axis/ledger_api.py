"""
ledger_api.py — VinelandEternal Zaire ∞ Axis: REST API

Serves the Agape Ledger data over HTTP using FastAPI + SQLAlchemy.
Supports minting new Harvest IS Tokens, querying balances, and retrieving
per-crop agape metrics.

Usage:
    pip install fastapi uvicorn sqlalchemy
    uvicorn zaire-axis.ledger_api:app --reload
    # Visit http://localhost:8000/docs for interactive Swagger UI
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import (
    Column, DateTime, Float, Integer, String, Text,
    create_engine, text,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# ---------------------------------------------------------------------------
# Database setup (SQLite for local dev; swap URL for Postgres in production)
# ---------------------------------------------------------------------------

DATABASE_URL = "sqlite:///./zaire-ledger.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# ORM models
# ---------------------------------------------------------------------------

class HarvestEvent(Base):
    __tablename__ = "harvest_events"

    id            = Column(Integer, primary_key=True, index=True)
    tray_id       = Column(String(50), nullable=False, index=True)
    crop_type     = Column(String(100), nullable=False)
    harvest_g     = Column(Float, nullable=False)
    water_ml      = Column(Float, default=0.0)
    sunlight_lux  = Column(Float, default=0.0)
    soil_moisture = Column(Float, default=0.0)
    agape_value   = Column(Float, default=0.0)
    operator_id   = Column(String(100), nullable=True)
    notes         = Column(Text, nullable=True)
    harvested_at  = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PolToken(Base):
    __tablename__ = "pol_tokens"

    token_id         = Column(String(100), primary_key=True, index=True)
    harvest_event_id = Column(Integer, nullable=False)
    token_uri        = Column(Text, nullable=False)
    zaire_balance    = Column(Float, default=0.0)
    status           = Column(String(20), default="active")
    minted_at        = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ZaireLedgerEntry(Base):
    __tablename__ = "zaire_ledger"

    id             = Column(Integer, primary_key=True, index=True)
    beneficiary_id = Column(String(100), nullable=False, index=True)
    token_id       = Column(String(100), nullable=True)
    debit          = Column(Float, default=0.0)
    credit         = Column(Float, default=0.0)
    memo           = Column(Text, nullable=True)
    recorded_at    = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Zaire ∞ Ledger API",
    description=(
        "REST API for the VinelandEternal Agape Ledger. "
        "Mint Harvest IS Tokens, query Zaire ∞ balances, and retrieve "
        "per-crop agape metrics."
    ),
    version="1.0.0",
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class HarvestIn(BaseModel):
    tray_id:       str   = Field(..., example="tray1")
    crop_type:     str   = Field(..., example="Basil")
    harvest_g:     float = Field(..., gt=0, example=350.0)
    water_ml:      float = Field(0.0, example=120.0)
    sunlight_lux:  float = Field(0.0, example=8500.0)
    soil_moisture: float = Field(0.0, example=72.0)
    agape_value:   float = Field(0.0, ge=0, le=100, example=94.0)
    operator_id:   Optional[str] = None
    notes:         Optional[str] = None


class HarvestOut(HarvestIn):
    id:          int
    harvested_at: datetime

    class Config:
        from_attributes = True


class TokenOut(BaseModel):
    token_id:         str
    harvest_event_id: int
    token_uri:        str
    zaire_balance:    float
    status:           str
    minted_at:        datetime

    class Config:
        from_attributes = True


class BalanceOut(BaseModel):
    beneficiary_id: str
    balance:        float
    transactions:   int


class AgapeMetric(BaseModel):
    crop_type:        str
    harvest_count:    int
    total_harvest_g:  float
    avg_agape_value:  float
    total_water_ml:   float


# Force Pydantic v2 to resolve all forward references now that every model
# is defined (required when the module is loaded via importlib or with
# `from __future__ import annotations`).
HarvestIn.model_rebuild()
HarvestOut.model_rebuild()
TokenOut.model_rebuild()
BalanceOut.model_rebuild()
AgapeMetric.model_rebuild()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "service": "Zaire ∞ Ledger API"}


# --- Harvest events ---------------------------------------------------------

@app.get("/harvests", response_model=List[HarvestOut], tags=["Harvests"])
def list_harvests(skip: int = 0, limit: int = 50):
    """List recent harvest events."""
    db = next(get_db())
    return db.query(HarvestEvent).order_by(HarvestEvent.harvested_at.desc()).offset(skip).limit(limit).all()


@app.post("/harvests", response_model=HarvestOut, status_code=201, tags=["Harvests"])
def create_harvest(harvest_in: HarvestIn):
    """Record a new harvest event."""
    db = next(get_db())
    event = HarvestEvent(**harvest_in.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


# --- Tokens -----------------------------------------------------------------

@app.get("/tokens", response_model=List[TokenOut], tags=["Tokens"])
def list_tokens(skip: int = 0, limit: int = 50):
    """List all Harvest IS Tokens."""
    db = next(get_db())
    return db.query(PolToken).order_by(PolToken.minted_at.desc()).offset(skip).limit(limit).all()


@app.get("/tokens/{token_id}", response_model=TokenOut, tags=["Tokens"])
def get_token(token_id: str):
    """Retrieve a specific Harvest IS Token."""
    db = next(get_db())
    token = db.get(PolToken, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    return token


@app.post("/tokens", response_model=TokenOut, status_code=201, tags=["Tokens"])
def mint_token(harvest_event_id: int, zaire_balance: float = 1.0):
    """Mint a new Harvest IS Token for a recorded harvest event."""
    db = next(get_db())
    event = db.get(HarvestEvent, harvest_event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Harvest event not found")

    token_id = str(uuid.uuid4())
    token_uri = f"ipfs://Qm{token_id.replace('-', '')[:44]}"
    token = PolToken(
        token_id=token_id,
        harvest_event_id=harvest_event_id,
        token_uri=token_uri,
        zaire_balance=zaire_balance,
    )
    db.add(token)

    ledger_entry = ZaireLedgerEntry(
        beneficiary_id=event.operator_id or "sanctuary-lead",
        token_id=token_id,
        credit=zaire_balance,
        memo=f"Harvest IS Token mint — tray {event.tray_id}",
    )
    db.add(ledger_entry)
    db.commit()
    db.refresh(token)
    return token


# --- Balances ---------------------------------------------------------------

@app.get("/balance", response_model=List[BalanceOut], tags=["Zaire Ledger"])
def all_balances():
    """Current Zaire ∞ balance summary per beneficiary."""
    db = next(get_db())
    rows = db.execute(
        text(
            "SELECT beneficiary_id, "
            "       SUM(credit) - SUM(debit) AS balance, "
            "       COUNT(*)                 AS transactions "
            "FROM zaire_ledger "
            "GROUP BY beneficiary_id"
        )
    ).fetchall()
    return [BalanceOut(beneficiary_id=r[0], balance=r[1] or 0.0, transactions=r[2]) for r in rows]


# --- Agape metrics ----------------------------------------------------------

@app.get("/metrics/agape", response_model=List[AgapeMetric], tags=["Metrics"])
def agape_metrics():
    """Agape value aggregates by crop type."""
    db = next(get_db())
    rows = db.execute(
        text(
            "SELECT crop_type, "
            "       COUNT(id)            AS harvest_count, "
            "       SUM(harvest_g)       AS total_harvest_g, "
            "       AVG(agape_value)     AS avg_agape_value, "
            "       SUM(water_ml)        AS total_water_ml "
            "FROM harvest_events "
            "GROUP BY crop_type "
            "ORDER BY avg_agape_value DESC"
        )
    ).fetchall()
    return [
        AgapeMetric(
            crop_type=r[0],
            harvest_count=r[1],
            total_harvest_g=r[2] or 0.0,
            avg_agape_value=round(r[3] or 0.0, 2),
            total_water_ml=r[4] or 0.0,
        )
        for r in rows
    ]
