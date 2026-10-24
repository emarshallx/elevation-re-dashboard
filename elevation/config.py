"""Project-wide settings.

Everything you are likely to tweak lives here. After changing anything in the
"Sample portfolio" block, delete ``elevation/data/elevation.db`` (or run
``python -m elevation.seed --force``) so the database is rebuilt.
"""
from datetime import date
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "elevation.db"
MARKET_INTEL_PATH = DATA_DIR / "market_intel.json"

# --- Server -----------------------------------------------------------------
HOST = "127.0.0.1"
PORT = 8050
OPEN_BROWSER = True          # run.py opens your default browser on start

# --- Reporting --------------------------------------------------------------
REPORTING_CURRENCY = "USD"
# Canadian assets are generated in CAD and translated at this fixed rate.
# It is an assumption for the sample data, not a live quote.
CAD_TO_USD = 0.73

# Last closed month in the sample ledger, and the fiscal year being budgeted.
AS_OF = date(2026, 9, 30)
FISCAL_YEAR = 2026
HISTORY_MONTHS = 36          # Oct 2023 .. Sep 2026

# --- Sample portfolio -------------------------------------------------------
RANDOM_SEED = 2026
REIT_GA_ANNUAL = 6_500_000   # corporate G&A used in the FFO bridge (USD)
