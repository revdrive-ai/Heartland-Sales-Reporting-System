#!/usr/bin/env python3
"""Price list — dated list prices per Heartland item.

Source: data/raw/Price_List.xlsx (Item, Brand, Category, Form, Segment, FG#,
UPC, Units per Case, Case Price, Unit Price). The workbook carries no date, so
every ingest stamps its rows with an --effective date (default 2026-01-01 for
the initial list, per the planning decision). Re-running with a new workbook
and a new --effective date APPENDS a dated version for every item whose price
changed (unchanged prices are skipped), building the dated history the
price-change analysis reads.

Output: lib/fixtures/price-list.json
  { "rows": [{ fg, upc_core, item, brand, category, form, segment,
               units_per_case, case_price, unit_price,
               effective_from, source }] }

Usage: python3 scripts/ingest_price_list.py [--effective 2026-01-01]
"""
import argparse
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/raw/Price_List.xlsx"
OUT = ROOT / "lib/fixtures/price-list.json"


def clean(v) -> str:
    return "" if v is None or pd.isna(v) else str(v).strip()


def core(upc: str) -> str:
    """digits only, trailing check digit dropped, leading zeros stripped —
    the same normalization the item crosswalk uses for Heartland UPCs."""
    d = re.sub(r"\D", "", clean(upc))
    return (d[:-1] if len(d) > 1 else d).lstrip("0")


def num(v):
    s = clean(v)
    if not s:
        return None
    try:
        return round(float(s), 4)
    except ValueError:
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--effective", default="2026-01-01", help="effective_from date for this ingest (YYYY-MM-DD)")
    args = ap.parse_args()

    prior = json.loads(OUT.read_text())["rows"] if OUT.exists() else []
    # latest prior price per fg, to append only actual changes on re-ingest
    latest: dict[str, tuple] = {}
    for r in sorted(prior, key=lambda r: r["effective_from"]):
        latest[r["fg"]] = (r["unit_price"], r["case_price"], r["units_per_case"])

    df = pd.ExcelFile(SRC).parse("Sheet1", dtype=str)
    added, unchanged, unpriced = 0, 0, 0
    rows = list(prior)
    for r in df.itertuples(index=False):
        fg = clean(r[5])
        if not fg:
            continue
        unit_price = num(r[9])
        case_price = num(r[8])
        upc = clean(r[6])
        if unit_price is None and case_price is None:
            unpriced += 1  # TBD rows ride along without a price record
        row = {
            "fg": fg,
            "upc_core": core(upc) if upc and not upc.upper().startswith("TBD") else "",
            "item": clean(r[0]),
            "brand": clean(r[1]),
            "category": clean(r[2]),
            "form": clean(r[3]),
            "segment": clean(r[4]),
            "units_per_case": num(r[7]),
            "case_price": case_price,
            "unit_price": unit_price,
            "effective_from": args.effective,
            "source": SRC.name,
        }
        if latest.get(fg) == (row["unit_price"], row["case_price"], row["units_per_case"]):
            unchanged += 1
            continue
        rows.append(row)
        added += 1

    rows.sort(key=lambda r: (r["fg"], r["effective_from"]))
    OUT.write_text(json.dumps({"rows": rows}, indent=1) + "\n")
    print(f"effective {args.effective}: {added} price records added, {unchanged} unchanged (skipped), "
          f"{unpriced} rows without a price (TBD) · fixture now {len(rows)} dated records")


if __name__ == "__main__":
    main()
