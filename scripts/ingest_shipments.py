#!/usr/bin/env python3
"""Retail Planner shipments — weekly sell-in by account × item.

Source: data/raw/Retail_Planner_-_Publix_Jewel.xlsx, one sheet per account.
Each sheet is a matrix: a "Product" row per item carrying the year's Actual
by week, followed by a "Last Year" row for the same item; the header row
holds the weeks as week-COMMENCING Sundays (the first column, Jan 1, is the
year's opening stub). Items are Heartland FG/SP codes with a description, not
UPCs.

What this does with it:

  · weeks become NIQ-style week-ENDING Saturdays (Sunday + 6; the Jan 1 stub
    → the first Saturday), so shipments line up with the consumption facts
  · every row is ONE account × item × real week: the Actual row lands on
    the workbook year's week, the Last Year row on that week minus 364 days
    (the same NIQ week a year earlier — the offset the app uses for every
    year-ago read). So a 2026 workbook yields 2025 and 2026 shipments, and
    the app reads "last year" by date, not from a flag.
  · the workbook's 53rd column (week ending in the next January) is the
    one place the two rows meet: its Last Year figure lands on the week the
    Actual row already covers as the opening stub. The Actual row is the
    authority for every week the workbook year covers, so that figure is
    dropped and the drop counted in meta.json (overlap_dropped)
  · only weeks with shipments are written (a sparse table); an item that
    shipped nothing all year still shows in meta.json's item counts
  · item codes are resolved to a NIQ UPC where the item crosswalk (Telus item
    number or SP Code) or the price list (FG#) knows them AND the UPC is in
    the NIQ pull; the rest carry upc = null and are listed in meta.json so the
    crosswalk can be extended
  · the sheet name maps to an account code: Jewel is the Albertsons division
    already on file, Publix is a new shipments-only account

Output: data/shipments/<ACCOUNT>.json.gz (rows) and data/shipments/meta.json
  row: { account_code, account_name, item_code, item_name, upc, brand,
         week_ending, units, source_row, source_file }
  source_row says which workbook row the figure came from ("actual" or
  "last_year") — provenance only; the week_ending is the real week.

Usage: python3 scripts/ingest_shipments.py
"""
import gzip
import json
import re
from datetime import date, timedelta
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/raw/Retail_Planner_-_Publix_Jewel.xlsx"
OUT = ROOT / "data/shipments"
FIXTURES = ROOT / "lib/fixtures"

# sheet → account. Jewel is the ALBSCO division on file; Publix is new.
ACCOUNTS = {
    "Jewel": ("ALB-JEWEL", "Albertsons Jewel-Osco"),
    "Publix": ("PUBLIX", "Publix"),
}

# how a description names the brand — the words the workbook uses
BRAND_WORDS = [
    (re.compile(r"\bSPLENDA\b", re.I), "SPLENDA"),
    (re.compile(r"\bSLIM ?FAST\b", re.I), "SLIMFAST"),
    (re.compile(r"\bJAVA HOUSE\b", re.I), "JAVA HOUSE"),
    (re.compile(r"\bEQUAL\b", re.I), "EQUAL"),
    (re.compile(r"\bSAF\b|\bSweet ?Additions\b", re.I), "SAF"),
    (re.compile(r"\bKETO", re.I), "KETO:SWEET"),
]


def brand_of(name: str) -> str:
    for rx, b in BRAND_WORDS:
        if rx.search(name):
            return b
    return "OTHER"


def week_ending(d: date, year: int) -> str:
    """The Saturday that ends the NIQ week this week-commencing date falls in."""
    if d.month == 1 and d.day == 1:
        # the year's opening stub runs to the first Saturday
        first_sat = d + timedelta(days=(5 - d.weekday()) % 7)
        return first_sat.isoformat()
    return (d + timedelta(days=6)).isoformat()


def load_maps():
    """item code → NIQ upc, via the Telus item number (crosswalk) or FG# (price list)."""
    items = json.loads((FIXTURES / "items.json").read_text())
    core_to_upc = {re.sub(r"\D", "", i["upc"]).lstrip("0"): i["upc"] for i in items}
    by_code = {}
    xw = json.loads((FIXTURES / "item-crosswalk.json").read_text())
    for t in xw["telus_items"]:
        upc = core_to_upc.get(t["upc_core"])
        if upc:
            by_code.setdefault(t["item_number"], upc)
    pl = json.loads((FIXTURES / "price-list.json").read_text())
    for r in pl["rows"]:
        upc = core_to_upc.get(r["upc_core"])
        if upc:
            by_code.setdefault(r["fg"], upc)
    # the raw crosswalk workbook also carries the SP Code the Publix sheet
    # uses (the fixture keeps only the Telus item number)
    raw = ROOT / "data/raw/Crosswalk_items_V1.xlsx"
    if raw.exists():
        ws = openpyxl.load_workbook(raw, read_only=True, data_only=True)["Heartland Foods"]
        for r in ws.iter_rows(min_row=2, values_only=True):
            upc_raw, sp, item_no = r[0], r[1], r[5]
            if not upc_raw:
                continue
            d = re.sub(r"\D", "", str(upc_raw))
            upc = core_to_upc.get((d[:-1] if len(d) > 1 else d).lstrip("0")) or core_to_upc.get(d.lstrip("0"))
            if not upc:
                continue
            for k in (sp, item_no):
                if k:
                    by_code.setdefault(str(k).strip(), upc)
    # a code with no row of its own ties by its digits when they name exactly
    # one known code — Telus/the planner write "FGMA20015446" where the
    # crosswalk has "20015446"
    by_digits = {}
    for k in list(by_code):
        by_digits.setdefault(re.sub(r"\D", "", k), set()).add(k)
    return by_code, by_digits


