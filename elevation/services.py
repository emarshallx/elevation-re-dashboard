"""Query layer: reads the SQLite ledger with SQL + pandas and shapes dashboard payloads.

Each public function returns plain dicts/lists ready to be sent as JSON.
"""
from __future__ import annotations

import json
import sqlite3
from functools import lru_cache

import numpy as np
import pandas as pd

from . import config, finance

REVENUE = ["4000", "4100", "4200", "4300", "4900"]
OPEX = ["6000", "6100", "6200", "6300", "6400", "6500", "6600", "6700"]
SECTORS = ["Office", "Industrial", "Retail", "Multifamily"]
COMMERCIAL = ["Office", "Industrial", "Retail"]


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------
def _connect() -> sqlite3.Connection:
    return sqlite3.connect(config.DB_PATH)


@lru_cache(maxsize=2)
def _tables(_mtime: float) -> dict[str, pd.DataFrame]:
    with _connect() as con:
        names = ["properties", "ledger", "occupancy", "leases", "unit_mix", "ar_aging", "loans", "valuations"]
        t = {n: pd.read_sql(f"SELECT * FROM {n}", con) for n in names}
        t["meta"] = pd.read_sql("SELECT * FROM meta", con)
    return t


def tables() -> dict[str, pd.DataFrame]:
    return _tables(config.DB_PATH.stat().st_mtime)


def _months(start: str, end: str) -> list[str]:
    return [str(p) for p in pd.period_range(start, end, freq="M")]


AS_OF = pd.Period(config.AS_OF, freq="M")
FY = config.FISCAL_YEAR
T12 = _months(str(AS_OF - 11), str(AS_OF))
PRIOR_T12 = _months(str(AS_OF - 23), str(AS_OF - 12))
YTD = _months(f"{FY}-01", str(AS_OF))
PY_YTD = _months(f"{FY - 1}-01", str(AS_OF - 12))
REST_OF_YEAR = _months(str(AS_OF + 1), f"{FY}-12")


def _select(region: str = "all", sector: str = "all") -> pd.DataFrame:
    props = tables()["properties"]
    if region and region != "all":
        props = props[props["country"] == region]
    if sector and sector != "all":
        props = props[props["sector"] == sector]
    return props


def _ledger(ids, scenario="actual") -> pd.DataFrame:
    led = tables()["ledger"]
    return led[(led["property_id"].isin(ids)) & (led["scenario"] == scenario)]


def _noi_by_period(led: pd.DataFrame) -> pd.Series:
    signed = np.where(led["category"] == "revenue", led["amount"],
                      np.where(led["category"] == "opex", -led["amount"], 0.0))
    return pd.Series(signed, index=led.index).groupby(led["period"]).sum()


def _sum(led: pd.DataFrame, codes, months) -> float:
    m = led[led["account_code"].isin(codes) & led["period"].isin(months)]
    return float(m["amount"].sum())


def _noi(led, months) -> float:
    return _sum(led, REVENUE, months) - _sum(led, OPEX, months)


def _years_between(a: pd.Timestamp, b: pd.Timestamp) -> float:
    return (b - a).days / 365.25


# ---------------------------------------------------------------------------
# Shared building blocks
# ---------------------------------------------------------------------------
def _lease_frame(ids) -> pd.DataFrame:
    leases = tables()["leases"]
    leases = leases[leases["property_id"].isin(ids)].copy()
    as_of = pd.Timestamp(config.AS_OF)
    leases["expiry"] = pd.to_datetime(leases["expiry_date"])
    leases["years_left"] = (leases["expiry"] - as_of).dt.days / 365.25
    return leases


def _walt(leases: pd.DataFrame) -> float:
    return finance.walt(zip(leases["annual_rent"], leases["years_left"]))


