# Sign-in — setup runbook

Access to the platform is by **emailed six-digit code**, limited to
`@revdrive.ai` addresses. There are no passwords.

The code is in the repo; the four steps below are dashboard settings that
only a Supabase project admin can do. Until steps 1–3 are done, the deployed
app sends everyone to `/login` and says sign-in isn't configured — it fails
closed, never open.

## How it works

1. Someone enters their address on `/login`.
2. `POST /api/auth/otp` checks the domain **before** Supabase is asked to
   send anything, so the platform never emails a stranger.
3. Supabase emails the code (`{{ .Token }}` in the Magic Link template).
4. The browser verifies it with `verifyOtp`, which writes the session
   cookies.
5. `middleware.ts` revalidates the session on every request and re-checks the
   domain, so a session belonging to any other address is signed out.

Three layers enforce the same rule, and the one that actually closes the door
is the Supabase hook — the anon key is public, so anyone could call Supabase
directly and the app's own checks would never see it.

| Layer | Stops | Where |
| --- | --- | --- |
| Login form | Typos, wrong address | `components/auth/LoginForm.tsx` |
| OTP route | Sending mail off-domain | `app/api/auth/otp/route.ts` |
| **Signup hook** | **An off-domain account ever existing** | `supabase/migrations/00013_auth_domain_lock.sql` |
| Middleware | Serving any page to an off-domain session | `middleware.ts` |

## 1. Environment variables

The app needs the **public** Supabase values (both are safe in a browser):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The Vercel–Supabase integration usually adds these already. Check
**Vercel → Settings → Environment Variables**; if only `SUPABASE_URL` and
`SUPABASE_ANON_KEY` exist, add the `NEXT_PUBLIC_` copies and redeploy. The
service-role key is *not* used for sign-in and must stay server-only.

## 2. Run the SQL

In the Supabase **SQL Editor**, run `supabase/setup.sql` (safe to re-run —
it's idempotent), or just `supabase/migrations/00013_auth_domain_lock.sql`.

That creates `public.signup_email_domains` (seeded with `revdrive.ai`) and
the `hook_restrict_signup_by_email_domain` function.

To allow another domain later, insert a row — no code change, no deploy:

```sql
insert into public.signup_email_domains (domain, note)
values ('heartlandfoods.com', 'client reviewers');
```

To revoke one, delete the row. Existing sessions for that domain end at their
next request, because the middleware re-checks on every request.

## 3. Enable the hook — the step that actually locks it

**Authentication → Hooks → Before User Created**

- Type: **Postgres**
- Schema `public`, function `hook_restrict_signup_by_email_domain`
- Enable, and save.

**The domain restriction does nothing until this is switched on.** Without
it, anyone holding the public anon key can create an account directly
against Supabase; they could not use the app (the middleware would sign them
out) but the account would exist.

Verify it: from the SQL editor,

```sql
select public.hook_restrict_signup_by_email_domain(
  '{"user":{"email":"someone@gmail.com"}}'::jsonb);
```

should return a 403 error object, and the same call with
`randy@revdrive.ai` should return `{}`.

## 4. Put the code in the email

**Authentication → Emails → Magic Link**

The default template only has the link. The template below leads with the
code and keeps the link as a fallback. `{{ .Token }}` is the six-digit code;
`{{ .ConfirmationURL }}` is the one-click link.

```html
<h2 style="font-family:system-ui,sans-serif;margin:0 0 12px">Your sign-in code</h2>
<p style="font-family:system-ui,sans-serif;font-size:14px;color:#3a4150;margin:0 0 18px">
  Enter this code in the Heartland Trade Platform to sign in.
</p>
<p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;
          font-weight:800;letter-spacing:.32em;margin:0 0 20px;color:#1a1d23">
  {{ .Token }}
</p>
<p style="font-family:system-ui,sans-serif;font-size:13px;color:#6b7280;margin:0 0 22px">
  The code expires in one hour. If you didn't ask for it, ignore this email.
</p>
<p style="font-family:system-ui,sans-serif;font-size:13px;color:#6b7280;margin:0">
  Or <a href="{{ .ConfirmationURL }}">click here to sign in</a>.
</p>
```

Do the same for the **Confirm signup** template — a first-time user gets that
one rather than Magic Link, and the default has no code in it, so without
this the first sign-in for each new person would have no code to type.

## 5. URLs

**Authentication → URL Configuration**

- Site URL: `https://heartland.revdrive.ai`
- Redirect URLs: add `https://heartland.revdrive.ai/**`

This only matters for the fallback link; the code path doesn't use it.

## Worth knowing

**The built-in email service will not work for a team.** Two hard limits,
both of which you hit immediately in real use:

- **2 messages per hour** for the whole project.
- It **only delivers to addresses on the Supabase project's team**. Everyone
  else gets *"Email address not authorized"* — so colleagues cannot sign in
  at all, however long you wait.

So **custom SMTP is required, not optional**. It is included on the Supabase
**Free** plan; no upgrade needed. Authentication → Emails → SMTP Settings.

Any SMTP provider works. [Resend](https://resend.com) pairs with Supabase in
a few minutes and has a free tier:

1. Create a Resend account and add `revdrive.ai` as a sending domain.
2. Resend prints DNS records (DKIM/SPF) — add them at Namecheap, the same
   place the `heartland` A record went.
3. Create an API key.
4. In Supabase → Authentication → Emails → SMTP Settings, enable custom SMTP:
   host `smtp.resend.com`, port `465`, username `resend`, password = the API
   key, sender `no-reply@revdrive.ai` with a sender name.
5. Supabase then caps sending at **30/hour** by default to protect a new
   domain's reputation — raise it under Authentication → Rate Limits once
   mail is flowing.

Until that is done, only the Supabase project owner's own address can receive
a code, and only twice an hour.

**Code lifetime** is set under Authentication → Providers → Email (OTP
expiry). One hour is the default and is reasonable here.

**Sessions** persist in cookies and refresh automatically. "Sign out" is in
the top bar, beside the avatar.

**The scheduled LE lock is unaffected.** `/api/cron/le-lock` stays outside
the session check and keeps authenticating with `CRON_SECRET`, so the
monthly lock keeps running with nobody signed in.
