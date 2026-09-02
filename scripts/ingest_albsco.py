#!/usr/bin/env python3
"""Ingest the ALBSCO NIQ data pull (data/raw/*.xlsx) into the app's data files.

Reads the `source` sheet (the raw NIQ export with the full taxonomy) and emits:

  lib/fixtures/markets.json          the 13 division TAs, active where data exists
  lib/fixtures/items.json            item master (100 items, both manufacturers)
  data/nielsen/<MARKET_CODE>.json.gz weekly facts per market, contract-shaped

Facts are gzipped compact JSON read server-side by lib/repo/. Field names are
the nielsen_weekly column names from supabase/migrations/, so these files are
also the future Supabase load source (staging -> validate -> promote).

Run:  python3 scripts/ingest_albsco.py
Deps: pandas, openpyxl
"""
import gzip
import json
import pathlib
import re
import sys
from datetime import datetime

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "ALBSCO_Data_Pull__HFPG_2.xlsx"
FIXTURES = ROOT / "lib" / "fixtures"
FACTS_DIR = ROOT / "data" / "nielsen"

# TA name -> (market_code, display name). Codes follow the mockup's samples
# (ALB-JEWEL, ALB-VONS); the rest extend the same convention.
MARKETS = {
    "ALBSCO Acme TA":              ("ALB-ACME",      "Albertsons Acme"),
    "ALBSCO Denver Div TA":        ("ALB-DENVER",    "Albertsons Denver"),
    "ALBSCO Eastern TA":           ("ALB-EASTERN",   "Albertsons Eastern"),
    "ALBSCO Intermountain Div TA": ("ALB-INTMTN",    "Albertsons Intermountain"),
    "ALBSCO Jewel Div TA":         ("ALB-JEWEL",     "Albertsons Jewel-Osco"),
    "ALBSCO Nor Cal Div TA":       ("ALB-NORCAL",    "Albertsons Nor Cal"),
    "ALBSCO Portland Div TA":      ("ALB-PORTLAND",  "Albertsons Portland"),
    "ALBSCO Seattle Div TA":       ("ALB-SEATTLE",   "Albertsons Seattle"),
    "ALBSCO Shaws Div TA":         ("ALB-SHAWS",     "Albertsons Shaws"),
    "ALBSCO So Cal TA":            ("ALB-VONS",      "Albertsons Vons SoCal"),
    "ALBSCO So Cal Div TA":        ("ALB-VONS",      "Albertsons Vons SoCal"),
    "ALBSCO Southern Div TA":      ("ALB-SOUTHERN",  "Albertsons Southern"),
    "ALBSCO Southwest Div TA":     ("ALB-SOUTHWEST", "Albertsons Southwest"),
    "ALBSCO United Div TA":        ("ALB-UNITED",    "Albertsons United"),
}

OWN_MANUFACTURER = "HEARTLAND FOOD PRODUCTS GROUP"

def week_to_iso(period: str) -> str:
    """'1 w/e 07/29/23' -> '2023-07-29' (must be a Saturday)."""
    m = re.search(r"w/e\s+(\d{2})/(\d{2})/(\d{2})$", period.strip())
    if not m:
        raise ValueError(f"unparseable period: {period!r}")
    mo, dy, yr = m.groups()
    d = datetime(2000 + int(yr), int(mo), int(dy))
    if d.isoweekday() != 6:
        raise ValueError(f"week_ending {d.date()} is not a Saturday ({period!r})")
    return d.strftime("%Y-%m-%d")

def num(v):
    """NIQ numbers arrive as strings; blanks/None stay null."""
    if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "":
        return None
    return round(float(v), 4)