def main() -> None:
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    code_to_upc, by_digits = load_maps()

    def upc_for(code: str):
        if code in code_to_upc:
            return code_to_upc[code]
        hits = by_digits.get(re.sub(r"\D", "", code), set())
        return code_to_upc[next(iter(hits))] if len(hits) == 1 else None
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"source_file": SRC.name, "accounts": []}
    unmatched = {}

    for ws in wb.worksheets:
        if ws.title not in ACCOUNTS:
            print(f"skipping sheet {ws.title!r}: no account mapping")
            continue
        code, name = ACCOUNTS[ws.title]
        rows = list(ws.iter_rows(values_only=True))
        hdr = rows[0]
        off = 1 if hdr[0] is None else 0          # the Jewel sheet has a blank lead column
        weeks_raw = [c for c in hdr[off + 3:] if c is not None]
        year = weeks_raw[0].year
        weeks = [week_ending(c.date(), year) for c in weeks_raw]

        actual_weeks = set(weeks)                 # the weeks the Actual row is the authority for
        rows_by_key = {}                          # (item_code, week_ending) → row
        items = {}                                # item_code → (name, upc)
        edge = None
        overlap_dropped = 0
        item = None
        for r in rows[1:]:
            label = str(r[off + 1] or "").strip()
            if r[off]:
                # a Product row: the code is the first token; the export sometimes
                # prefixes a stray "Ñ²"
                text = re.sub(r"^[^A-Za-z0-9]+", "", str(r[off]).strip())
                item_code, _, item_name = text.partition(" ")
                item = (item_code, item_name.strip())
            if item is None or label not in ("Actual", "Last Year"):
                continue
            source_row = "actual" if label == "Actual" else "last_year"
            upc = upc_for(item[0])
            if upc is None:
                unmatched[item[0]] = item[1]
            items[item[0]] = (item[1], upc)
            for w, v in zip(weeks, r[off + 3:off + 3 + len(weeks)]):
                units = float(v or 0)
                if units == 0:
                    continue
                wk = w if source_row == "actual" else (date.fromisoformat(w) - timedelta(days=364)).isoformat()
                if source_row == "last_year" and wk in actual_weeks:
                    overlap_dropped += 1
                    continue
                key = (item[0], wk)
                if source_row == "actual" and (edge is None or wk > edge):
                    edge = wk
                rows_by_key[key] = {
                    "account_code": code, "account_name": name,
                    "item_code": item[0], "item_name": item[1], "upc": upc, "brand": brand_of(item[1]),
                    "week_ending": wk, "units": units, "source_row": source_row, "source_file": SRC.name,
                }

        out = [rows_by_key[k] for k in sorted(rows_by_key, key=lambda k: (k[1], k[0]))]
        with gzip.open(OUT / f"{code}.json.gz", "wt", encoding="utf-8") as f:
            json.dump(out, f, separators=(",", ":"))
        years = sorted({r["week_ending"][:4] for r in out})
        mapped = sum(1 for _, u in items.values() if u)
        meta["accounts"].append({
            "account_code": code, "account_name": name, "workbook_year": year,
            "years": [int(y) for y in years], "first_week": out[0]["week_ending"], "last_week": out[-1]["week_ending"],
            "edge": edge, "items": len(items), "items_with_upc": mapped, "rows": len(out),
            "overlap_dropped": overlap_dropped,
        })
        print(f"{code}: {len(items)} items ({mapped} tied to a NIQ UPC), weeks {out[0]['week_ending']} → {out[-1]['week_ending']}, "
              f"actuals through {edge}, {len(out)} rows with shipments, {overlap_dropped} week-53 overlap rows dropped")

    meta["unmatched_items"] = [{"item_code": k, "item_name": v} for k, v in sorted(unmatched.items())]
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"{len(unmatched)} item codes not in the item crosswalk or price list — listed in meta.json")


if __name__ == "__main__":
    main()
