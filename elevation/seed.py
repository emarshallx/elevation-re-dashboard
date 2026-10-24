"""Build the fictional sample portfolio into SQLite.

Run directly with ``python -m elevation.seed`` (add ``--force`` to rebuild).

Every property, tenant, loan and dollar amount produced here is invented for
demonstration. Cities and market context are real; the buildings are not.
The generator is deterministic (seeded), so everyone gets the same ledger.
"""
from __future__ import annotations

import argparse
import sqlite3
from datetime import date

import numpy as np
import pandas as pd

from . import config

# ---------------------------------------------------------------------------
# Property inputs (local currency)
#   commercial: rent = net rent per sf per year, opex = per sf per year
#   multifamily: rent = rent per unit per month, opex = per unit per year
#   target_noi = trailing-12 NOI the generator calibrates to (local currency)
# ---------------------------------------------------------------------------
PROPERTIES = [
    dict(id="P01", short="Meridian", name="Meridian Tower", sector="Office", klass="Class A",
         city="Chicago", province="IL", country="US", submarket="Central Loop",
         lat=41.8810, lon=-87.6298, size=640_000, year_built=1989,
         acquired="2019-06-15", acq_price=142_000_000, cap=0.0900, target_noi=9_600_000,
         occ_start=0.845, occ_end=0.780, budget_occ_delta=0.010, rent=24.5, rent_growth=0.015,
         opex=19.0, recovery=0.72, snow=True, anchor_expiry="2027-06-30",
         loan=dict(ltv=0.55, rate=0.0410, start="2019-06-15", maturity="2027-06-30", amort=0, lender="CMBS")),
    dict(id="P02", short="Fulton Works", name="Fulton Works", sector="Office", klass="Trophy",
         city="Chicago", province="IL", country="US", submarket="Fulton Market",
         lat=41.8867, lon=-87.6517, size=210_000, year_built=2021,
         acquired="2022-03-01", acq_price=118_000_000, cap=0.0700, target_noi=7_400_000,
         occ_start=0.860, occ_end=0.930, budget_occ_delta=-0.035, rent=38.0, rent_growth=0.030,
         opex=21.0, recovery=0.80, snow=True, anchor_expiry="2033-12-31",
         loan=dict(ltv=0.50, rate=0.0465, start="2022-03-01", maturity="2031-03-01", amort=0, lender="Life company")),
    dict(id="P03", short="Harbourfront", name="Harbourfront Court", sector="Office", klass="Class A",
         city="Toronto", province="ON", country="Canada", submarket="Financial Core",
         lat=43.6455, lon=-79.3807, size=480_000, year_built=2008,
         acquired="2018-09-10", acq_price=245_000_000, cap=0.0675, target_noi=17_530_000,
         occ_start=0.860, occ_end=0.890, budget_occ_delta=0.000, rent=31.0, rent_growth=0.020,
         opex=22.0, recovery=0.85, snow=True, anchor_expiry="2031-04-30",
         loan=dict(ltv=0.50, rate=0.0385, start="2018-09-10", maturity="2028-09-10", amort=25, lender="Schedule I bank")),
    dict(id="P04", short="Bow Valley", name="Bow Valley Centre", sector="Office", klass="Class B",
         city="Calgary", province="AB", country="Canada", submarket="Downtown West",
         lat=51.0478, lon=-114.0593, size=350_000, year_built=1982,
         acquired="2014-05-20", acq_price=96_000_000, cap=0.0950, target_noi=5_340_000,
         occ_start=0.750, occ_end=0.700, budget_occ_delta=0.040, rent=17.0, rent_growth=0.005,
         opex=18.0, recovery=0.78, snow=True, anchor_expiry="2028-08-31",
         loan=dict(ltv=0.45, rate=0.0595, start="2021-12-15", maturity="2026-12-15", amort=25, lender="Schedule I bank")),
    dict(id="P05", short="Heartland", name="Heartland Crossing", sector="Industrial", klass="Bulk distribution",
         city="Columbus", province="OH", country="US", submarket="Rickenbacker",
         lat=39.8130, lon=-82.9330, size=820_000, year_built=2016,
         acquired="2020-11-05", acq_price=68_000_000, cap=0.0600, target_noi=5_100_000,
         occ_start=0.930, occ_end=0.980, budget_occ_delta=0.000, rent=6.6, rent_growth=0.040,
         opex=2.1, recovery=0.95, snow=True, anchor_expiry="2032-10-31",
         loan=dict(ltv=0.55, rate=0.0320, start="2020-11-05", maturity="2030-11-05", amort=0, lender="Life company")),
    dict(id="P06", short="O'Hare Gateway", name="O'Hare Gateway", sector="Industrial", klass="Logistics",
         city="Elk Grove Village", province="IL", country="US", submarket="O'Hare",
         lat=42.0039, lon=-87.9703, size=540_000, year_built=2019,
         acquired="2021-07-12", acq_price=74_000_000, cap=0.0575, target_noi=4_600_000,
         occ_start=0.970, occ_end=0.960, budget_occ_delta=0.000, rent=9.1, rent_growth=0.045,
         opex=2.6, recovery=0.95, snow=True, anchor_expiry="2030-06-30",
         loan=dict(ltv=0.50, rate=0.0345, start="2021-07-12", maturity="2031-07-12", amort=0, lender="CMBS")),
    dict(id="P07", short="Peel Park", name="Peel Distribution Park", sector="Industrial", klass="Logistics",
         city="Brampton", province="ON", country="Canada", submarket="Peel Region",
         lat=43.7315, lon=-79.7624, size=610_000, year_built=2017,
         acquired="2019-02-28", acq_price=92_000_000, cap=0.0475, target_noi=8_080_000,
         occ_start=1.000, occ_end=0.990, budget_occ_delta=0.000, rent=14.8, rent_growth=0.050,
         opex=4.1, recovery=0.96, snow=True, anchor_expiry="2031-02-28",
         loan=dict(ltv=0.50, rate=0.0295, start="2019-02-28", maturity="2029-02-28", amort=25, lender="Life company")),
    dict(id="P08", short="Prairie Commons", name="Prairie Commons", sector="Retail", klass="Grocery-anchored",
         city="Plano", province="TX", country="US", submarket="North Dallas",
         lat=33.0198, lon=-96.6989, size=185_000, year_built=2004,
         acquired="2017-04-18", acq_price=41_000_000, cap=0.0675, target_noi=3_300_000,
         occ_start=0.930, occ_end=0.950, budget_occ_delta=0.000, rent=22.0, rent_growth=0.025,
         opex=8.5, recovery=0.88, snow=False, anchor_expiry="2034-01-31",
         loan=dict(ltv=0.55, rate=0.0440, start="2017-04-18", maturity="2027-04-18", amort=30, lender="CMBS")),
    dict(id="P09", short="Credit River", name="Credit River Centre", sector="Retail", klass="Power centre",
         city="Mississauga", province="ON", country="Canada", submarket="Heartland",
         lat=43.5890, lon=-79.6441, size=320_000, year_built=2001,
         acquired="2016-10-03", acq_price=98_000_000, cap=0.0650, target_noi=6_850_000,
         occ_start=0.950, occ_end=0.925, budget_occ_delta=0.030, rent=27.0, rent_growth=0.020,
         opex=11.5, recovery=0.90, snow=True, anchor_expiry="2030-09-30",
         loan=dict(ltv=0.50, rate=0.0370, start="2018-10-03", maturity="2028-10-03", amort=25, lender="Schedule I bank")),
    dict(id="P10", short="Lumière", name="Résidences Lumière", sector="Multifamily", klass="Mid-rise",
         city="Montréal", province="QC", country="Canada", submarket="Le Plateau",
         lat=45.5220, lon=-73.5820, size=312, year_built=2019,
         acquired="2020-06-22", acq_price=92_000_000, cap=0.0475, target_noi=5_070_000,
         occ_start=0.962, occ_end=0.972, budget_occ_delta=0.000, rent=2_050, rent_growth=0.040,
         opex=9_800, snow=True, other_income=85, concessions=0.003, bad_debt=0.006,
         mix=(0.15, 0.45, 0.32, 0.08), loss_to_lease=0.09, trade_out=(6.5, 4.2),
         loan=dict(ltv=0.65, rate=0.0265, start="2020-06-22", maturity="2030-06-22", amort=40, lender="CMHC-insured")),
    dict(id="P11", short="Junction Lofts", name="Junction Lofts", sector="Multifamily", klass="Mid-rise",
         city="Toronto", province="ON", country="Canada", submarket="The Junction",
         lat=43.6655, lon=-79.4658, size=186, year_built=2018,
         acquired="2021-09-14", acq_price=104_000_000, cap=0.0425, target_noi=4_790_000,
         occ_start=0.968, occ_end=0.978, budget_occ_delta=0.000, rent=3_050, rent_growth=0.025,
         opex=12_500, snow=True, other_income=95, concessions=0.004, bad_debt=0.005,
         mix=(0.20, 0.48, 0.28, 0.04), loss_to_lease=0.07, trade_out=(3.0, 3.8),
         loan=dict(ltv=0.65, rate=0.0240, start="2021-09-14", maturity="2031-09-14", amort=40, lender="CMHC-insured")),
    dict(id="P12", short="Cedar Bend", name="Cedar Bend", sector="Multifamily", klass="Garden",
         city="Austin", province="TX", country="US", submarket="North Austin",
         lat=30.3900, lon=-97.7100, size=420, year_built=2015,
         acquired="2022-01-20", acq_price=96_000_000, cap=0.0525, target_noi=3_600_000,
         occ_start=0.880, occ_end=0.910, budget_occ_delta=0.010, rent=1_560, rent_growth=-0.010,
         opex=8_600, snow=False, other_income=140, concessions=0.040, bad_debt=0.015,
         mix=(0.00, 0.48, 0.42, 0.10), loss_to_lease=-0.03, trade_out=(-4.2, 1.1),
         loan=dict(ltv=0.60, rate=0.0510, start="2022-01-20", maturity="2029-01-20", amort=0, lender="Agency")),
    dict(id="P13", short="Highline", name="Highline Flats", sector="Multifamily", klass="Mid-rise",
         city="Denver", province="CO", country="US", submarket="RiNo",
         lat=39.7680, lon=-104.9790, size=264, year_built=2020,
         acquired="2021-04-08", acq_price=79_000_000, cap=0.0525, target_noi=3_000_000,
         occ_start=0.920, occ_end=0.940, budget_occ_delta=0.000, rent=1_880, rent_growth=0.005,
         opex=9_200, snow=True, other_income=140, concessions=0.025, bad_debt=0.009,
         mix=(0.12, 0.50, 0.33, 0.05), loss_to_lease=0.01, trade_out=(-1.5, 2.4),
         loan=dict(ltv=0.60, rate=0.0335, start="2021-04-08", maturity="2031-04-08", amort=0, lender="Agency")),
]

