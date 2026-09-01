"use client";

import { useEffect, useRef, useState } from "react";

/* Ask Heartland — the slide-in AI panel, mock behavior as in the demo:
   canned suggestions and a canned response. Wire to a real backend later. */

const SUGGESTIONS = [
  "Why is Splenda's base soft at Publix?",
  "Which events are pacing below the ROI guardrail?",
  "Summarize trade spend vs plan for the quarter.",
];

type Bubble = { who: "You" | "Heartland AI"; text: string };

const HELLO: Bubble = {
  who: "Heartland AI",
  text: "Hi Randy — I can help you plan promotions, explain a baseline, find deduction mismatches, or run a scenario. Suggestions below follow the screen you're on:",
};

const CANNED: Bubble = {
  who: "Heartland AI",
  text: "✦ Working through your data… in the live platform I'd return a sourced answer with the events, numbers, and a one-click action. (This is a mockup.)",
};

export default function AskPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([HELLO]);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [bubbles]);

  const send = (q?: string) => {
    const msg = (q ?? text).trim();
    if (!msg) return;
    setBubbles((b) => [...b, { who: "You", text: msg }, CANNED]);
    setText("");
  };

  return (
    <>
      <div className={"overlay" + (open ? " on" : "")} onClick={onClose} />
      <aside className={"askpanel" + (open ? " open" : "")}>
        <div className="ap-head">
          <div className="logo" style={{ width: 26, height: 26, borderRadius: 7, background: "var(--brand)", color: "var(--brand-ink)", display: "grid", placeItems: "center", fontWeight: 900 }}>✦</div>
          <b>Ask Heartland</b>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="ap-body" ref={bodyRef}>
          {bubbles.map((b, i) => (
            <div className={"bubble" + (b.who === "You" ? " user" : "")} key={i}>
              <div className="who">{b.who}</div>
              {b.text}
            </div>
          ))}
          <div>
            {SUGGESTIONS.map((s) => (
              <button className="suggest" key={s} onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className="ap-foot">
          <div className="ap-inrow">
            <input
              ref={inputRef}
              value={text}
              placeholder="Ask anything about your trade business…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            />
            <button className="btn primary" style={{ padding: "9px 14px" }} onClick={() => send()}>Send</button>
          </div>
          <div className="ap-hint">Press Enter to send · mockup returns canned responses</div>
        </div>
      </aside>
    </>
  );
}
