-- infinite-tracker.sql
-- VinelandEternal Zaire ∞ Axis — Infinite-Granularity ScrollVerse Ledger
-- Compatible with PostgreSQL 14+ (use INTEGER PRIMARY KEY for SQLite)

-- -----------------------------------------------------------------------
-- Operators / beneficiaries
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operators (
    operator_id   TEXT        PRIMARY KEY,
    display_name  TEXT        NOT NULL,
    region        TEXT        NOT NULL DEFAULT 'Vineland, NJ',
    wallet_address TEXT,
    joined_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- Scroll atoms — every discrete unit of value in the ScrollVerse
-- Each row represents one indivisible quantum of agape output
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scroll_atoms (
    atom_id       TEXT        PRIMARY KEY,   -- UUID
    source_type   TEXT        NOT NULL,      -- 'harvest' | 'flight' | 'grant' | 'community'
    source_ref    TEXT        NOT NULL,      -- foreign key to the source table (denormalised for portability)
    operator_id   TEXT        NOT NULL REFERENCES operators(operator_id),
    mass_g        NUMERIC(20,8) NOT NULL DEFAULT 0,  -- physical mass (harvest grams, payload grams…)
    zaire_value   NUMERIC(20,8) NOT NULL DEFAULT 0,  -- Zaire ∞ units assigned
    carbon_g      NUMERIC(20,8) NOT NULL DEFAULT 0,  -- carbon offset grams
    water_ml      NUMERIC(20,8) NOT NULL DEFAULT 0,
    agape_score   NUMERIC(5,2)  NOT NULL DEFAULT 0,  -- 0-100
    ipfs_cid      TEXT,                              -- optional IPFS metadata pointer
    recorded_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- Zaire ∞ running balance — double-entry style
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zaire_infinity (
    entry_id      TEXT        PRIMARY KEY,   -- UUID
    operator_id   TEXT        NOT NULL REFERENCES operators(operator_id),
    atom_id       TEXT        REFERENCES scroll_atoms(atom_id),
    entry_type    TEXT        NOT NULL CHECK (entry_type IN ('credit','debit')),
    amount        NUMERIC(20,8) NOT NULL DEFAULT 0,
    currency      TEXT        NOT NULL DEFAULT 'ZAIRE',
    memo          TEXT,
    recorded_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- Token registry — on-chain Harvest IS Tokens
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS harvest_tokens (
    token_id      TEXT        PRIMARY KEY,
    atom_id       TEXT        NOT NULL REFERENCES scroll_atoms(atom_id),
    contract_addr TEXT,
    token_uri     TEXT        NOT NULL,
    chain_id      INTEGER     NOT NULL DEFAULT 11155111,  -- Sepolia testnet
    tx_hash       TEXT,
    minted_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status        TEXT        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','redeemed','void'))
);

-- -----------------------------------------------------------------------
-- Legacy inheritance — Zaire ∞ beneficiary designations
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legacy_designations (
    designation_id TEXT       PRIMARY KEY,
    grantor_id    TEXT        NOT NULL REFERENCES operators(operator_id),
    grantee_name  TEXT        NOT NULL,
    grantee_relation TEXT,
    share_pct     NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (share_pct BETWEEN 0 AND 100),
    effective_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes         TEXT
);

-- -----------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------

-- Zaire ∞ net balance per operator
CREATE VIEW IF NOT EXISTS v_zaire_net AS
SELECT
    o.operator_id,
    o.display_name,
    o.region,
    COALESCE(SUM(CASE WHEN zi.entry_type = 'credit' THEN zi.amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN zi.entry_type = 'debit'  THEN zi.amount ELSE 0 END), 0)
        AS net_balance,
    COUNT(zi.entry_id) AS total_entries
FROM operators o
LEFT JOIN zaire_infinity zi ON zi.operator_id = o.operator_id
GROUP BY o.operator_id, o.display_name, o.region;

-- Atom-level carbon & water impact summary
CREATE VIEW IF NOT EXISTS v_impact_summary AS
SELECT
    source_type,
    COUNT(*)            AS atom_count,
    SUM(mass_g)         AS total_mass_g,
    SUM(zaire_value)    AS total_zaire,
    SUM(carbon_g)       AS total_carbon_g,
    SUM(water_ml)       AS total_water_ml,
    AVG(agape_score)    AS avg_agape_score
FROM scroll_atoms
GROUP BY source_type;

-- Top agape contributors
CREATE VIEW IF NOT EXISTS v_top_contributors AS
SELECT
    o.display_name,
    o.region,
    COUNT(sa.atom_id)   AS contributions,
    SUM(sa.zaire_value) AS zaire_earned,
    AVG(sa.agape_score) AS avg_agape
FROM scroll_atoms sa
JOIN operators o ON o.operator_id = sa.operator_id
GROUP BY o.display_name, o.region
ORDER BY zaire_earned DESC;

-- -----------------------------------------------------------------------
-- Seed data — Vineland Sanctuary Node founder
-- -----------------------------------------------------------------------
INSERT OR IGNORE INTO operators (operator_id, display_name, region) VALUES
    ('chais-vineland', 'Chais — Vineland Sanctuary Lead', 'Vineland, NJ');
