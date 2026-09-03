#!/usr/bin/env python3
"""Item crosswalk — Telus/Heartland item numbers tied to NIQ UPCs, plus the
NIQ item attribute hierarchy (segment, sub-category, HRT_* attributes).

Source: data/raw/Crosswalk_items_V1.xlsx
  - "Heartland Foods": UPC (with check digit), SP Code, Business Unit, Brand,
    Item Description, Item Number (the Telus SKU on promo lines). Many rows
    per (UPC, Item Number) from SP-code variants — deduped here.
  - "NIQ Static": UPC (value) (NIQ code — no check digit, no leading zeros)
    plus the NIQ + HRT attribute hierarchy per item.

Join key: upc_core = digits only, leading zeros stripped; the Heartland tab
additionally drops its trailing check digit. The NIQ weekly pull's UPCs
(lib/fixtures/items.json) equal upc_core after stripping leading zeros.

Output: lib/fixtures/item-crosswalk.json
  { "telus_items": [{item_number, upc_core, brand, business_unit, description}],
    "niq_items":   [{upc_core, item, brand, category, sub_category, segment,
                     hrt_type, hrt_form, hrt_package, base_size, pack_size, flavor}] }
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/raw/Crosswalk_items_V1.xlsx"
OUT = ROOT / "lib/fixtures/item-crosswalk.json"

def clean(v) -> str:
    return "" if v is None or (isinstance(v, float) and pd.isna(v)) or pd.isna(v) else str(v).strip()


digits = lambda s: re.sub(r"\D", "", clean(s))


def core(upc: str, drop_check: bool = False) -> str:
    d = digits(upc)
    if drop_check and len(d) > 1:
        d = d[:-1]
    return d.lstrip("0")


def main() -> None:
    xl = pd.ExcelFile(SRC)
    hf = xl.parse("Heartland Foods", dtype=str)
    nq = xl.parse("NIQ Static", dtype=str)

    # ---- Telus item number ↔ UPC (deduped over SP-code variants) ----
    seen: set[tuple[str, str]] = set()
    telus = []
    skipped = 0
    for r in hf.itertuples(index=False):
        item_number = clean(r._5)  # "Item Number"
        upc_core = core(r.UPC, drop_check=True)
        if not item_number or not upc_core:
            skipped += 1
            continue
        key = (item_number, upc_core)
        if key in seen:
            continue
        seen.add(key)
        telus.append({
            "item_number": item_number,
            "upc_core": upc_core,
            "brand": clean(r.Brand),
            "business_unit": clean(r._2),  # "Business Unit"
            "description": clean(r._4),    # "Item Description"
        })

    # ---- NIQ item attributes ----
    niq = []
    for r in nq.itertuples(index=False):
        upc_core = core(getattr(r, "_0"))
        if not upc_core:
            continue
        g = lambda i: clean(r[i])
        niq.append({
            "upc_core": upc_core,
            "item": g(1),
            "brand": g(3),
            "category": g(5),
            "sub_category": g(6),
            "segment": g(7),
            "hrt_type": g(10),
            "hrt_form": g(11),
            "hrt_package": g(12),
            "base_size": g(13),
            "pack_size": g(14),
            "flavor": g(15),
        })

    OUT.write_text(json.dumps({"telus_items": telus, "niq_items": niq}, indent=1) + "\n")

    # ---- report ----
    items = json.load(open(ROOT / "lib/fixtures/items.json"))
    loaded = {core(i["upc"]): i["upc"] for i in items}
    telus_cores = {t["upc_core"] for t in telus}
    niq_cores = {n["upc_core"] for n in niq}
    print(f"telus_items: {len(telus)} pairs ({len(set(t['item_number'] for t in telus))} item numbers, "
          f"{len(telus_cores)} UPCs) · {skipped} rows skipped (blank key)")
    print(f"niq_items: {len(niq)}")
    print(f"telus UPCs found in NIQ Static: {len(telus_cores & niq_cores)}")
    print(f"loaded NIQ pull items covered by telus map: {len(set(loaded) & telus_cores)} / {len(loaded)}")
    print(f"loaded NIQ pull items with attributes: {len(set(loaded) & niq_cores)} / {len(loaded)}")


if __name__ == "__main__":
    sys.exit(main())