def _occupancy_kpis(props: pd.DataFrame) -> dict:
    com = props[props["sector"].isin(COMMERCIAL)]
    res = props[props["sector"] == "Multifamily"]
    out = {}
    if len(com):
        out["commercial"] = float((com["occupancy"] * com["size"]).sum() / com["size"].sum())
        out["commercial_sf"] = float(com["size"].sum())
    if len(res):
        out["residential"] = float((res["occupancy"] * res["size"]).sum() / res["size"].sum())
        out["residential_units"] = int(res["size"].sum())
    return out


def _debt_kpis(props: pd.DataFrame) -> dict:
    loans = tables()["loans"]
    loans = loans[loans["property_id"].isin(props["id"])]
    debt = float(loans["balance"].sum())
    ads = float(loans["annual_debt_service"].sum())
    noi = float(props["noi_t12"].sum())
    value = float(props["value"].sum())
    as_of = pd.Timestamp(config.AS_OF)
    term = (pd.to_datetime(loans["maturity_date"]) - as_of).dt.days / 365.25
    return dict(
        debt=debt, ltv=debt / value if value else None, dscr=noi / ads if ads else None,
        debt_yield=noi / debt if debt else None,
        wtd_rate=float((loans["rate"] * loans["balance"]).sum() / debt) if debt else None,
        wtd_term=float((term * loans["balance"]).sum() / debt) if debt else None,
        annual_debt_service=ads,
    )


def _watchlist(props: pd.DataFrame) -> list[dict]:
    t = tables()
    loans = t["loans"].set_index("property_id")
    as_of = pd.Timestamp(config.AS_OF)
    leases = _lease_frame(props["id"])
    flags = []
    for _, p in props.iterrows():
        ln = loans.loc[p["id"]]
        months_to_maturity = (pd.Timestamp(ln["maturity_date"]) - as_of).days / 30.44
        p_ltv = ln["balance"] / p["value"]
        p_dscr = p["noi_t12"] / ln["annual_debt_service"]
        if months_to_maturity <= 12:
            flags.append(dict(id=p["id"], name=p["name"], severity="critical",
                              issue=f"Loan matures {pd.Timestamp(ln['maturity_date']):%b %Y}",
                              detail=f"${ln['balance'] / 1e6:,.1f}M to refinance at {p_ltv:.0%} LTV"))
        elif months_to_maturity <= 24:
            flags.append(dict(id=p["id"], name=p["name"], severity="serious",
                              issue=f"Loan matures {pd.Timestamp(ln['maturity_date']):%b %Y}",
                              detail=f"${ln['balance'] / 1e6:,.1f}M outstanding, {p_ltv:.0%} LTV"))
        if p_ltv > 0.70:
            flags.append(dict(id=p["id"], name=p["name"], severity="serious",
                              issue=f"LTV {p_ltv:.0%}", detail="Above the 70% covenant comfort level"))
        if p_dscr < 1.35:
            flags.append(dict(id=p["id"], name=p["name"], severity="serious",
                              issue=f"DSCR {p_dscr:.2f}x", detail="Coverage below 1.35x"))
        if p["occupancy"] < 0.80:
            flags.append(dict(id=p["id"], name=p["name"], severity="warning",
                              issue=f"Occupancy {p['occupancy']:.0%}", detail="Below 80% leased"))
        pl = leases[leases["property_id"] == p["id"]]
        if len(pl):
            soon = pl[pl["years_left"] <= 1.0]
            share = soon["sf"].sum() / p["size"]
            if share >= 0.08:
                flags.append(dict(id=p["id"], name=p["name"], severity="warning",
                                  issue=f"{share:.0%} of area expires within 12 months",
                                  detail=", ".join(soon.sort_values("sf", ascending=False)["tenant"].head(2))))
    order = {"critical": 0, "serious": 1, "warning": 2}
    return sorted(flags, key=lambda f: order[f["severity"]])


