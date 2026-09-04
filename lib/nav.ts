// Sidebar navigation model — the 16 views of the Heartland Harvest V3 mockup,
// grouped exactly as the demo groups them. `tag` renders the small brand chip
// (workflow step numbers, AI, V1); `badge` renders the red count pill.

export type NavItem = {
  view: string;      // route segment, matches the demo's data-view key
  label: string;
  icon: string;      // key into ICONS
  title: string;     // hover title, verbatim from the demo
  tag?: string;
  badge?: string;
};

export type NavGroup = { heading: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    heading: "Trade Workflow",
    items: [
      { view: "base", label: "Base & Lift Lab", icon: "trend", tag: "1", title: "Base & Lift Lab — step 1 of the loop" },
      { view: "planner", label: "Promotion Planner", icon: "calendar", tag: "2", title: "Promotion Planner — step 2 of the loop" },
      { view: "reporting", label: "Sales Dashboard", icon: "chart", tag: "3", title: "Sales Dashboard — step 3 of the loop" },
      { view: "analysis", label: "Promo Analysis", icon: "search", tag: "4", title: "Promo Analysis — step 4 of the loop" },
      { view: "deductions", label: "Deduction Center", icon: "receipt", badge: "50", title: "Deduction Center — AI review queue" },
    ],
  },
  {
    heading: "Segments",
    items: [
      { view: "foodservice", label: "Foodservice", icon: "utensils", title: "Foodservice segment view" },
    ],
  },
  {
    heading: "Planning Tools",
    items: [
      { view: "objectives", label: "Objectives & KPIs", icon: "target", title: "HQ objectives by customer × brand × month, with attainment tracking" },
      { view: "approvals", label: "Approvals", icon: "scale", badge: "0", title: "Promotion sign-off queue — policy routes what needs a leader" },
      { view: "le", label: "Latest Estimate (LE)", icon: "refresh", title: "Monthly Latest Estimate cycle — version locks, look-back, review pack" },
    ],
  },
  {
    heading: "Leadership",
    items: [
      { view: "leader", label: "Sales Leader View", icon: "award", title: "Sales Leader View" },
    ],
  },
  {
    heading: "Data & Integrations",
    items: [
      { view: "integrations", label: "Integrations", icon: "plug", badge: "3", title: "Integrations & feed health — 3 open exceptions" },
      { view: "agents", label: "Agent Runs", icon: "bot", tag: "AI", title: "Agent Runs — AI automation" },
      { view: "tielist", label: "Tie List", icon: "link", title: "Tie List — identifier mapping" },
      { view: "pricelist", label: "Price List", icon: "receipt", title: "Price List — dated list prices per item, the pricing basis for analysis" },
      { view: "alignkey", label: "Alignment Key", icon: "map", title: "Customer Alignment Key — territory hierarchy" },
      { view: "catkey", label: "Category Key", icon: "tag", badge: "3", title: "Category Key — item taxonomy & intake gate" },
      { view: "nielsenpull", label: "Nielsen Pull Spec", icon: "inbox", tag: "V1", title: "Nielsen Pull Spec — Albertsons data request template" },
    ],
  },
];

export const ALL_VIEWS: NavItem[] = NAV.flatMap((g) => g.items);

export function navItemFor(view: string): NavItem | undefined {
  return ALL_VIEWS.find((i) => i.view === view);
}

export function groupFor(view: string): string {
  return NAV.find((g) => g.items.some((i) => i.view === view))?.heading ?? "";
}

/* The five-step trade workflow strip shown on the workflow views. */
export const WORKFLOW: [string, string][] = [
  ["base", "Model the base"],
  ["planner", "Plan promotions"],
  ["reporting", "Track the business"],
  ["analysis", "Measure & learn"],
  ["deductions", "Reconcile spend"],
];
