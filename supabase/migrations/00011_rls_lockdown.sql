-- RLS lockdown — the app talks to Supabase exclusively through the service
-- role key from server code (lib/server/appstate.ts and, at swap-in, the repo
-- seam), and the service role bypasses row level security. Enabling RLS with
-- no anon policies means the project's anon/public key can read NOTHING,
-- which is the correct posture for a private trade tool. 00004 already gave
-- customer_crosswalk tables authenticated-read policies; they keep them.

alter table public.markets                   enable row level security;
alter table public.items                     enable row level security;
alter table public.intake_batches            enable row level security;
alter table public.nielsen_weekly_staging    enable row level security;
alter table public.intake_rejects            enable row level security;
alter table public.nielsen_weekly            enable row level security;
alter table public.alignment_nodes           enable row level security;
alter table public.alignment_meta            enable row level security;
alter table public.promo_import_batches      enable row level security;
alter table public.promotions                enable row level security;
alter table public.promo_lines               enable row level security;
alter table public.market_promo_customers    enable row level security;
alter table public.plan_registrations        enable row level security;
alter table public.plan_adjustments          enable row level security;
alter table public.plan_events               enable row level security;
alter table public.plan_budgets              enable row level security;
alter table public.item_crosswalk            enable row level security;
alter table public.niq_item_attributes       enable row level security;
alter table public.price_list                enable row level security;
alter table public.app_state                 enable row level security;
