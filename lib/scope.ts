// Global customer scope — the five cascading selectors at the top of every
// screen, driven by the customer crosswalk. Client-safe (no fs): the topbar
// facets options with these helpers, and server pages resolve the same scope
// from the hh-scope cookie via lib/server/scope.ts.

import type { CrosswalkRow } from "@/lib/types/db";
import crosswalkJson from "@/lib/fixtures/crosswalk.json";

export const CROSSWALK = crosswalkJson as CrosswalkRow[];

export type Scope = {
  territory?: string;
  parent?: string;
  sales?: string;
  teamLead?: string;
  accountLead?: string;
};

export const SCOPE_COOKIE = "hh-scope";

export const SCOPE_FIELDS: { key: keyof Scope; label: string; col: keyof CrosswalkRow }[] = [
  { key: "territory", label: "Territory", col: "territory" },
  { key: "parent", label: "Parent", col: "parent_account" },
  { key: "sales", label: "Account", col: "sales_account" },
  { key: "teamLead", label: "Team lead", col: "team_lead" },
  { key: "accountLead", label: "Acct lead", col: "account_lead" },
];

export function rowMatches(r: CrosswalkRow, s: Scope, except?: keyof Scope): boolean {
  for (const f of SCOPE_FIELDS) {
    if (f.key === except) continue;
    const v = s[f.key];
    if (v && r[f.col] !== v) return false;
  }
  return true;
}

/** Rows the current scope resolves to (all rows when nothing is selected). */
export function scopeRows(s: Scope): CrosswalkRow[] {
  return CROSSWALK.filter((r) => rowMatches(r, s));
}

/** Options for one dropdown, faceted by every OTHER selection — picking
    Albertsons up top leaves only Albertsons choices below (and vice versa). */
export function facetOptions(s: Scope, field: keyof Scope): string[] {
  const col = SCOPE_FIELDS.find((f) => f.key === field)!.col;
  const vals = new Set<string>();
  for (const r of CROSSWALK) {
    if (rowMatches(r, s, field)) vals.add(String(r[col]));
  }
  return [...vals].sort((a, b) => a.localeCompare(b));
}

/** Apply a new selection, then drop any other selections it invalidated. */
export function applySelection(s: Scope, field: keyof Scope, value: string | undefined): Scope {
  const next: Scope = { ...s, [field]: value || undefined };
  for (const f of SCOPE_FIELDS) {
    const v = next[f.key];
    if (v && !facetOptions(next, f.key).includes(v)) next[f.key] = undefined;
  }
  return next;
}

export function scopeActive(s: Scope): boolean {
  return SCOPE_FIELDS.some((f) => !!s[f.key]);
}

/** Short human label for the current scope, most specific selection first. */
export function scopeLabel(s: Scope): string {
  return (
    s.sales ?? s.parent ?? s.accountLead ?? s.teamLead ?? s.territory ?? "All customers"
  );
}

export type ResolvedScope = {
  scope: Scope;
  active: boolean;
  label: string;
  rows: CrosswalkRow[];
  /** Nielsen markets in scope that we hold data for. */
  marketCodes: string[];
  /** Telus customer ids in scope (name-matched). */
  telusCustomerIds: string[];
};

export function resolveScope(s: Scope): ResolvedScope {
  const rows = scopeRows(s);
  return {
    scope: s,
    active: scopeActive(s),
    label: scopeLabel(s),
    rows,
    marketCodes: [...new Set(rows.map((r) => r.market_code).filter((c): c is string => !!c))],
    telusCustomerIds: [...new Set(rows.flatMap((r) => r.telus_customer_ids))],
  };
}
