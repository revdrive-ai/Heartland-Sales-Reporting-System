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
  · the workbook's figures are CASES. Each row keeps the cases as shipped
    and converts them to units with an explicit pack: the price list's
    units_per_case for the item code (FG#) first, then the price list row of
    the tied UPC when that is unambiguous, then the pack in the description
    ("6/400 PKT" → 6, "1x6" → 6, "12Blk" → 12 — which can count inner bottles
    rather than sellable units, so it is marked). pack_source says which;
    an item with no pack keeps units = null and is counted in meta.json
  · item codes are resolved to a NIQ UPC where the item crosswalk (Telus item
    number or SP Code) or the price list (FG#) names exactly one UPC AND the
    UPC is in the NIQ pull AND its brand agrees with the description (the
    raw crosswalk repeats one SP code down whole runs of SlimFast rows, so a
    code named against several UPCs is ambiguous, not tied); the rest carry
    upc = null and are listed in meta.json so the crosswalk can be extended
  · the sheet name maps to an account code: Jewel is the Albertsons division
    already on file, Publix is a new shipments-only account

Output: data/shipments/<ACCOUNT>.json.gz (rows) and data/shipments/meta.json
  row: { account_code, account_name, item_code, item_name, upc, brand,
         week_ending, cases, units_per_case, units, pack_source, source_row,
         source_file }
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


PACK_WORDS = [
    re.compile(r"\b(\d{1,3})(?:ct)?\s*/\s*\d", re.I),  # "6/400 PKT", "12/9.8 JAR", "12ct/200 PKT"
    re.compile(r"\b1x(\d{1,3})", re.I),               # "1x6XTDP", "1x6T"
    re.compile(r"\b(\d{1,2})\s*Blk\b", re.I),          # "12Blk", "10BLK"
]


def pack_from_description(name: str):
    """The pack the description spells, or None. "3-4pk/11oz" is a 3 × 4-pack
    case, which the first pattern would read as 4 — skip anything with a
    hyphenated multiplier and leave it to the price list."""
    if re.search(r"\b\d+-\d+pk\b", name, re.I):
        return None
    for rx in PACK_WORDS:
        m = rx.search(name)
        if m:
            return int(m.group(1))
    return None


def load_maps():
    """item code → the NIQ upcs named for it, in two grades: the Telus item
    crosswalk and the price list carry one row per code (strong); the raw
    crosswalk workbook's SP Code / Item Number columns repeat one code down
    whole runs of rows (weak — usable only when they name exactly one upc).
    Also the brand of each NIQ item and the price list's units per case by
    FG# and by upc."""
    items = json.loads((FIXTURES / "items.json").read_text())
    core_to_upc = {re.sub(r"\D", "", i["upc"]).lstrip("0"): i["upc"] for i in items}
    brand_of_upc = {i["upc"]: i["brand"] for i in items}
    strong, weak = {}, {}

    def name(into, code, upc):
        if code and upc:
            into.setdefault(str(code).strip(), set()).add(upc)

    xw = json.loads((FIXTURES / "item-crosswalk.json").read_text())
    for t in xw["telus_items"]:
        name(strong, t["item_number"], core_to_upc.get(t["upc_core"]))
    pl = json.loads((FIXTURES / "price-list.json").read_text())
    pack_by_fg, pack_by_upc = {}, {}
    for r in pl["rows"]:
        upc = core_to_upc.get(r["upc_core"])
        name(strong, r["fg"], upc)
        if r["units_per_case"]:
            pack_by_fg.setdefault(r["fg"], r["units_per_case"])
            if upc:
                pack_by_upc.setdefault(upc, set()).add(r["units_per_case"])
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
            name(weak, sp, upc)
            name(weak, item_no, upc)
    cands = {k: (strong.get(k, set()), weak.get(k, set())) for k in set(strong) | set(weak)}
    # a code with no row of its own ties by its digits when they name exactly
    # one known code — Telus/the planner write "FGMA20015446" where the
    # crosswalk has "20015446"
    by_digits = {}
    for k in cands:
        by_digits.setdefault(re.sub(r"\D", "", k), set()).add(k)
    return cands, by_digits, brand_of_upc, pack_by_fg, pack_by_upc


# the brand a NIQ item carries, in the words the workbook uses
NIQ_BRAND = {"SPLENDA": "SPLENDA", "SLIMFAST": "SLIMFAST", "JAVA HOUSE": "JAVA HOUSE", "EQUAL": "EQUAL", "KETO:SWEET": "KETO:SWEET"}


def main() -> None:
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    cands, by_digits, brand_of_upc, pack_by_fg, pack_by_upc = load_maps()
    ambiguous = {}

    def upc_for(code: str, desc: str):
        pair = cands.get(code)
        if pair is None:
            hits = by_digits.get(re.sub(r"\D", "", code), set())
            pair = cands[next(iter(hits))] if len(hits) == 1 else (set(), set())
        # a UPC whose brand disagrees with the description is a bad tie
        same_brand = lambda upcs: {u for u in upcs if NIQ_BRAND.get(brand_of_upc.get(u, ""), "") == brand_of(desc)}
        for upcs in (same_brand(pair[0]), same_brand(pair[1])):
            if len(upcs) == 1:
                return next(iter(upcs))
            if len(upcs) > 1:
                ambiguous[code] = sorted(upcs)
                return None
        return None

    def pack_for(code: str, upc, desc: str):
        """(units per case, where it came from)"""
        for k in (code, re.sub(r"\D", "", code)):
            if k in pack_by_fg:
                return pack_by_fg[k], "price_list"
        said = pack_from_description(desc)
        if upc and upc in pack_by_upc:
            packs = pack_by_upc[upc]
            if len(packs) == 1:
                return next(iter(packs)), "price_list"
            if said in packs:
                return said, "price_list"
        if said:
            return said, "description"
        return None, None

    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"source_file": SRC.name, "measure": "cases, converted to units by units_per_case", "accounts": []}
    unmatched = {}
    unpacked = {}

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
            upc = upc_for(item[0], item[1])
            if upc is None:
                unmatched[item[0]] = item[1]
            pack, pack_source = pack_for(item[0], upc, item[1])
            items[item[0]] = (item[1], upc, pack)
            for w, v in zip(weeks, r[off + 3:off + 3 + len(weeks)]):
                cases = float(v or 0)
                if cases == 0:
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
                    "week_ending": wk, "cases": cases,
                    "units_per_case": pack, "units": cases * pack if pack else None, "pack_source": pack_source,
                    "source_row": source_row, "source_file": SRC.name,
                }

        out = [rows_by_key[k] for k in sorted(rows_by_key, key=lambda k: (k[1], k[0]))]
        with gzip.open(OUT / f"{code}.json.gz", "wt", encoding="utf-8") as f:
            json.dump(out, f, separators=(",", ":"))
        years = sorted({r["week_ending"][:4] for r in out})
        mapped = sum(1 for _, u, _p in items.values() if u)
        no_pack = sorted((c, n) for c, (n, _u, pk) in items.items() if not pk)
        meta["accounts"].append({
            "account_code": code, "account_name": name, "workbook_year": year,
            "years": [int(y) for y in years], "first_week": out[0]["week_ending"], "last_week": out[-1]["week_ending"],
            "edge": edge, "items": len(items), "items_with_upc": mapped, "items_without_pack": len(no_pack), "rows": len(out),
            "overlap_dropped": overlap_dropped,
        })
        for c, n in no_pack:
            unpacked[c] = n
        print(f"{code}: {len(items)} items ({mapped} tied to a NIQ UPC, {len(no_pack)} without a case pack), "
              f"weeks {out[0]['week_ending']} → {out[-1]['week_ending']}, actuals through {edge}, "
              f"{len(out)} rows with shipments, {overlap_dropped} week-53 overlap rows dropped")

    meta["unmatched_items"] = [{"item_code": k, "item_name": v} for k, v in sorted(unmatched.items())]
    meta["ambiguous_items"] = [{"item_code": k, "upcs": v} for k, v in sorted(ambiguous.items())]
    meta["items_without_pack"] = [{"item_code": k, "item_name": v} for k, v in sorted(unpacked.items())]
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"{len(unmatched)} item codes not tied to a NIQ item ({len(ambiguous)} of them named against several UPCs), "
          f"{len(unpacked)} with no case pack — listed in meta.json")


if __name__ == "__main__":
    main()