ACCOUNTS = [
    ("4000", "Rental income", "revenue"),
    ("4100", "Vacancy & concessions", "revenue"),
    ("4200", "Expense recoveries", "revenue"),
    ("4300", "Parking & other income", "revenue"),
    ("4900", "Bad debt", "revenue"),
    ("6000", "Property taxes", "opex"),
    ("6100", "Insurance", "opex"),
    ("6200", "Utilities", "opex"),
    ("6300", "Repairs & maintenance", "opex"),
    ("6400", "Cleaning & turnover", "opex"),
    ("6500", "Snow & landscaping", "opex"),
    ("6600", "Payroll & administration", "opex"),
    ("6700", "Management fees", "opex"),
    ("7000", "Interest expense", "debt"),
    ("7100", "Principal amortization", "debt"),
    ("8000", "Leasing costs (TI & LC)", "capex"),
    ("8100", "Building improvements", "capex"),
]
OPEX_CODES = ["6000", "6100", "6200", "6300", "6400", "6500", "6600"]

# Share of the opex budget by category (management fee is computed separately).
OPEX_SHARE = {
    "Office":      [0.30, 0.06, 0.20, 0.12, 0.14, 0.03, 0.15],
    "Industrial":  [0.48, 0.12, 0.06, 0.14, 0.02, 0.10, 0.08],
    "Retail":      [0.40, 0.08, 0.10, 0.14, 0.10, 0.08, 0.10],
    "Multifamily": [0.28, 0.09, 0.14, 0.14, 0.08, 0.05, 0.22],
}
MGMT_FEE = {"Office": 0.025, "Industrial": 0.020, "Retail": 0.035, "Multifamily": 0.0325}
FREE_RENT = {"Office": 0.020, "Industrial": 0.003, "Retail": 0.005}
COMM_BAD_DEBT = {"Office": 0.006, "Industrial": 0.002, "Retail": 0.010}
OTHER_INCOME_PSF = {"Office": 2.4, "Industrial": 0.12, "Retail": 0.9}
CAPEX = {  # (leasing costs, building improvements) per sf/yr or per unit/yr
    "Office": (3.6, 1.2), "Industrial": (0.55, 0.25), "Retail": (1.8, 0.6), "Multifamily": (0, 700),
}
CAP_SHIFT_3Y = {"Office": 0.0075, "Industrial": 0.0015, "Retail": 0.0, "Multifamily": 0.0035}

