-- agape-ledger.sql
-- VinelandEternal Agape Ledger — Proof-of-Life Token Schema
-- Compatible with PostgreSQL 14+ and SQLite 3.35+

-- -----------------------------------------------------------------------
-- Tray catalogue
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trays (
    tray_id     TEXT        PRIMARY KEY,
    crop_type   TEXT        NOT NULL,
    rack_id     TEXT        NOT NULL,
    location    TEXT        NOT NULL DEFAULT 'Vineland, NJ',
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- Harvest events — each row is one Proof-of-Life entry
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS harvest_events (
    id            SERIAL      PRIMARY KEY,       -- auto-increment (use INTEGER for SQLite)
    tray_id       TEXT        NOT NULL REFERENCES trays(tray_id),
    harvest_g     NUMERIC(10,2) NOT NULL,         -- weight harvested in grams
    water_ml      NUMERIC(10,2) NOT NULL DEFAULT 0,
    sunlight_lux  NUMERIC(10,2) NOT NULL DEFAULT 0,
    soil_moisture NUMERIC(5,2)  NOT NULL DEFAULT 0, -- percentage
    agape_value   NUMERIC(5,2)  NOT NULL DEFAULT 0, -- community-impact score 0-100
    operator_id   TEXT,
    notes         TEXT,
    harvested_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- Proof-of-Life tokens minted from harvest events
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pol_tokens (
    token_id        TEXT        PRIMARY KEY,      -- UUID or on-chain hash
    harvest_event_id INT        NOT NULL REFERENCES harvest_events(id),
    token_uri       TEXT        NOT NULL,          -- ipfs://... URI
    minted_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    zaire_balance   NUMERIC(20,8) NOT NULL DEFAULT 0,  -- Zaire units credited
    status          TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'redeemed', 'void'))
);

-- -----------------------------------------------------------------------
-- Zaire ∞ ledger — running balance per beneficiary
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zaire_ledger (
    id              SERIAL      PRIMARY KEY,
    beneficiary_id  TEXT        NOT NULL,
    token_id        TEXT        REFERENCES pol_tokens(token_id),
    debit           NUMERIC(20,8) NOT NULL DEFAULT 0,
    credit          NUMERIC(20,8) NOT NULL DEFAULT 0,
    memo            TEXT,
    recorded_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------

-- Current Zaire balance per beneficiary
CREATE VIEW IF NOT EXISTS v_zaire_balance AS
SELECT
    beneficiary_id,
    SUM(credit) - SUM(debit) AS balance,
    COUNT(*)                 AS transactions
FROM zaire_ledger
GROUP BY beneficiary_id;

-- Agape metrics aggregated by crop type
CREATE VIEW IF NOT EXISTS v_agape_by_crop AS
SELECT
    t.crop_type,
    COUNT(he.id)             AS harvest_count,
    SUM(he.harvest_g)        AS total_harvest_g,
    AVG(he.agape_value)      AS avg_agape_value,
    SUM(he.water_ml)         AS total_water_ml
FROM harvest_events he
JOIN trays t ON t.tray_id = he.tray_id
GROUP BY t.crop_type;

-- -----------------------------------------------------------------------
-- Seed data — Vineland Sanctuary Node initial trays
-- -----------------------------------------------------------------------
INSERT OR IGNORE INTO trays (tray_id, crop_type, rack_id, location) VALUES
    ('tray1', 'Basil',        'rack-a', 'Vineland, NJ'),
    ('tray2', 'Arugula',      'rack-a', 'Vineland, NJ'),
    ('tray3', 'Pea Shoots',   'rack-b', 'Vineland, NJ'),
    ('tray4', 'Cilantro',     'rack-b', 'Vineland, NJ'),
    ('tray5', 'Baby Bok Choy','rack-c', 'Vineland, NJ');
