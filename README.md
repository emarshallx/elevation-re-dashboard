# Elevation

A real estate dashboard for asset management, property financials, and North American and European market intelligence. The back end is Python (Flask, pandas, SQLite) and the charts are Plotly.js. Everything runs locally, and the app needs no internet connection once its packages are installed.

| Page | What's on it |
|---|---|
| **Portfolio** | An animated skyline where each building's height is its value and the lit windows are its occupancy. Also KPIs, NOI against budget, a watchlist, value by sector, the lease expiry schedule, occupancy by sector and a map. |
| **Assets** | A table you can sort, then for each property: NOI and occupancy against budget, the rent roll (reconciled to the GL) or the unit mix, year to date against budget, receivables aging, debt and appraisal history. |
| **Financials** | Operating statement (actual, budget, prior year and forecast), NOI bridge, NOI to FFO to AFFO, monthly NOI against budget, debt maturity ladder, receivables aging, DSO and a loan schedule. |
| **Markets** | A globe of house-price changes across North America and Europe, policy rates (Fed, BoC, ECB, BoE), the EU house price index, residential prices, commercial vacancy, cap rates and prime yields. |
| **Trends & tools** | Six market shifts and what they mean, plus the proptech platforms to know (Yardi Virtuoso, MRI Agora, VTS, EliseAI and others). |
| **Valuation lab** | Direct cap and a 10-year DCF with levered and unlevered IRR, equity multiple, DSCR and an IRR sensitivity grid. Everything recalculates in Python as you move the sliders. |

Every chart has a **Show table** button. Filters for region (US or Canada) and sector apply across the Portfolio, Assets and Financials pages. You can switch between the *Blueprint* (dark) and *Vellum* (light) themes at the bottom of the sidebar. If your system has *reduce motion* turned on, the animations are switched off.

---

## Open it in PyCharm

1. **File → Open…** and choose the `elevation-re-dashboard` folder.
2. Set up an interpreter: **Settings → Project → Python Interpreter → Add Interpreter → Virtualenv** (Python 3.10 or newer).
3. PyCharm offers to install `requirements.txt`. Accept, or run `pip install -r requirements.txt` in the PyCharm terminal.
4. Pick the **Elevation** run configuration (top right) and press ▶. Your browser opens at <http://127.0.0.1:8050>.

On the first run, the app builds the sample database at `elevation/data/elevation.db`, which takes about a second. Two more run configurations are included: **Rebuild sample data** and **Tests**.

From a terminal instead:

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

## How it fits together

```
elevation/
  config.py        settings: port, as-of date, CAD→USD rate, seed
  seed.py          generates the sample portfolio into SQLite (ledger, leases, loans …)
  finance.py       NPV, IRR, loan maths, WALT, DCF and sensitivity (plain Python)
  services.py      SQL + pandas queries that shape each page's data
  api.py           JSON endpoints: /api/portfolio, /api/property/<id>, /api/financials,
                   /api/markets, /api/valuation
  data/
    market_intel.json   compiled market figures, each with its source and date
  templates/index.html  app shell
  static/
    css/app.css    design tokens (both themes), layout
    js/            vanilla ES modules: main.js (routing, filters), skyline.js,
                   lib/ (formatting, theme, charts), pages/ (one file per page)
    vendor/        plotly.js 2.35.2 and map files, served locally
    fonts/         Archivo (SIL Open Font License)
sql/examples.sql   practice queries against the database
tests/             unittest checks (finance maths, statement ties, rent roll reconciliation)
run.py             start the server and open the browser
```

The flow is: Python generates or loads the ledger into SQLite. `services.py` queries it with SQL and pandas. Flask serves the results as JSON, and the browser draws them with Plotly.

## About the data

**The portfolio is fictional.** There are 13 invented properties in real cities (Chicago, Toronto, Calgary, Columbus, Brampton, Plano, Mississauga, Montréal, Austin and Denver). They come with 36 months of GL history, a 2026 budget, rent rolls, receivables, loans and appraisals. The generator is seeded, so it produces the same data every time. Canadian assets are translated at a fixed CAD/USD rate of 0.73, which you can change in `config.py` before running **Rebuild sample data**. The data includes some realistic stories to explore: a Chicago office loan maturing in June 2027 at 74% LTV, a Calgary tenant default, a heavy 2026 snow season, and apartments in Austin and Denver with high LTVs.

**Market figures are real published data**, compiled 24 October 2026. Each figure sits in `elevation/data/market_intel.json` with its period and a link to its source (NAR, CREA, TRREB, HM Land Registry, Eurostat, the four central banks, CBRE, Cushman & Wakefield, Colliers, Savills, BNP Paribas Real Estate and others). To refresh the Markets and Trends pages, edit that file. The app reloads it automatically.

## Plugging in your own numbers

The `ledger` table is a plain monthly GL: `property_id, period (YYYY-MM), scenario (actual|budget), account_code, account_name, category (revenue|opex|debt|capex), amount`. To use real data, export a GL detail or trial balance by property and month from Yardi or JDE. Map your account codes to the categories, then write the result into the same table, for example with `pandas.DataFrame.to_sql`. The `leases`, `loans` and `ar_aging` tables follow the same idea. `seed.py` shows the exact columns.

## Credits

Charts: [plotly.js](https://github.com/plotly/plotly.js) (MIT). Typeface: [Archivo](https://github.com/Omnibus-Type/Archivo) by Omnibus-Type (SIL OFL 1.1).