UTIL_SEASON = np.array([1.25, 1.20, 1.00, 0.85, 0.90, 1.08, 1.25, 1.25, 1.05, 0.88, 0.92, 1.18])
SNOW_SEASON = np.array([2.3, 2.1, 1.3, 0.6, 0.7, 0.7, 0.7, 0.7, 0.6, 0.6, 0.9, 2.0])
LAND_SEASON = np.array([0.6, 0.6, 0.9, 1.2, 1.3, 1.3, 1.3, 1.2, 1.1, 1.0, 0.8, 0.6])
UTIL_SEASON /= UTIL_SEASON.mean()
SNOW_SEASON /= SNOW_SEASON.mean()
LAND_SEASON /= LAND_SEASON.mean()

PREFIXES = """Alder Basalt Birchgate Cobalt Corvid Driftwood Ember Fernhill Fieldstone Gannet
Harrow Heron Ironbark Juniper Kestrel Larkspur Lumen Marlowe Nimbus Northfold Oakline
Ostrander Pinecrest Quarrystone Redwing Riverstone Saltmarsh Tamarack Tidewater Umberland
Vantor Wexley Willowmere Yarrowfield Bramble Calder Dunmore Elmstead Foxglove Glenhaven
Hollis Inkwell Jasperline Kingsmere Lindqvist Moraine Norland Orchard Peregrine Quillon
Rookwood Sable Thistle Upland Verity Wrenfield Ashby Brightwater Coldwell Deerfoot""".split()
SURNAMES = """Abernathy Okafor Lindgren Castellano Whitcombe Desrosiers Nakamura Fairbairn
Moreau Halvorsen Achebe Ferreira Kowalczyk Tremblay Iverson Bellamy Osei Laurier""".split()
INDUSTRY_NAMES = {
    "Legal": ["{s1} & {s2} LLP", "{s1} {s2} Law"],
    "Financial services": ["{p} Capital", "{p} Wealth Partners", "{p} Asset Management"],
    "Technology": ["{p} Software", "{p} Analytics", "{p} Labs"],
    "Insurance": ["{p} Insurance Group", "{p} Underwriters"],
    "Consulting": ["{p} Advisory", "{p} Consulting"],
    "Healthcare": ["{p} Health Partners", "{p} Medical Group"],
    "Flexible workspace": ["{p} Workspace"],
    "Third-party logistics": ["{p} Logistics", "{p} Freight Services"],
    "E-commerce fulfilment": ["{p} Fulfilment", "{p} Parcel"],
    "Food distribution": ["{p} Foods Distribution", "{p} Provisions"],
    "Building products": ["{p} Building Supply"],
    "Auto parts": ["{p} Auto Supply"],
    "Grocery": ["{p} Market", "{p} Fresh Foods"],
    "Pharmacy": ["{p} Pharmacy"],
    "Fitness": ["{p} Fitness Club"],
    "Restaurant": ["{p} Kitchen", "{p} Taqueria", "{p} Coffee House", "{p} Noodle Bar"],
    "Apparel": ["{p} Outfitters", "{p} Apparel"],
    "Discount": ["{p} Value Store"],
    "Bank branch": ["{p} Credit Union"],
    "Medical clinic": ["{p} Family Clinic", "{p} Dental"],
    "Pet supplies": ["{p} Pet Supply"],
    "Home goods": ["{p} Home"],
}
OFFICE_INDUSTRIES = ["Legal", "Financial services", "Technology", "Insurance", "Consulting",
                     "Healthcare", "Flexible workspace"]