def main() -> None:
    df = pd.read_excel(RAW, sheet_name="source", dtype=str)
    print(f"read {len(df)} rows from {RAW.name}")

    # ---- item master --------------------------------------------------------
    items = (
        df[["UPC", "ITEM", "MANUFACTURER", "BRAND SHORT", "SUPER CATEGORY", "CATEGORY", "SUB CATEGORY"]]
        .drop_duplicates(subset=["UPC"])
        .sort_values(["BRAND SHORT", "ITEM"])
    )
    item_rows = [
        {
            "upc": r.UPC,
            "name": r.ITEM.strip(),
            "brand": r._4,           # BRAND SHORT
            "manufacturer": r.MANUFACTURER,
            "super_category": r._5,  # SUPER CATEGORY
            "category": r.CATEGORY,
            "sub_category": r._7,    # SUB CATEGORY
            "is_own": r.MANUFACTURER == OWN_MANUFACTURER,
        }
        for r in items.itertuples()
    ]
    FIXTURES.mkdir(parents=True, exist_ok=True)
    (FIXTURES / "items.json").write_text(json.dumps(item_rows, indent=1) + "\n")
    print(f"items.json: {len(item_rows)} items "
          f"({sum(1 for i in item_rows if i['is_own'])} own / "
          f"{sum(1 for i in item_rows if not i['is_own'])} competitive)")

    # ---- markets ------------------------------------------------------------
    present = set(df["Markets"].unique())
    unknown = present - set(MARKETS)
    if unknown:
        raise SystemExit(f"unmapped market TA names: {unknown}")
    market_rows = []
    seen = set()
    for ta, (code, name) in MARKETS.items():
        if code in seen or ta not in present:
            continue
        seen.add(code)
        market_rows.append({"code": code, "name": name, "ta_name": ta, "active": True})
    market_rows.sort(key=lambda m: m["code"])
    (FIXTURES / "markets.json").write_text(json.dumps(market_rows, indent=1) + "\n")
    print(f"markets.json: {len(market_rows)} markets, all with data on file")

    # ---- weekly facts per market -------------------------------------------
    FACTS_DIR.mkdir(parents=True, exist_ok=True)
    df["week_ending"] = df["Periods"].map(week_to_iso)
    total = 0
    for ta, g in df.groupby("Markets"):
        code, name = MARKETS[ta]
        rows = []
        for r in g.itertuples():
            rows.append({
                "week_ending": r.week_ending,
                "upc": r.UPC,
                "market_code": code,
                "market_name": name,
                "units": num(r.Units),
                "dollars": num(r._11),                 # $
                "base_units": num(r._12),              # Base Units
                "base_dollars": num(r._13),            # Base $
                "price_per_unit": num(r._14),          # Avg Unit Price
                "eq_units": num(r.EQ),
                "base_price_per_unit": num(r._16),     # Base Unit Price
                "incr_units": num(r._17),              # Incr Units
                "incr_dollars": num(r._18),            # Incr $
                "acv_dist": num(r._19),                # %ACV Reach
                "tdp": num(r.TDP),
                "acv_any_promo": num(r._21),           # Any Promo %ACV
                "acv_feature": num(r._22),             # Feat w/o Disp
                "acv_display": num(r._23),             # Disp w/o Feat
                "acv_feat_disp": num(r._24),           # Feat & Disp
                "acv_tpr": num(r._25),                 # Price Decr Only
                "promo_units": num(r._26),             # Any Promo Units
                "nonpromo_units": num(r._27),          # No Promo Units
                "brand": r._4,                         # BRAND SHORT
                "category": r.CATEGORY,
            })
        rows.sort(key=lambda x: (x["week_ending"], x["upc"]))
        out = FACTS_DIR / f"{code}.json.gz"
        with gzip.open(out, "wt", encoding="utf-8") as f:
            json.dump(rows, f, separators=(",", ":"))
        total += len(rows)
        wks = {x["week_ending"] for x in rows}
        print(f"{out.name}: {len(rows)} rows, {len(wks)} weeks "
              f"({min(wks)} → {max(wks)}), {out.stat().st_size // 1024}K")
    print(f"total fact rows: {total}")

if __name__ == "__main__":
    sys.exit(main())
