-- Practice queries for elevation/data/elevation.db (SQLite).
-- Open the file in PyCharm's Database tool window, DB Browser for SQLite,
-- or run:  sqlite3 elevation/data/elevation.db < sql/examples.sql
--
-- Tables
--   properties  one row per asset (value, NOI, cap rate, occupancy ...)
--   ledger      monthly GL by property, account and scenario ('actual' / 'budget')
--   occupancy   monthly occupancy by property and scenario
--   leases      commercial rent roll as of the close date
--   unit_mix    multifamily unit types, in-place and market rent
--   ar_aging    open receivables by tenant and aging bucket
--   loans       one mortgage per property
--   valuations  quarterly appraisals

-- 1. Trailing-12 NOI by property (revenue less operating expenses)
SELECT p.name,
       ROUND(SUM(CASE WHEN l.category = 'revenue' THEN l.amount
                      WHEN l.category = 'opex'    THEN -l.amount ELSE 0 END), 0) AS noi_t12
FROM ledger l
JOIN properties p ON p.id = l.property_id
WHERE l.scenario = 'actual' AND l.period BETWEEN '2025-10' AND '2026-09'
GROUP BY p.name
ORDER BY noi_t12 DESC;

-- 2. Year-to-date actual vs budget by account, portfolio-wide
SELECT a.account_code, a.account_name,
       ROUND(a.amount, 0)            AS ytd_actual,
       ROUND(b.amount, 0)            AS ytd_budget,
       ROUND(a.amount - b.amount, 0) AS variance
FROM (SELECT account_code, account_name, SUM(amount) amount FROM ledger
      WHERE scenario = 'actual' AND period BETWEEN '2026-01' AND '2026-09' AND category IN ('revenue', 'opex')
      GROUP BY account_code, account_name) a
JOIN (SELECT account_code, SUM(amount) amount FROM ledger
      WHERE scenario = 'budget' AND period BETWEEN '2026-01' AND '2026-09'
      GROUP BY account_code) b USING (account_code)
ORDER BY a.account_code;

-- 3. Leases expiring in the next 24 months, largest first
SELECT p.name AS property, l.tenant, l.suite, l.sf, ROUND(l.rent_psf, 2) AS rent_psf, l.expiry_date
FROM leases l
JOIN properties p ON p.id = l.property_id
WHERE l.expiry_date BETWEEN '2026-10-01' AND '2028-09-30'
ORDER BY l.sf DESC;

-- 4. Receivables over 60 days
SELECT p.name AS property, a.tenant, ROUND(a.d61_90 + a.d90_plus, 0) AS over_60_days
FROM ar_aging a
JOIN properties p ON p.id = a.property_id
WHERE a.d61_90 + a.d90_plus > 0
ORDER BY over_60_days DESC;

-- 5. Debt maturities with loan-to-value and coverage
SELECT p.name, lo.lender_type, ROUND(lo.balance, 0) AS balance, lo.rate, lo.maturity_date,
       ROUND(lo.balance / p.value, 3)                 AS ltv,
       ROUND(p.noi_t12 / lo.annual_debt_service, 2)   AS dscr
FROM loans lo
JOIN properties p ON p.id = lo.property_id
ORDER BY lo.maturity_date;