INDUSTRIAL_INDUSTRIES = ["Third-party logistics", "E-commerce fulfilment", "Food distribution",
                         "Building products", "Auto parts"]
RETAIL_SHOPS = ["Restaurant", "Apparel", "Bank branch", "Medical clinic", "Pet supplies",
                "Fitness", "Restaurant", "Medical clinic"]
UNIT_TYPES = ["Studio", "1 bedroom", "2 bedroom", "3 bedroom"]
UNIT_SF = [480, 690, 960, 1_240]
UNIT_RENT_MULT = np.array([0.76, 1.00, 1.33, 1.65])


def periods() -> pd.PeriodIndex:
    end = pd.Period(config.AS_OF, freq="M")
    return pd.period_range(end=end, periods=config.HISTORY_MONTHS, freq="M")


def _fx(p: dict) -> float:
    return config.CAD_TO_USD if p["country"] == "Canada" else 1.0


def _smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------------------
# Debt
# ---------------------------------------------------------------------------
def loan_schedule(p: dict, months: pd.PeriodIndex) -> pd.DataFrame:
    ln = p["loan"]
    principal = ln["ltv"] * p["acq_price"]
    r = ln["rate"] / 12
    start = pd.Period(ln["start"], freq="M")
    n_amort = ln["amort"] * 12
    pay = principal * r / (1 - (1 + r) ** -n_amort) if n_amort else principal * r
    rows = []
    for per in months:
        k = (per - start).n  # payments made before this month
        if n_amort:
            bal = principal * (1 + r) ** k - pay * ((1 + r) ** k - 1) / r
            interest = bal * r
            princ = pay - interest
        else:
            bal, interest, princ = principal, principal * r, 0.0
        rows.append((per, interest, princ, bal - princ))
    return pd.DataFrame(rows, columns=["period", "interest", "principal", "balance"]).set_index("period")


# ---------------------------------------------------------------------------
# Monthly operating model
# ---------------------------------------------------------------------------
def _occupancy(p: dict, months: pd.PeriodIndex, actual: bool, rng) -> np.ndarray:
    hist = periods()
    t = np.array([(m - hist[0]).n for m in months], dtype=float)
    base = p["occ_start"] + (p["occ_end"] - p["occ_start"]) * _smooth(t / (len(hist) - 1))
    if actual:
        noise = rng.normal(0, 0.003 if p["sector"] == "Multifamily" else 0.002, len(t))
        occ = base + noise
        if p["sector"] == "Multifamily":
            occ += -0.006 * np.cos(2 * np.pi * (np.array([m.month for m in months]) - 1) / 12)
        # events
        for i, m in enumerate(months):
            if p["id"] == "P04" and m >= pd.Period("2026-06", "M"):
                occ[i] -= 0.030
            if p["id"] == "P09" and m >= pd.Period("2026-04", "M"):
                occ[i] -= 0.035
            if p["id"] == "P02" and m >= pd.Period("2025-11", "M"):
                occ[i] += 0.015
    else:
        dec = pd.Period("2025-12", "M")
        ref = p["occ_start"] + (p["occ_end"] - p["occ_start"]) * _smooth((dec - hist[0]).n / (len(hist) - 1))
        goal = p["occ_end"] + p["budget_occ_delta"]
        frac = np.array([(m - dec).n for m in months]) / 12
        occ = ref + (goal - ref) * frac
    occ = np.clip(occ, 0.40, 1.0)
    return np.round(occ, 4) if p["sector"] == "Multifamily" else np.round(occ * 400) / 400