def _expiry_schedule(props: pd.DataFrame) -> dict:
    com = props[props["sector"].isin(COMMERCIAL)]
    leases = _lease_frame(com["id"])
    gla = com.groupby("sector")["size"].sum()
    buckets = [str(y) for y in range(FY, FY + 10)] + [f"{FY + 10}+"]
    leases["bucket"] = leases["expiry"].dt.year.clip(upper=FY + 10).astype(str)
    leases.loc[leases["bucket"] == str(FY + 10), "bucket"] = f"{FY + 10}+"
    total_gla = float(com["size"].sum()) or 1.0
    series = []
    for s in COMMERCIAL:
        if s not in gla.index:
            continue
        sl = leases.merge(com[["id", "sector"]], left_on="property_id", right_on="id")
        sl = sl[sl["sector"] == s].groupby("bucket")["sf"].sum()
        series.append(dict(sector=s, sf=[float(sl.get(b, 0.0)) for b in buckets],
                           pct=[float(sl.get(b, 0.0)) / total_gla for b in buckets]))
    vacant = float(total_gla - leases["sf"].sum()) if len(com) else 0.0
    return dict(buckets=buckets, series=series, vacant_sf=vacant, vacant_pct=vacant / total_gla, gla=total_gla)


# ---------------------------------------------------------------------------
# Public payloads
# ---------------------------------------------------------------------------
def meta() -> dict:
    t = tables()
    m = dict(zip(t["meta"]["key"], t["meta"]["value"]))
    props = t["properties"]
    return dict(
        as_of=m["as_of"], fiscal_year=int(m["fiscal_year"]), cad_to_usd=float(m["cad_to_usd"]),
        currency=config.REPORTING_CURRENCY, sectors=SECTORS, regions=["US", "Canada"],
        properties=props[["id", "name", "short", "sector", "city", "country"]].to_dict("records"),
    )


def portfolio(region="all", sector="all") -> dict:
    props = _select(region, sector)
    ids = list(props["id"])
    if not ids:
        return dict(empty=True)
    led = _ledger(ids)
    bud = _ledger(ids, "budget")
    noi_now, noi_prior = _noi(led, T12), _noi(led, PRIOR_T12)
    value = float(props["value"].sum())
    com_leases = _lease_frame(props[props["sector"].isin(COMMERCIAL)]["id"])

    kpis = dict(
        value=value, acq_cost=float(props["acq_price"].sum()), noi_t12=noi_now,
        noi_growth=noi_now / noi_prior - 1 if noi_prior else None,
        cap_rate=noi_now / value if value else None,
        walt=_walt(com_leases) if len(com_leases) else None,
        occupancy=_occupancy_kpis(props), **_debt_kpis(props),
        count=len(ids),
    )

    actual = _noi_by_period(led).reindex(_months(str(AS_OF - 35), str(AS_OF))).fillna(0)
    budget = _noi_by_period(bud)
    noi_series = dict(
        periods=list(actual.index), actual=list(actual.values),
        budget_periods=list(budget.index), budget=list(budget.values),
    )

    vals = tables()["valuations"].merge(props[["id", "sector"]], left_on="property_id", right_on="id")
    vq = vals.pivot_table(index="quarter_end", columns="sector", values="value", aggfunc="sum").fillna(0)
    value_history = dict(quarters=list(vq.index),
                         series=[dict(sector=s, values=list(vq[s].values)) for s in SECTORS if s in vq.columns])

    occ = tables()["occupancy"]
    occ = occ[(occ["scenario"] == "actual") & occ["property_id"].isin(ids)].merge(
        props[["id", "sector", "size"]], left_on="property_id", right_on="id")
    occ["w"] = occ["occupancy"] * occ["size"]
    og = occ.groupby(["sector", "period"]).agg(w=("w", "sum"), s=("size", "sum")).reset_index()
    og["occ"] = og["w"] / og["s"]
    occupancy_history = [dict(sector=s, periods=list(og[og.sector == s]["period"]),
                              values=list(og[og.sector == s]["occ"])) for s in SECTORS if s in set(og.sector)]

    by_sector = props.groupby("sector").agg(value=("value", "sum"), noi=("noi_t12", "sum"), n=("id", "count"))
    sector_mix = [dict(sector=s, value=float(by_sector.loc[s, "value"]), noi=float(by_sector.loc[s, "noi"]),
                       count=int(by_sector.loc[s, "n"])) for s in SECTORS if s in by_sector.index]

    loans = tables()["loans"].set_index("property_id")
    skyline = []
    for _, p in props.iterrows():
        pl = com_leases[com_leases["property_id"] == p["id"]]
        skyline.append(dict(
            id=p["id"], name=p["name"], short=p["short"], sector=p["sector"], klass=p["klass"], city=p["city"],
            province=p["province"], country=p["country"], lat=p["lat"], lon=p["lon"],
            value=p["value"], noi=p["noi_t12"], occupancy=p["occupancy"], cap_rate=p["cap_rate"],
            size=p["size"], size_unit=p["size_unit"], ltv=loans.loc[p["id"], "balance"] / p["value"],
            walt=_walt(pl) if len(pl) else None,
        ))

    return dict(kpis=kpis, skyline=skyline, noi_series=noi_series, value_history=value_history,
                occupancy_history=occupancy_history, sector_mix=sector_mix,
                expiry=_expiry_schedule(props), watchlist=_watchlist(props))


