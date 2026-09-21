"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from "@/lib/auth/domain";

/* Sign in: enter a company address, receive a six-digit code by email,
   type it back. The code is requested through our own route so the domain
   is checked before any mail is sent; it is verified through the browser
   client, because that is what writes the session cookies the rest of the
   app reads. */

export default function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(initialError ?? null);
  const [note, setNote] = useState<string | null>(null);

  const sendCode = async (resend = false) => {
    const addr = email.trim().toLowerCase();
    if (!isAllowedEmail(addr)) {
      setErr(`Sign-in is limited to @${ALLOWED_EMAIL_DOMAIN} email addresses.`);
      return;
    }
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: addr }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { setErr(body.error ?? "Could not send the code."); return; }
      setEmail(addr);
      setStep("code");
      setNote(resend ? "A new code is on its way." : `Code sent to ${addr}. It expires in about an hour.`);
    } catch {
      setErr("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const token = code.replace(/\D/g, "");
    if (token.length < 6) { setErr("Enter the six-digit code from the email."); return; }
    setBusy(true); setErr(null);
    try {
      const { error } = await supabaseBrowser().auth.verifyOtp({ email, token, type: "email" });
      if (error) {
        setErr(/expired|invalid/i.test(error.message)
          ? "That code is wrong or has expired. Send a new one."
          : error.message.slice(0, 160));
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setErr("Could not verify the code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="loginwrap">
      <div className="logincard">
        <div className="loginbrand">
          <div className="logo">H</div>
          <div>
            <b>Heartland Foods</b>
            <small>Trade Platform</small>
          </div>
        </div>

        {step === "email" ? (
          <>
            <h1>Sign in</h1>
            <p className="lsub">
              Enter your <b>@{ALLOWED_EMAIL_DOMAIN}</b> address and we&apos;ll email you a six-digit code.
            </p>
            <label className="llabel" htmlFor="email">Work email</label>
            <input
              id="email"
              className="linput"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder={`you@${ALLOWED_EMAIL_DOMAIN}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) void sendCode(); }}
            />
            <button className="lbtn" onClick={() => void sendCode()} disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </>
        ) : (
          <>
            <h1>Enter your code</h1>
            <p className="lsub">
              We emailed a six-digit code to <b>{email}</b>.
            </p>
            <label className="llabel" htmlFor="code">Six-digit code</label>
            <input
              id="code"
              className="linput code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) void verify(); }}
            />
            <button className="lbtn" onClick={() => void verify()} disabled={busy || code.length < 6}>
              {busy ? "Checking…" : "Sign in"}
            </button>
            <div className="lrow">
              <button className="llink" onClick={() => { setStep("email"); setCode(""); setErr(null); setNote(null); }} disabled={busy}>
                ← Use a different address
              </button>
              <button className="llink" onClick={() => void sendCode(true)} disabled={busy}>
                Resend code
              </button>
            </div>
          </>
        )}

        {err && <div className="lmsg bad" role="alert">{err}</div>}
        {note && !err && <div className="lmsg ok">{note}</div>}

        <div className="lfoot">
          Access is limited to @{ALLOWED_EMAIL_DOMAIN} accounts.
        </div>
      </div>
    </div>
  );
}