def model(p: dict, months: pd.PeriodIndex, actual: bool, k: float = 1.0) -> pd.DataFrame:
    """Return a monthly frame of account amounts (local currency) plus occupancy."""
    idx = [x for x in PROPERTIES].index(p)
    rng = np.random.default_rng(config.RANDOM_SEED + idx * 97 + (0 if actual else 7))
    hist = periods()
    t = np.array([(m - hist[-1]).n for m in months], dtype=float)  # 0 = Sep 2026
    mo = np.array([m.month for m in months]) - 1
    sector = p["sector"]
    size = p["size"]
    occ = _occupancy(p, months, actual, rng)
    jitter = (lambda s: 1 + rng.normal(0, s, len(t))) if actual else (lambda s: np.ones(len(t)))

    rent_level = p["rent"] * k * (1 + p["rent_growth"]) ** (t / 12)
    infl = (1.03 if actual else 1.035) ** (t / 12)
    opex_annual = p["opex"] * size * infl
    shares = OPEX_SHARE[sector]

    out = pd.DataFrame(index=months)
    out["occ"] = occ

    opex = {}
    opex["6000"] = opex_annual * shares[0] / 12 * jitter(0.01)
    opex["6100"] = opex_annual * shares[1] / 12 * jitter(0.01)
    opex["6200"] = opex_annual * shares[2] / 12 * UTIL_SEASON[mo] * jitter(0.06)
    opex["6300"] = opex_annual * shares[3] / 12 * jitter(0.14)
    opex["6400"] = opex_annual * shares[4] / 12 * (0.85 + 0.15 * occ / occ.mean()) * jitter(0.05)
    season = SNOW_SEASON if p["snow"] else LAND_SEASON
    opex["6500"] = opex_annual * shares[5] / 12 * season[mo] * jitter(0.10)
    opex["6600"] = opex_annual * shares[6] / 12 * jitter(0.02)

    if actual:
        for i, m in enumerate(months):
            if p["snow"] and p["lat"] > 41 and m in (pd.Period("2026-01", "M"), pd.Period("2026-02", "M")):
                opex["6500"][i] *= 1.65            # heavy winter in Chicago / Toronto
            if m >= pd.Period("2026-07", "M"):
                opex["6100"][i] *= 1.12            # insurance renewal above plan
            if p["id"] == "P01" and m == pd.Period("2026-08", "M"):
                opex["6000"][i] -= 350_000         # property-tax appeal refund

    if sector == "Multifamily":
        gpr = size * rent_level
        out["4000"] = gpr
        conc = p["concessions"] * (1.35 if (actual and p["id"] == "P12") else 1.0)
        out["4100"] = -(gpr * (1 - occ) + gpr * conc * jitter(0.15))
        out["4200"] = 0.0
        out["4300"] = size * p["other_income"] * occ * jitter(0.04)
        out["4900"] = -gpr * p["bad_debt"] * np.clip(jitter(0.35), 0.2, None)
    else:
        occupied = size * occ
        base = occupied * rent_level / 12
        out["4000"] = base
        out["4100"] = -base * FREE_RENT[sector] * np.clip(jitter(0.5), 0, None)
        recoverable = sum(opex[c] for c in ["6000", "6100", "6200", "6300", "6400", "6500"]) + 0.5 * opex["6600"]
        rec = p["recovery"] * occ * recoverable
        if actual:
            # March: prior-year CAM / tax reconciliation true-up
            for i, m in enumerate(months):
                if m.month == 3:
                    rec[i] += rec.mean() * 12 * rng.normal(0.004, 0.02)
        out["4200"] = rec
        out["4300"] = size * OTHER_INCOME_PSF[sector] / 12 * (0.6 + 0.4 * occ) * jitter(0.05)
        out["4900"] = -base * COMM_BAD_DEBT[sector] * np.clip(jitter(0.6), 0, None)
        if actual:
            for i, m in enumerate(months):
                if p["id"] == "P04" and m == pd.Period("2026-05", "M"):
                    out.iloc[i, out.columns.get_loc("4900")] -= 240_000   # tenant default
                if p["id"] == "P09" and m == pd.Period("2026-03", "M"):
                    out.iloc[i, out.columns.get_loc("4900")] -= 310_000   # retailer insolvency

    revenue = out[["4000", "4100", "4200", "4300", "4900"]].sum(axis=1)
    for c, v in opex.items():
        out[c] = v
    out["6700"] = revenue * MGMT_FEE[sector]

    # capital spend
    lc_rate, bi_rate = CAPEX[sector]
    if actual:
        lumps = rng.gamma(0.6, 1 / 0.6, len(t))
        out["8000"] = lc_rate * size / 12 * lumps
        out["8100"] = bi_rate * size / 12 * rng.gamma(1.2, 1 / 1.2, len(t))
    else:
        out["8000"] = lc_rate * size / 12
        out["8100"] = bi_rate * size / 12

    sched = loan_schedule(p, months)
    out["7000"] = sched["interest"].values
    out["7100"] = sched["principal"].values
    return out