def property_detail(pid: str) -> dict | None:
    t = tables()
    props = t["properties"]
    if pid not in set(props["id"]):
        return None
    p = props[props["id"] == pid].iloc[0]
    led, bud = _ledger([pid]), _ledger([pid], "budget")
    loan = t["loans"][t["loans"]["property_id"] == pid].iloc[0]
    leases = _lease_frame([pid]).sort_values("sf", ascending=False)

    occ = t["occupancy"][t["occupancy"]["property_id"] == pid]
    occ_a = occ[occ["scenario"] == "actual"]
    occ_b = occ[occ["scenario"] == "budget"]
    noi_a, noi_b = _noi_by_period(led), _noi_by_period(bud)

    rows = []
    for code in REVENUE + OPEX:
        name = led[led["account_code"] == code]["account_name"].iloc[0]
        a, b = _sum(led, [code], YTD), _sum(bud, [code], YTD)
        if abs(a) < 1 and abs(b) < 1:
            continue
        rows.append(dict(code=code, name=name, kind="revenue" if code in REVENUE else "opex", actual=a, budget=b))
    a_noi, b_noi = _noi(led, YTD), _noi(bud, YTD)

    detail = dict(
        property=p.to_dict(),
        kpis=dict(value=p["value"], noi_t12=p["noi_t12"], cap_rate=p["cap_rate"], occupancy=p["occupancy"],
                  unrealized=p["value"] - p["acq_price"], ltv=loan["balance"] / p["value"],
                  dscr=p["noi_t12"] / loan["annual_debt_service"], debt_yield=p["noi_t12"] / loan["balance"],
                  walt=_walt(leases) if len(leases) else None,
                  noi_growth=_noi(led, T12) / _noi(led, PRIOR_T12) - 1),
        noi=dict(periods=list(noi_a.index), actual=list(noi_a.values),
                 budget_periods=list(noi_b.index), budget=list(noi_b.values)),
        occupancy=dict(periods=list(occ_a["period"]), actual=list(occ_a["occupancy"]),
                       budget_periods=list(occ_b["period"]), budget=list(occ_b["occupancy"])),
        ytd=dict(rows=rows, noi_actual=a_noi, noi_budget=b_noi, through=str(AS_OF)),
        loan=loan.to_dict(),
        valuations=t["valuations"][t["valuations"]["property_id"] == pid].to_dict("records"),
        ar=t["ar_aging"][t["ar_aging"]["property_id"] == pid].to_dict("records"),
    )
    if p["sector"] == "Multifamily":
        detail["unit_mix"] = t["unit_mix"][t["unit_mix"]["property_id"] == pid].to_dict("records")
    else:
        roll = leases.drop(columns=["expiry"]).copy()
        roll["pct_gla"] = roll["sf"] / p["size"]
        detail["rent_roll"] = roll.to_dict("records")
        gl_rent = float(led[(led["account_code"] == "4000") & (led["period"] == str(AS_OF))]["amount"].sum()) * 12
        detail["rent_roll_check"] = dict(rent_roll_annual=float(leases["annual_rent"].sum()),
                                         gl_annualized=gl_rent, period=str(AS_OF))
        detail["expiry"] = _expiry_schedule(props[props["id"] == pid])
    return detail


