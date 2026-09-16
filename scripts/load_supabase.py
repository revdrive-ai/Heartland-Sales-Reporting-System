#!/usr/bin/env python3
"""Load the repo's data fixtures into Supabase — idempotent upserts.

The workbook flow stays two-stage on purpose:

  1. parse    scripts/ingest_*.py turn a CSV/Excel drop into the repo fixture
              (data/*.json.gz, lib/fixtures/*.json) — validated, diffable,
              committed to git as the audit trail.
  2. load     THIS script pushes fixtures into Supabase with natural-key
              upserts, so re-running never duplicates and a corrected
              workbook simply overwrites the same keys.

Usage:
  export SUPABASE_URL=https://<ref>.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=...      # server-side only, never client
  python3 scripts/load_supabase.py                 # load everything
  python3 scripts/load_supabase.py --only nielsen_weekly,price_list
  python3 scripts/load_supabase.py --dry-run       # row counts, no writes

Point the env at a different Supabase project (e.g. the future auto-feed
project) and the same script loads it — the schema comes from
supabase/migrations, identical everywhere.
"""

import argparse
import glob
import gzip
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BATCH = 2000


def read_json(path):
    if path.endswith(".gz"):
        with gzip.open(path, "rt") as f:
            return json.load(f)
    with open(path) as f:
        return json.load(f)


def rows_markets():
    return read_json(f"{ROOT}/lib/fixtures/markets.json")


def rows_items():
    return read_json(f"{ROOT}/lib/fixtures/items.json")


def rows_nielsen_weekly():
    out = []
    for path in sorted(glob.glob(f"{ROOT}/data/nielsen/*.json.gz")):
        for r in read_json(path):
            r = dict(r)
            r.pop("brand", None)     # denormalized in the fixture; items carries it
            r.pop("category", None)
            r.pop("market_name", None)
            out.append(r)
    return out


def rows_promotions():
    out = []
    for p in read_json(f"{ROOT}/data/promos/promotions.json.gz"):
        p = dict(p)
        # header rollups are computed from lines, never stored
        for k in ("line_count", "planned_amount", "actual_amount"):
            p.pop(k, None)
        out.append(p)
    return out


def rows_promo_lines():
    return read_json(f"{ROOT}/data/promos/promo-lines.json.gz")


def rows_item_crosswalk():
    return read_json(f"{ROOT}/lib/fixtures/item-crosswalk.json")["telus_items"]


def rows_niq_item_attributes():
    return read_json(f"{ROOT}/lib/fixtures/item-crosswalk.json")["niq_items"]


def rows_price_list():
    return read_json(f"{ROOT}/lib/fixtures/price-list.json")["rows"]


def rows_customer_crosswalk():
    out = []
    for r in read_json(f"{ROOT}/lib/fixtures/crosswalk.json"):
        r = dict(r)
        r.pop("telus_customer_ids", None)
        r.pop("telus_customer_names", None)
        out.append(r)
    return out


def rows_crosswalk_telus_customers():
    out = []
    for r in read_json(f"{ROOT}/lib/fixtures/crosswalk.json"):
        ids = r.get("telus_customer_ids") or []
        names = r.get("telus_customer_names") or []
        for i, cid in enumerate(ids):
            out.append({
                "crosswalk_id": r["id"],
                "telus_customer_id": cid,
                "telus_customer_name": names[i] if i < len(names) else cid,
            })
    return out


# table → (row producer, on_conflict natural key). Order matters: FK parents first.
TABLES = [
    ("markets", rows_markets, "code"),
    ("items", rows_items, "upc"),
    ("nielsen_weekly", rows_nielsen_weekly, "week_ending,upc,market_code"),
    ("promotions", rows_promotions, "promo_id"),
    ("promo_lines", rows_promo_lines, "line_id"),
    ("item_crosswalk", rows_item_crosswalk, "item_number,upc_core"),
    ("niq_item_attributes", rows_niq_item_attributes, "upc_core"),
    ("price_list", rows_price_list, "fg,effective_from"),
    ("customer_crosswalk", rows_customer_crosswalk, "id"),
    ("crosswalk_telus_customers", rows_crosswalk_telus_customers, "crosswalk_id,telus_customer_id"),
]


def upsert(url, key, table, on_conflict, rows):
    endpoint = f"{url}/rest/v1/{table}?on_conflict={on_conflict}"
    sent = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(chunk).encode(),
            method="POST",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:400]
            print(f"  ✗ {table} batch {i}-{i + len(chunk)}: HTTP {e.code} — {body}")
            sys.exit(1)
        sent += len(chunk)
        if len(rows) > BATCH:
            print(f"  … {table}: {sent}/{len(rows)}", end="\r")
    print(f"  ✓ {table}: {sent} rows upserted" + " " * 20)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated table names (default: all)")
    ap.add_argument("--dry-run", action="store_true", help="print row counts, write nothing")
    args = ap.parse_args()

    only = set(args.only.split(",")) if args.only else None
    todo = [(t, fn, oc) for t, fn, oc in TABLES if only is None or t in only]
    if only:
        unknown = only - {t for t, _, _ in TABLES}
        if unknown:
            sys.exit(f"unknown tables: {', '.join(sorted(unknown))} — choose from {', '.join(t for t, _, _ in TABLES)}")

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not args.dry_run and (not url or not key):
        sys.exit("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or use --dry-run)")

    for table, produce, on_conflict in todo:
        rows = produce()
        if args.dry_run:
            print(f"  {table}: {len(rows)} rows (on_conflict={on_conflict})")
            continue
        upsert(url, key, table, on_conflict, rows)

    if not args.dry_run:
        print("\nDone. Re-running is safe — everything upserts on natural keys.")


if __name__ == "__main__":
    main()