def noi(frame: pd.DataFrame) -> pd.Series:
    rev = frame[["4000", "4100", "4200", "4300", "4900"]].sum(axis=1)
    exp = frame[OPEX_CODES + ["6700"]].sum(axis=1)
    return rev - exp


def calibrate(p: dict) -> float:
    """Find the rent multiplier that makes trailing-12 NOI hit the target."""
    hist = periods()
    t12 = hist[-12:]
    n1 = noi(model(p, t12, True, 1.0)).sum()
    n2 = noi(model(p, t12, True, 1.2)).sum()
    slope = (n2 - n1) / 0.2
    return 1.0 + (p["target_noi"] - n1) / slope


# ---------------------------------------------------------------------------
# Rent roll, unit mix, receivables
# ---------------------------------------------------------------------------
class NameBook:
    def __init__(self, rng):
        self.rng = rng
        self.used = set()

    def make(self, industry: str) -> str:
        for _ in range(200):
            pattern = self.rng.choice(INDUSTRY_NAMES[industry])
            s1, s2 = self.rng.choice(SURNAMES, 2, replace=False)
            name = pattern.format(p=self.rng.choice(PREFIXES), s1=s1, s2=s2)
            if name not in self.used:
                self.used.add(name)
                return name
        raise RuntimeError("ran out of tenant names")


def _lease_sizes(p: dict, occupied: float, rng) -> list[tuple[float, str, bool]]:
    """Return (sf, industry, is_anchor) tuples summing to the occupied area."""
    sector, gla = p["sector"], p["size"]
    out: list[tuple[float, str, bool]] = []
    if sector == "Industrial":
        n = 3 if gla > 700_000 else 2
        shares = np.sort(rng.dirichlet(np.ones(n) * 4))[::-1]
        for i, s in enumerate(shares):
            out.append((occupied * s, rng.choice(INDUSTRIAL_INDUSTRIES), i == 0))
        return out
    if sector == "Office":
        anchors = [0.15, 0.09] if gla >= 400_000 else [0.18]
        for i, a in enumerate(anchors):
            out.append((gla * a, "Legal" if i == 0 else "Financial services", True))
        remaining = occupied - sum(x[0] for x in out)
        while remaining > 2_000:
            sf = float(np.clip(rng.lognormal(np.log(8_500), 0.75), 1_800, 38_000))
            sf = min(sf, remaining)
            out.append((sf, rng.choice(OFFICE_INDUSTRIES), False))
            remaining -= sf
        return out
    # retail
    out.append((gla * 0.22, "Grocery" if p["id"] == "P08" else "Home goods", True))
    juniors = ["Pharmacy", "Fitness", "Discount"] if gla > 250_000 else ["Pharmacy", "Discount"]
    for j in juniors:
        out.append((gla * rng.uniform(0.07, 0.11), j, True))
    remaining = occupied - sum(x[0] for x in out)
    while remaining > 1_000:
        sf = float(np.clip(rng.lognormal(np.log(3_000), 0.55), 1_100, 9_000))
        sf = min(sf, remaining)
        out.append((sf, rng.choice(RETAIL_SHOPS), False))
        remaining -= sf
    return out