def financials(region="all", sector="all") -> dict:
    props = _select(region, sector)
    ids = list(props["id"])
    if not ids:
        return dict(empty=True)
    led, bud = _ledger(ids), _ledger(ids, "budget")
    names = led.drop_duplicates("account_code").set_index("account_code")["account_name"]

    def line(code_list, label, kind, key=None):
        a, b = _sum(led, code_list, YTD), _sum(bud, code_list, YTD)
        py = _sum(led, code_list, PY_YTD)
        fy_b = _sum(bud, code_list, _months(f"{FY}-01", f"{FY}-12"))
        fcst = a + _sum(bud, code_list, REST_OF_YEAR)
        return dict(key=key or code_list[0], name=label, kind=kind, actual=a, budget=b, prior=py,
                    fy_budget=fy_b, forecast=fcst, t12=_sum(led, code_list, T12))

    statement = [line([c], names[c], "revenue") for c in REVENUE if abs(_sum(led, [c], T12)) > 1]
    statement.append(line(REVENUE, "Total revenue", "revenue_total", "REV"))
    statement += [line([c], names[c], "opex") for c in OPEX]
    statement.append(line(OPEX, "Total operating expenses", "opex_total", "OPEX"))
    rev_t = next(r for r in statement if r["key"] == "REV")
    opx_t = next(r for r in statement if r["key"] == "OPEX")
    noi_row = dict(key="NOI", name="Net operating income", kind="noi",
                   **{k: rev_t[k] - opx_t[k] for k in ("actual", "budget", "prior", "fy_budget", "forecast", "t12")})
    statement.append(noi_row)

    # NOI bridge: prior T12 -> current T12
    steps = []
    for code in REVENUE:
        d = _sum(led, [code], T12) - _sum(led, [code], PRIOR_T12)
        if abs(d) > 1:
            steps.append(dict(label=names[code], delta=d))
    for code in OPEX:
        d = -(_sum(led, [code], T12) - _sum(led, [code], PRIOR_T12))
        steps.append(dict(label=names[code], delta=d))
    bridge = dict(start=_noi(led, PRIOR_T12), end=_noi(led, T12), steps=steps,
                  start_label=f"T12 {PRIOR_T12[-1]}", end_label=f"T12 {T12[-1]}")

    monthly = dict(periods=YTD, actual=[_noi(led, [m]) for m in YTD], budget=[_noi(bud, [m]) for m in YTD])

    opex_mix = sorted([dict(name=names[c], amount=_sum(led, [c], T12)) for c in OPEX],
                      key=lambda r: -r["amount"])

    # debt
    loans = tables()["loans"]
    loans = loans[loans["property_id"].isin(ids)].merge(props[["id", "name", "sector", "value", "noi_t12"]],
                                                         left_on="property_id", right_on="id")
    loans["maturity_year"] = pd.to_datetime(loans["maturity_date"]).dt.year
    ladder_years = list(range(FY, FY + 7))
    ladder = [dict(year=y, balance=float(loans[loans.maturity_year == y]["balance"].sum()),
                   loans=list(loans[loans.maturity_year == y]["name"])) for y in ladder_years]
    loans["ltv"] = loans["balance"] / loans["value"]
    loans["dscr"] = loans["noi_t12"] / loans["annual_debt_service"]
    loan_rows = loans[["property_id", "name", "sector", "lender_type", "balance", "rate", "amort_years",
                       "maturity_date", "ltv", "dscr", "annual_debt_service"]].sort_values("maturity_date")

    # FFO / AFFO (T12)
    noi_t12 = _noi(led, T12)
    share = noi_t12 / _noi(_ledger(list(tables()["properties"]["id"])), T12)
    ga = config.REIT_GA_ANNUAL * share
    interest = _sum(led, ["7000"], T12)
    ffo = noi_t12 - ga - interest
    com_rent = float(led[led["account_code"].eq("4000") & led["period"].isin(T12) &
                         led["property_id"].isin(props[props["sector"].isin(COMMERCIAL)]["id"])]["amount"].sum())
    straight_line = com_rent * 0.015
    capex_bi = _sum(led, ["8100"], T12)
    capex_lc = _sum(led, ["8000"], T12)
    affo = ffo - capex_bi - capex_lc - straight_line
    ffo_bridge = [
        dict(label="NOI", value=noi_t12, kind="absolute"),
        dict(label="Corporate G&A", value=-ga, kind="relative"),
        dict(label="Interest expense", value=-interest, kind="relative"),
        dict(label="FFO", value=ffo, kind="total"),
        dict(label="Building improvements", value=-capex_bi, kind="relative"),
        dict(label="Leasing costs", value=-capex_lc, kind="relative"),
        dict(label="Straight-line rent", value=-straight_line, kind="relative"),
        dict(label="AFFO", value=affo, kind="total"),
    ]

    # receivables
    ar = tables()["ar_aging"]
    ar = ar[ar["property_id"].isin(ids)].merge(props[["id", "name", "sector"]], left_on="property_id", right_on="id")
    buckets = ["current", "d31_60", "d61_90", "d90_plus"]
    ar["total"] = ar[buckets].sum(axis=1)
    revenue_t12 = _sum(led, REVENUE, T12)
    ar_by_prop = ar.groupby(["property_id", "name"])[buckets + ["total"]].sum().reset_index().sort_values(
        "total", ascending=False)
    receivables = dict(
        totals={b: float(ar[b].sum()) for b in buckets}, total=float(ar["total"].sum()),
        dso=float(ar["total"].sum()) / (revenue_t12 / 365) if revenue_t12 else None,
        by_property=ar_by_prop.to_dict("records"),
        top=ar.sort_values(["d90_plus", "total"], ascending=False).head(8)[
            ["tenant", "name", "current", "d31_60", "d61_90", "d90_plus", "total"]].to_dict("records"),
    )

    cash = dict(noi=noi_t12, capex=capex_bi + capex_lc, debt_service=_sum(led, ["7000", "7100"], T12))
    cash["after_debt"] = cash["noi"] - cash["capex"] - cash["debt_service"]

    return dict(period=dict(ytd_through=str(AS_OF), fy=FY, t12_end=T12[-1]),
                statement=statement, bridge=bridge, monthly=monthly, opex_mix=opex_mix,
                debt=dict(kpis=_debt_kpis(props), ladder=ladder, loans=loan_rows.to_dict("records")),
                ffo=dict(steps=ffo_bridge, ga_note=f"G&A of {config.REIT_GA_ANNUAL / 1e6:.1f}M allocated by NOI share"),
                receivables=receivables, cash=cash)


@lru_cache(maxsize=1)
def _market_intel(_mtime: float) -> dict:
    return json.loads(config.MARKET_INTEL_PATH.read_text(encoding="utf-8"))


def market_intel() -> dict:
    return _market_intel(config.MARKET_INTEL_PATH.stat().st_mtime)


def valuation(payload: dict) -> dict:
    allowed = finance.DealInputs.__dataclass_fields__.keys()
    clean = {k: (float(v) if v is not None else None) for k, v in payload.items() if k in allowed}
    if "hold_years" in clean:
        clean["hold_years"] = int(max(1, min(20, clean["hold_years"])))
    inp = finance.DealInputs(**clean)
    res = finance.run_dcf(inp)
    caps = [round(inp.exit_cap + d / 10000, 4) for d in range(-100, 101, 25)]
    growth = [round(inp.noi_growth + d / 1000, 4) for d in range(-20, 21, 5)]
    grid = finance.sensitivity(inp, caps, growth)
    return dict(inputs=inp.__dict__, result={k: v for k, v in res.__dict__.items() if k != "years"},
                years=res.years, sensitivity=dict(exit_caps=caps, growth=growth, levered_irr=grid))
