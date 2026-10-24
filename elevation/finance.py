"""Real estate finance helpers: time value of money, debt, and a simple DCF.

Plain Python (no pandas) so each function is easy to read, test and reuse.
Rates are decimals (0.065 = 6.5%). Cash flows are listed from period 0.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence


# ---------------------------------------------------------------------------
# Time value of money
# ---------------------------------------------------------------------------
def npv(rate: float, cashflows: Sequence[float]) -> float:
    """Net present value; ``cashflows[0]`` happens today (undiscounted)."""
    return sum(cf / (1 + rate) ** t for t, cf in enumerate(cashflows))


def irr(cashflows: Sequence[float], lo: float = -0.99, hi: float = 10.0, tol: float = 1e-10) -> float | None:
    """Internal rate of return by bisection. Returns None when no sign change exists."""
    f_lo, f_hi = npv(lo, cashflows), npv(hi, cashflows)
    if f_lo * f_hi > 0:
        return None
    for _ in range(300):
        mid = (lo + hi) / 2
        f_mid = npv(mid, cashflows)
        if abs(f_mid) < tol:
            return mid
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


def payment(annual_rate: float, amort_years: float, principal: float, periods_per_year: int = 12) -> float:
    """Level payment per period for a fully amortising loan (0 amortisation = interest only)."""
    r = annual_rate / periods_per_year
    if amort_years <= 0:
        return principal * r
    n = amort_years * periods_per_year
    if r == 0:
        return principal / n
    return principal * r / (1 - (1 + r) ** -n)


def loan_balance(principal: float, annual_rate: float, amort_years: float, months_elapsed: int) -> float:
    """Outstanding balance after ``months_elapsed`` monthly payments."""
    if amort_years <= 0:
        return principal
    r = annual_rate / 12
    pmt = payment(annual_rate, amort_years, principal)
    if r == 0:
        return max(principal - pmt * months_elapsed, 0.0)
    return principal * (1 + r) ** months_elapsed - pmt * ((1 + r) ** months_elapsed - 1) / r


def annual_debt_service(principal: float, annual_rate: float, amort_years: float) -> float:
    return payment(annual_rate, amort_years, principal) * 12


# ---------------------------------------------------------------------------
# Ratios
# ---------------------------------------------------------------------------
def direct_cap_value(noi: float, cap_rate: float) -> float:
    return noi / cap_rate


def dscr(noi: float, debt_service: float) -> float | None:
    return noi / debt_service if debt_service else None


def ltv(loan: float, value: float) -> float | None:
    return loan / value if value else None


def debt_yield(noi: float, loan: float) -> float | None:
    return noi / loan if loan else None


def walt(leases: Iterable[tuple[float, float]]) -> float:
    """Weighted average lease term. ``leases`` yields (weight, years_remaining)."""
    leases = list(leases)
    total = sum(w for w, _ in leases)
    return sum(w * max(y, 0) for w, y in leases) / total if total else 0.0


# ---------------------------------------------------------------------------
# Discounted cash flow
# ---------------------------------------------------------------------------
@dataclass
class DealInputs:
    noi_year1: float = 5_000_000
    noi_growth: float = 0.025
    purchase_price: float | None = None      # if None, derived from going_in_cap
    going_in_cap: float = 0.0600
    exit_cap: float = 0.0650
    hold_years: int = 10
    discount_rate: float = 0.0800
    capex_pct_noi: float = 0.06               # reserves / recurring capex as % of NOI
    acquisition_costs_pct: float = 0.015
    selling_costs_pct: float = 0.020
    ltv: float = 0.55
    interest_rate: float = 0.0575
    amort_years: float = 30                    # 0 = interest only
    hurdle_irr: float = 0.10

    def price(self) -> float:
        return self.purchase_price if self.purchase_price else self.noi_year1 / self.going_in_cap


@dataclass
class DealResult:
    price: float
    loan: float
    equity: float
    direct_cap_value: float
    dcf_value: float
    unlevered_irr: float | None
    levered_irr: float | None
    equity_multiple: float
    cash_on_cash_y1: float
    dscr_y1: float | None
    debt_yield_y1: float | None
    sale_price: float
    years: list[dict] = field(default_factory=list)


def run_dcf(inp: DealInputs) -> DealResult:
    price = inp.price()
    total_cost = price * (1 + inp.acquisition_costs_pct)
    loan = price * inp.ltv
    equity = total_cost - loan
    ads = annual_debt_service(loan, inp.interest_rate, inp.amort_years) if loan else 0.0

    years, unlev, lev = [], [-total_cost], [-equity]
    for y in range(1, inp.hold_years + 1):
        noi_y = inp.noi_year1 * (1 + inp.noi_growth) ** (y - 1)
        capex = noi_y * inp.capex_pct_noi
        cf = noi_y - capex
        sale = net_sale = balance = 0.0
        if y == inp.hold_years:
            forward_noi = noi_y * (1 + inp.noi_growth)
            sale = forward_noi / inp.exit_cap
            net_sale = sale * (1 - inp.selling_costs_pct)
            balance = loan_balance(loan, inp.interest_rate, inp.amort_years, 12 * y) if loan else 0.0
        unlev.append(cf + net_sale)
        lev.append(cf - ads + net_sale - balance)
        years.append(dict(year=y, noi=noi_y, capex=capex, cash_flow=cf, debt_service=ads,
                          levered_cf=cf - ads, sale_proceeds=net_sale, loan_payoff=balance))

    dcf_value = npv(inp.discount_rate, [0.0] + unlev[1:])
    inflows = sum(lev[1:])
    sale_price = years[-1]["sale_proceeds"] / (1 - inp.selling_costs_pct) if years else 0.0
    return DealResult(
        price=price, loan=loan, equity=equity,
        direct_cap_value=direct_cap_value(inp.noi_year1, inp.going_in_cap),
        dcf_value=dcf_value,
        unlevered_irr=irr(unlev), levered_irr=irr(lev),
        equity_multiple=inflows / equity if equity else 0.0,
        cash_on_cash_y1=years[0]["levered_cf"] / equity if equity else 0.0,
        dscr_y1=dscr(inp.noi_year1, ads), debt_yield_y1=debt_yield(inp.noi_year1, loan),
        sale_price=sale_price, years=years,
    )


def sensitivity(inp: DealInputs, exit_caps: Sequence[float], growths: Sequence[float]) -> list[list[float | None]]:
    """Levered IRR grid: one row per exit cap, one column per NOI growth rate."""
    grid = []
    for ec in exit_caps:
        row = []
        for g in growths:
            trial = DealInputs(**{**inp.__dict__, "exit_cap": ec, "noi_growth": g})
            row.append(run_dcf(trial).levered_irr)
        grid.append(row)
    return grid