def build_rent_roll(p: dict, annual_rent_local: float, occupied: float, names: NameBook, rng) -> list[dict]:
    sizes = _lease_sizes(p, occupied, rng)
    as_of = pd.Timestamp(config.AS_OF)
    rows = []
    for i, (sf, industry, anchor) in enumerate(sizes):
        if anchor and i == 0:
            expiry = pd.Timestamp(p["anchor_expiry"])
        else:
            yrs = rng.choice(np.arange(0, 10), p=np.array([5, 13, 15, 14, 13, 12, 10, 8, 6, 4]) / 100)
            expiry = (as_of + pd.DateOffset(months=int(yrs * 12 + rng.integers(1, 13)))) + pd.offsets.MonthEnd(0)
        term_years = int(rng.integers(10, 16)) if anchor else int(rng.integers(3, 11))
        start = max(expiry - pd.DateOffset(years=term_years) + pd.Timedelta(days=1), pd.Timestamp("2008-01-01"))
        if start > as_of:  # every lease on the roll has already commenced
            start = (as_of - pd.DateOffset(months=int(rng.integers(1, 30)))).replace(day=1)
        mult = rng.lognormal(0, 0.10) * (0.85 if anchor else (1.25 if p["sector"] == "Retail" else 1.0))
        if p["sector"] == "Office":
            floor = int(rng.integers(2, 42))
            while any(r["suite"] == f"Suite {floor:02d}00" for r in rows):
                floor = int(rng.integers(2, 60))
            suite = f"Suite {floor:02d}00"
        elif p["sector"] == "Industrial":
            suite = f"Unit {'ABCDEF'[i]}"
        else:
            suite = f"CRU {100 + i:03d}"
        rows.append(dict(tenant=names.make(industry), industry=industry, suite=suite, sf=round(sf),
                         start=start.date().isoformat(), expiry=expiry.date().isoformat(),
                         anchor=int(anchor), mult=mult))
    weights = np.array([r["sf"] * r["mult"] for r in rows])
    psf_scale = annual_rent_local / weights.sum()
    for r in rows:
        r["rent_psf"] = r.pop("mult") * psf_scale
    return rows


