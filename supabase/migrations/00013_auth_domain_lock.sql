-- Restrict who may ever become a user.
--
-- The app checks the email domain in its own sign-in route and again in the
-- middleware, but the anon key is public: anyone holding it can call
-- Supabase's auth endpoints directly. This is the control that actually
-- closes that door — a before-user-created hook that refuses to create an
-- account whose address is off-domain. Without it the other two layers are
-- only user experience.
--
-- After running this, enable it in the dashboard:
--   Authentication → Hooks → Before User Created →
--   Postgres → public.hook_restrict_signup_by_email_domain
-- It does not take effect until that is done.

create table if not exists public.signup_email_domains (
  domain     text primary key,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.signup_email_domains is
  'Email domains allowed to create an account. Empty table = nobody can sign up.';

insert into public.signup_email_domains (domain, note)
values ('revdrive.ai', 'RevDrive staff')
on conflict (domain) do nothing;

-- Only the auth admin may read this; it is not application data.
alter table public.signup_email_domains enable row level security;
revoke all on public.signup_email_domains from anon, authenticated;
grant select on public.signup_email_domains to supabase_auth_admin;

create or replace function public.hook_restrict_signup_by_email_domain(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  addr        text;
  email_domain text;
  allowed     int;
begin
  addr := lower(trim(event -> 'user' ->> 'email'));
  email_domain := split_part(addr, '@', 2);

  -- no address, or something that isn't one: refuse
  if addr is null or email_domain = '' or addr like '%@%@%' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'A valid email address is required.',
        'http_code', 400
      )
    );
  end if;

  select count(*) into allowed
  from public.signup_email_domains d
  where lower(d.domain) = email_domain;

  if allowed > 0 then
    return '{}'::jsonb;   -- allow
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'This platform is limited to approved company email addresses.',
      'http_code', 403
    )
  );
end;
$$;

comment on function public.hook_restrict_signup_by_email_domain(jsonb) is
  'before-user-created auth hook: allows signup only from public.signup_email_domains.';

grant execute on function public.hook_restrict_signup_by_email_domain(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_by_email_domain(jsonb) from anon, authenticated, public;
