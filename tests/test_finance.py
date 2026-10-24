"""Checks for the finance helpers and the data the dashboard serves.

Run with the "Tests" run configuration, or: python -m unittest discover tests
"""
import unittest

from elevation import create_app, finance, services


class TimeValueOfMoney(unittest.TestCase):
    def test_npv_matches_hand_calculation(self):
        self.assertAlmostEqual(finance.npv(0.10, [-100, 110]), 0.0, places=9)
        self.assertAlmostEqual(finance.npv(0.08, [0, 100, 100]), 100 / 1.08 + 100 / 1.08 ** 2, places=9)

    def test_irr_recovers_known_rate(self):
        self.assertAlmostEqual(finance.irr([-1000, 100, 100, 1100]), 0.10, places=6)
        self.assertIsNone(finance.irr([100, 100]))  # no sign change, no IRR

    def test_mortgage_payment(self):
        # $1M, 6%, 25-year amortization: about $6,443 a month
        self.assertAlmostEqual(finance.payment(0.06, 25, 1_000_000), 6443.01, places=1)
        self.assertEqual(finance.payment(0.05, 0, 1_000_000), 1_000_000 * 0.05 / 12)  # interest only

    def test_balance_amortises_to_zero(self):
        self.assertAlmostEqual(finance.loan_balance(500_000, 0.05, 30, 360), 0.0, places=4)
        self.assertEqual(finance.loan_balance(500_000, 0.05, 0, 120), 500_000)

    def test_walt_weights_by_rent(self):
        self.assertAlmostEqual(finance.walt([(100, 2), (300, 6)]), 5.0)


class DiscountedCashFlow(unittest.TestCase):
    def test_no_growth_same_caps_gives_cap_rate_unlevered(self):
        inp = finance.DealInputs(noi_year1=1_000_000, noi_growth=0.0, going_in_cap=0.06, exit_cap=0.06,
                                 capex_pct_noi=0, acquisition_costs_pct=0, selling_costs_pct=0, ltv=0)
        res = finance.run_dcf(inp)
        self.assertAlmostEqual(res.unlevered_irr, 0.06, places=6)
        self.assertAlmostEqual(res.levered_irr, 0.06, places=6)

    def test_positive_leverage_lifts_irr(self):
        base = dict(noi_year1=1_000_000, noi_growth=0.02, going_in_cap=0.065, exit_cap=0.065)
        unlev = finance.run_dcf(finance.DealInputs(**base, ltv=0)).levered_irr
        lev = finance.run_dcf(finance.DealInputs(**base, ltv=0.6, interest_rate=0.045, amort_years=0)).levered_irr
        self.assertGreater(lev, unlev)

    def test_sensitivity_shape(self):
        grid = finance.sensitivity(finance.DealInputs(), [0.06, 0.065, 0.07], [0.01, 0.02])
        self.assertEqual((len(grid), len(grid[0])), (3, 2))
        self.assertGreater(grid[0][0], grid[2][0])  # lower exit cap, higher IRR


class DashboardData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = create_app().test_client()   # builds the sample database if missing

    def test_endpoints_respond(self):
        for url in ["/api/meta", "/api/portfolio", "/api/portfolio?region=Canada&sector=Office",
                    "/api/property/P01", "/api/property/P10", "/api/financials", "/api/markets"]:
            self.assertEqual(self.client.get(url).status_code, 200, url)
        self.assertEqual(self.client.get("/api/property/NOPE").status_code, 404)

    def test_statement_adds_up(self):
        fin = services.financials()
        rows = {r["key"]: r for r in fin["statement"]}
        self.assertAlmostEqual(rows["NOI"]["actual"], rows["REV"]["actual"] - rows["OPEX"]["actual"], places=2)
        bridge = fin["bridge"]
        self.assertAlmostEqual(bridge["start"] + sum(s["delta"] for s in bridge["steps"]), bridge["end"], places=2)

    def test_rent_rolls_reconcile_to_ledger(self):
        for pid in ["P01", "P03", "P05", "P08"]:
            chk = services.property_detail(pid)["rent_roll_check"]
            self.assertAlmostEqual(chk["rent_roll_annual"], chk["gl_annualized"], delta=1.0, msg=pid)

    def test_valuation_endpoint(self):
        res = self.client.post("/api/valuation", json={"noi_year1": 2_000_000, "hold_years": 7}).get_json()
        self.assertEqual(len(res["years"]), 7)
        self.assertEqual(len(res["sensitivity"]["levered_irr"]), 9)


if __name__ == "__main__":
    unittest.main()