# ---------------------------------------------------------------------------
# Build everything
# ---------------------------------------------------------------------------
def build(db_path=config.DB_PATH) -> None:
    rng = np.random.default_rng(config.RANDOM_SEED)
    names = NameBook(rng)
    hist = periods()
    budget_months = pd.period_range(f"{config.FISCAL_YEAR}-01", f"{config.FISCAL_YEAR}-12", freq="M")
    acct_name = {c: n for c, n, _ in ACCOUNTS}
    acct_cat = {c: g for c, _, g in ACCOUNTS}

    prop_rows, ledger_rows, occ_rows, lease_rows = [], [], [], []
    unit_rows, ar_rows, loan_rows, val_rows = [], [], [], []
    quarter_ends = [m for m in hist if m.month in (3, 6, 9, 12)]

    for p in PROPERTIES:
        fx = _fx(p)
        k = calibrate(p)
        act = model(p, hist, True, k)
        bud = model(p, budget_months, False, k)

        for scen, frame in (("actual", act), ("budget", bud)):
            for per, row in frame.iterrows():
                occ_rows.append((p["id"], str(per), scen, float(row["occ"])))
                for code, _, _ in ACCOUNTS:
                    ledger_rows.append((p["id"], str(per), scen, code, acct_name[code], acct_cat[code],
                                        float(row[code]) * fx))

        n = noi(act)
        t12_noi = float(n.iloc[-12:].sum())
        value = t12_noi / p["cap"]

        # quarterly appraisals
        for q in quarter_ends:
            pos = hist.get_loc(q)
            if pos < 11:      # need a full trailing year of ledger history
                continue
            q_noi = float(n.iloc[pos - 11: pos + 1].sum())
            frac = 1 - pos / (len(hist) - 1)
            q_cap = p["cap"] - CAP_SHIFT_3Y[p["sector"]] * frac
            val_rows.append((p["id"], q.end_time.date().isoformat(), q_noi * fx, q_cap, q_noi / q_cap * fx))

        # loan
        ln = p["loan"]
        sched = loan_schedule(p, pd.PeriodIndex([hist[-1]]))
        principal = ln["ltv"] * p["acq_price"]
        r = ln["rate"] / 12
        if ln["amort"]:
            pay = principal * r / (1 - (1 + r) ** -(ln["amort"] * 12))
            ads = pay * 12
        else:
            ads = principal * ln["rate"]
        loan_rows.append((p["id"], ln["lender"], principal * fx, ln["start"], ln["rate"], ln["amort"],
                          ln["maturity"], float(sched["balance"].iloc[0]) * fx, ads * fx))

        occ_now = float(act["occ"].iloc[-1])
        trade_new = trade_renew = None
        if p["sector"] == "Multifamily":
            units = p["size"]
            mix = np.array(p["mix"])
            counts = np.round(mix * units).astype(int)
            counts[np.argmax(counts)] += units - counts.sum()
            avg_rent = p["rent"] * k
            mult = UNIT_RENT_MULT / (UNIT_RENT_MULT * mix).sum()
            for ut, c, m, sf in zip(UNIT_TYPES, counts, mult, UNIT_SF):
                if c == 0:
                    continue
                type_occ = np.clip(occ_now + rng.normal(0, 0.012), 0.8, 1.0)
                in_place = avg_rent * m
                unit_rows.append((p["id"], ut, int(c), int(round(c * type_occ)), sf * (1.08 if p["klass"] == "Garden" else 1),
                                  in_place * fx, in_place * (1 + p["loss_to_lease"]) * fx))
            trade_new, trade_renew = p["trade_out"]
            gpr = units * avg_rent
            buckets = np.array([0.0060, 0.0024, 0.0011, 0.0016]) * (2.2 if p["id"] == "P12" else 1.0)
            buckets = buckets * gpr * fx * rng.uniform(0.8, 1.2, 4)
            ar_rows.append((p["id"], "Residential ledger (all units)", *map(float, buckets)))
        else:
            annual_rent = float(act["4000"].iloc[-1]) * 12
            roll = build_rent_roll(p, annual_rent, p["size"] * occ_now, names, rng)
            for r_ in roll:
                lease_rows.append((p["id"], r_["tenant"], r_["industry"], r_["suite"], r_["sf"], r_["start"],
                                   r_["expiry"], r_["anchor"], r_["rent_psf"] * fx, r_["rent_psf"] * r_["sf"] * fx))
                monthly = r_["rent_psf"] * r_["sf"] / 12 * 1.45 * fx
                cur = monthly * rng.uniform(0.05, 0.9) if rng.random() < 0.28 else 0.0
                d60 = monthly * rng.uniform(0.2, 1.0) if rng.random() < 0.09 else 0.0
                d90 = monthly * rng.uniform(0.2, 1.0) if rng.random() < 0.05 else 0.0
                d90p = monthly * rng.uniform(0.3, 1.5) if rng.random() < 0.035 else 0.0
                if cur + d60 + d90 + d90p > 0:
                    ar_rows.append((p["id"], r_["tenant"], cur, d60, d90, d90p))
            if p["id"] in ("P04", "P09"):
                hit = {"P04": 240_000, "P09": 310_000}[p["id"]] * fx
                ar_rows.append((p["id"], names.make("Consulting" if p["id"] == "P04" else "Apparel") + " (vacated)",
                                0.0, 0.0, hit * 0.25, hit * 0.75))

        prop_rows.append(dict(
            id=p["id"], name=p["name"], short=p["short"], sector=p["sector"], klass=p["klass"], city=p["city"],
            province=p["province"], country=p["country"], submarket=p["submarket"], lat=p["lat"], lon=p["lon"],
            size=p["size"], size_unit="units" if p["sector"] == "Multifamily" else "sf",
            year_built=p["year_built"], acquired=p["acquired"], acq_price=p["acq_price"] * fx,
            local_currency="CAD" if p["country"] == "Canada" else "USD", fx_to_usd=fx,
            cap_rate=p["cap"], noi_t12=t12_noi * fx, value=value * fx, occupancy=occ_now,
            trade_out_new=trade_new, trade_out_renewal=trade_renew,
        ))

    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    con = sqlite3.connect(db_path)
    try:
        pd.DataFrame(prop_rows).to_sql("properties", con, index=False)
        pd.DataFrame(ledger_rows, columns=["property_id", "period", "scenario", "account_code", "account_name",
                                           "category", "amount"]).to_sql("ledger", con, index=False)
        pd.DataFrame(occ_rows, columns=["property_id", "period", "scenario", "occupancy"]).to_sql(
            "occupancy", con, index=False)
        pd.DataFrame(lease_rows, columns=["property_id", "tenant", "industry", "suite", "sf", "start_date",
                                          "expiry_date", "anchor", "rent_psf", "annual_rent"]).to_sql(
            "leases", con, index=False)
        pd.DataFrame(unit_rows, columns=["property_id", "unit_type", "units", "occupied", "avg_sf",
                                         "in_place_rent", "market_rent"]).to_sql("unit_mix", con, index=False)
        pd.DataFrame(ar_rows, columns=["property_id", "tenant", "current", "d31_60", "d61_90", "d90_plus"]).to_sql(
            "ar_aging", con, index=False)
        pd.DataFrame(loan_rows, columns=["property_id", "lender_type", "original_amount", "start_date", "rate",
                                         "amort_years", "maturity_date", "balance", "annual_debt_service"]).to_sql(
            "loans", con, index=False)
        pd.DataFrame(val_rows, columns=["property_id", "quarter_end", "noi_t12", "cap_rate", "value"]).to_sql(
            "valuations", con, index=False)
        con.executescript("""
            CREATE INDEX ix_ledger ON ledger(property_id, scenario, period);
            CREATE INDEX ix_occ ON occupancy(property_id, scenario, period);
            CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
        """)
        con.executemany("INSERT INTO meta VALUES (?, ?)", [
            ("as_of", config.AS_OF.isoformat()), ("fiscal_year", str(config.FISCAL_YEAR)),
            ("cad_to_usd", str(config.CAD_TO_USD)), ("built", date.today().isoformat()),
        ])
        con.commit()
    finally:
        con.close()


def ensure_database() -> None:
    if not config.DB_PATH.exists():
        print("Building the sample portfolio database ...")
        build()
        print(f"  wrote {config.DB_PATH}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate the Elevation sample portfolio database.")
    ap.add_argument("--force", action="store_true", help="rebuild even if the database exists")
    args = ap.parse_args()
    if args.force or not config.DB_PATH.exists():
        build()
        print(f"Wrote {config.DB_PATH}")
    else:
        print(f"{config.DB_PATH} already exists (use --force to rebuild)")


if __name__ == "__main__":
    main()
