"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

export type TransformOrigin = "hero" | "dock" | "rail";
export type TransformVerdict = "confirmed" | "failed";

interface Piece {
  id: string;
  clip: string;
  /** Entry offset for the forward assembly (px at 300px stage). */
  from: string;
}

/**
 * Armor pieces cut from the armored render (public/mascot/warden-cut.png),
 * positioned over the same art so alignment is exact. Assembly order matches
 * the approved motion reference: crown, shoulders, belt, katana, guards.
 * The face and antenna stay visible at all times — no piece covers them.
 */
const PIECES: Piece[] = [
  { id: "crown", clip: "inset(19% 11% 55% 27%)", from: "translateY(-90px) rotate(-14deg)" },
  { id: "shoulder-l", clip: "inset(32% 62% 31% 4%)", from: "translate(-90px, -30px) rotate(-18deg)" },
  { id: "shoulder-r", clip: "inset(32% 0% 34% 74%)", from: "translate(90px, -30px) rotate(18deg)" },
  { id: "belt", clip: "inset(65% 17% 4% 25%)", from: "translateY(80px)" },
  { id: "katana", clip: "inset(55% 0% 5% 73%)", from: "translate(80px, 40px) rotate(24deg)" },
  { id: "guard-l", clip: "inset(59% 71% 9% 7%)", from: "translate(-70px, 50px) rotate(-20deg)" },
  { id: "guard-r", clip: "inset(57% 0% 14% 83%)", from: "translate(70px, 50px) rotate(20deg)" },
];

const ORIGIN_RISE: Record<TransformOrigin, string> = {
  hero: "translateY(60px) scale(0.85)",
  dock: "translateX(-70px) scale(0.9)",
  rail: "translateX(-90px) scale(0.9)",
};

/**
 * Warden transformation. A temporary, non-blocking celebratory stage
 * (pointer-events: none, ~300px) centered in the main workspace. It never
 * moves focus, scroll, composer text, or panel state and never gates policy:
 * the enforced mode always comes from the confirmed backend result.
 * Skip (Esc or click anywhere — the layer is click-through, so Esc) jumps to
 * the confirmed end state; skip never delays or cancels the real request.
 */
export function WardenTransformation({
  entering,
  origin,
  verdict = "confirmed",
  error = null,
  onSkip,
  onDone,
  onCommit,
}: {
  entering: boolean;
  origin: TransformOrigin;
  verdict?: TransformVerdict;
  error?: string | null;
  onSkip: () => void;
  onDone: () => void;
  /** Called at the Act V settle so theming commits mid-sequence. */
  onCommit?: () => void;
}) {
  const reduce = (() => {
    try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
  })();
  const [phase, setPhase] = useState<"play" | "end" | "failed">("play");
  const [visiblePieces, setVisiblePieces] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [orb, setOrb] = useState(false);
  const [flash, setFlash] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const skipRef = useRef(onSkip);
  skipRef.current = onSkip;

  useEffect(() => {
    const after = (ms: number, fn: () => void) => {
      timers.current.push(setTimeout(fn, ms));
    };
    if (reduce) {
      // Reduced motion: a brief crossfade only, status intact.
      after(350, () => doneRef.current());
    } else if (verdict === "failed") {
      if (entering) {
        // Failed activation: charge begins, then everything dissolves + error.
        after(700, () => setPhase("end"));
        after(900, () => setPhase("failed"));
        after(3400, () => doneRef.current());
      } else {
        // Failed deactivation: armored figure sheds pieces, reverts visually.
        setRevealed(true);
        setVisiblePieces(PIECES.length);
        after(300, () => setVisiblePieces(0));
        after(900, () => setRevealed(false));
        after(1100, () => setPhase("failed"));
        after(3600, () => doneRef.current());
      }
    } else if (entering) {
      // Forward, about 3.2s. I charge, II orb, III assembly, IV reveal, V settle.
      after(500, () => setOrb(true));
      after(900, () => setVisiblePieces(1));
      PIECES.forEach((_, i) => { if (i > 0) after(900 + i * 190, () => setVisiblePieces(i + 1)); });
      after(900, () => setRevealed(true)); // body crossfades as assembly starts
      after(2150, () => { setFlash(true); setOrb(false); });
      after(2450, () => setFlash(false));
      after(2600, () => setPhase("end"));
      after(3200, () => doneRef.current());
    } else {
      // Reverse, about 2.6s: distinct dissolve, not forward played backwards.
      setRevealed(true);
      setVisiblePieces(PIECES.length);
      setOrb(true);
      after(400, () => setOrb(false));
      after(500, () => setVisiblePieces(0)); // guards-first dissolve handled in CSS order
      after(1100, () => { setFlash(true); });
      after(1350, () => { setFlash(false); setRevealed(false); });
      after(1900, () => setPhase("end"));
      after(2600, () => doneRef.current());
    }
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [entering, verdict, reduce]);

  // Skip (Esc or a click/tap outside the mascot) jumps to the confirmed
  // end state. The stage is pointer-events:none so clicks pass through and
  // focus, scroll, composer text and panel state are never disturbed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") skipRef.current(); };
    const onPoint = () => skipRef.current();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPoint);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPoint);
    };
  }, []);

  // onCommit fires exactly once per transformation, when the settle lands.
  const committedRef = useRef(false);
  useEffect(() => {
    if (phase === "end" && verdict === "confirmed" && !committedRef.current) {
      committedRef.current = true;
      try { onCommit?.(); } catch { /* theme commit is best-effort */ }
    }
  }, [phase, verdict, onCommit]);

  const failed = verdict === "failed";
  const showArmored = revealed;

  return (
    <div className="wt-layer" aria-hidden={failed ? undefined : true}>
      <div
        className={`wt-stage${phase === "end" ? " wt-settle" : ""}${failed && phase === "failed" ? " wt-failed" : ""}`}
        style={phase === "play" ? { transform: ORIGIN_RISE[origin] } : undefined}
        data-testid="warden-stage"
        data-entering={entering ? "1" : "0"}
        data-verdict={verdict}
      >
        <span className={`wt-rings${orb || phase === "play" ? " on" : ""}`} aria-hidden="true" />
        <span className={`wt-orb${orb ? " on" : ""}`} aria-hidden="true" />
        <span className={`wt-wash${phase === "end" && !failed ? " on" : ""}`} aria-hidden="true" />
        <span className={`wt-flash${flash ? " on" : ""}`} aria-hidden="true" />
        <span className="wt-figure">
          <Image
            className={`wt-body${showArmored ? " wt-hide" : ""}`}
            src="/mascot/normal-cut.png" alt="" width={300} height={300} priority draggable={false}
          />
          <Image
            className={`wt-body wt-armored${showArmored ? "" : " wt-hide"}`}
            src="/mascot/warden-cut.png" alt="" width={300} height={300} priority draggable={false}
          />
          {PIECES.map((p, i) => (
            <span
              key={p.id}
              className={`wt-piece${i < visiblePieces ? " in" : ""}${!entering && verdict === "confirmed" ? " out" : ""}`}
              style={{
                clipPath: p.clip,
                ["--wt-from" as string]: p.from,
                transitionDelay: entering ? `${i * 40}ms` : `${(PIECES.length - 1 - i) * 70}ms`,
              }}
              aria-hidden="true"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mascot/warden-cut.png" alt="" draggable={false} />
            </span>
          ))}
        </span>
        {failed && phase === "failed" ? (
          <p className="wt-error" role="alert">
            {error ?? (entering ? "Warden activation failed." : "Warden deactivation failed.")} No changes were applied.
          </p>
        ) : null}
      </div>
    </div>
  );
}
