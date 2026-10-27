"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  BODY_SRC, FACE, POKE_MANY, POKE_PHRASES, POKE_TOO_MANY, cursorNow,
  lastInputAt, noteInput, perkedNow, subscribeLoop,
  type CompanionAgentState, type CompanionVariant,
} from "@/lib/companion";
import "./companion.css";

export type { CompanionAgentState, CompanionVariant };

interface Props {
  variant: CompanionVariant;
  liveliness: "live" | "static";
  /** Subtle mode: blink only, no tracking, hop, or shimmer. */
  calm?: boolean;
  reducedMotion?: boolean;
  state?: CompanionAgentState;
  lookAtActivity?: boolean;
  interactive?: boolean;
  showBubble?: boolean;
  className?: string;
  label?: string;
  /** Dock handoff entrance: shrink into place with transform only. */
  entrance?: boolean;
}

const FELT = "#171110";
const GLOW = "#FFF3D9";

/**
 * The VOW companion. Rig rule: the vector face (eyes/smile) and every
 * overlay are children of the same .cp-body group that carries the body's
 * hop/lean/wiggle/squash transform — never siblings in stage coordinates.
 * Only the face's own relative transforms (cursor look, blink, smile shape)
 * live inside it. Enforced by tools/audit/face-rig.mjs against the prototype
 * and by companion-face-rig.mjs against this component.
 */
export function Companion({
  variant, liveliness, calm = false, reducedMotion = false,
  state = "idle", lookAtActivity = false, interactive = false,
  showBubble = false, className = "", label = "Poke the mascot", entrance = false,
}: Props) {
  const live = liveliness === "live" && !reducedMotion;
  const g = FACE[variant];
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const antRef = useRef<HTMLDivElement>(null);
  const lookRef = useRef<SVGGElement>(null);
  const eyeLRef = useRef<SVGGElement>(null);
  const eyeRRef = useRef<SVGGElement>(null);
  const arcLRef = useRef<SVGPathElement>(null);
  const arcRRef = useRef<SVGPathElement>(null);
  const mouthRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGEllipseElement>(null);
  const sizeRef = useRef(120);
  const visibleRef = useRef(true);
  const sRef = useRef({ lx: 0, ly: 0, eh: 1, ew: 1, hp: 0, q: 9 });
  const physRef = useRef({ hy: 0, hv: 0, sq: 0, wig: 0, aS: 0, blink: 0, bT: -1, nextBlink: 1800 });
  const pokeRef = useRef<number[]>([]);
  const coolRef = useRef(0);
  const [bubble, setBubble] = useState<string | null>(null);
  const [shimmer, setShimmer] = useState(false);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastShimmer = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const lookActRef = useRef(lookAtActivity);
  lookActRef.current = lookAtActivity;

  const say = useCallback((text: string) => {
    setBubble(text);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), 3500);
  }, []);

  useEffect(() => () => { if (bubbleTimer.current) clearTimeout(bubbleTimer.current); }, []);

  const hop = useCallback((power: number) => {
    const p = physRef.current;
    if (p.hy < 0.01) p.hv = 0.92 * power;
  }, []);

  const poke = useCallback(() => {
    if (!live || calm) { say(POKE_PHRASES[0]); return; }
    noteInput();
    const now = performance.now();
    if (now < coolRef.current) return;
    const w = pokeRef.current.filter((t) => now - t < 2200);
    w.push(now);
    pokeRef.current = w;
    if (w.length < 3) {
      hop(1);
      say(POKE_PHRASES[(w.length - 1) % POKE_PHRASES.length]);
    } else if (w.length < 5) {
      hop(1);
      physRef.current.wig = 1;
      say(POKE_MANY);
    } else {
      hop(0.6);
      physRef.current.wig = 2.2;
      say(POKE_TOO_MANY);
      pokeRef.current = [];
      coolRef.current = now + 6000;
    }
  }, [live, calm, hop, say]);

  // Measure box for size-relative physics.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { sizeRef.current = el.clientWidth || 120; });
    sizeRef.current = el.clientWidth || 120;
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track on-screen visibility; the shared loop skips hidden slots.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !live) return;
    const io = new IntersectionObserver(([e]) => { visibleRef.current = e.isIntersecting; }, { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [live]);

  // Shared single-rAF-loop tick. All motion is transform/attribute based;
  // no React state updates per frame.
  useEffect(() => {
    if (!live) return;
    const body = bodyRef.current, ant = antRef.current, look = lookRef.current;
    const eyeL = eyeLRef.current, eyeR = eyeRRef.current;
    const arcL = arcLRef.current, arcR = arcRRef.current;
    const mouth = mouthRef.current, glow = glowRef.current;
    if (!body || !look || !eyeL || !eyeR || !mouth) return;
    let last = performance.now();
    const unsub = subscribeLoop((now) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      const size = sizeRef.current || 120;
      const st = stateRef.current;
      const S = sRef.current, P = physRef.current;
      // Look target, pose per agent state (timing ported from the prototype).
      let tx = 0, ty = 0, eh = 1, ew = 1, hp = 0, q = 9, antAmp = 0, sag = 0;
      if (!calm) {
        const m = cursorNow();
        if (m) {
          const r = rootRef.current?.getBoundingClientRect();
          if (r && r.width > 0) {
            const cx = r.left + r.width / 2, cy = r.top + r.height * 0.48;
            tx = Math.max(-1, Math.min(1, (m.x - cx) / 90)) * 7;
            ty = Math.max(-1, Math.min(1, (m.y - cy) / 90)) * 5;
          }
        }
        if (lookActRef.current) { tx = 7; ty = -1; }
      }
      if (st === "listening") { eh = 1.16; ew = 1.1; q = 8; }
      if (st === "running") {
        if (!calm) { tx = Math.sin(now * 0.0013) * 6; ty = -5; }
        q = 6; antAmp = Math.sin(now * 0.011) * 1.6;
      }
      if (st === "waiting") { tx = calm ? tx : 7; ty = -1; eh = 1.08; q = 5; }
      if (st === "verified") { hp = Math.max(hp, 1); q = 15; }
      if (st === "blocked") { if (!calm) tx *= 0.3; ty = 5; eh = 0.78; q = -7; sag = 1; }
      if (st === "idle" && now - lastInputAt() > 60000) { eh = 0.42; q = 4; ty = 3; if (calm) tx = 0; }
      if (!calm && perkedNow()) { eh = Math.max(eh, 1.08); }
      if (st === "waiting" && !calm && P.hy < 0.01) {
        const b = Math.floor(now / 1500);
        if (b !== (P as { bnc?: number }).bnc) { (P as { bnc?: number }).bnc = b; hop(0.28); }
      }
      // Blink every 3-6s.
      if (now > P.nextBlink && P.bT < 0) { P.bT = now; P.nextBlink = now + 3000 + Math.random() * 3000; }
      P.blink = 0;
      if (P.bT >= 0) { const bp = (now - P.bT) / 150; if (bp >= 1) P.bT = -1; else P.blink = Math.sin(Math.PI * bp); }
      const kk = calm ? 1 : 1 - Math.pow(0.0009, dt);
      S.lx += (tx - S.lx) * kk; S.ly += (ty - S.ly) * kk;
      S.eh += (eh - S.eh) * kk; S.ew += (ew - S.ew) * kk;
      S.hp += (hp - S.hp) * kk; S.q += (q - S.q) * kk;
      const eOpen = Math.max(0.06, S.eh * (1 - P.blink));
      look.setAttribute("transform", `translate(${S.lx.toFixed(2)} ${S.ly.toFixed(2)})`);
      const es = `scale(${S.ew.toFixed(3)} ${eOpen.toFixed(3)})`;
      eyeL.setAttribute("transform", es);
      eyeR.setAttribute("transform", es);
      const hw = g.smile.w * 50;
      mouth.setAttribute("d", `M${-hw} 0Q0 ${S.q} ${hw} 0`);
      const h = Math.min(1, S.hp);
      if (arcL && arcR) { arcL.setAttribute("opacity", h.toFixed(2)); arcR.setAttribute("opacity", h.toFixed(2)); }
      const pillOp = (1 - h).toFixed(2);
      eyeL.firstElementChild?.setAttribute("opacity", pillOp);
      eyeR.firstElementChild?.setAttribute("opacity", pillOp);
      if (glow) glow.setAttribute("opacity", (0.5 + 0.12 * Math.sin(now * 0.00175)).toFixed(3));
      // Body physics (fractions of width; prototype timing at 520px).
      P.hv -= 3.65 * dt; P.hy += P.hv * dt;
      if (P.hy <= 0) { if (P.hv < -0.23) P.sq = Math.min(1, -P.hv / 1.0); P.hy = 0; P.hv = 0; }
      P.sq = Math.max(0, P.sq - dt * 5);
      P.wig = Math.max(0, P.wig - dt * 1.6);
      const br = calm ? 0 : Math.sin(now * 0.00175);
      const wob = calm ? 0 : Math.sin(now * 0.03) * 4 * P.wig;
      const lean = calm ? 0 : S.lx * 0.5 * (size / 520);
      const sy = 1 + 0.012 * br - 0.07 * P.sq - 0.012 * sag;
      const sx = 1 - 0.006 * br + 0.05 * P.sq;
      body.style.transform =
        `translate(${lean.toFixed(2)}px,${(-P.hy * size).toFixed(2)}px) rotate(${(wob + (calm ? 0 : S.lx * 0.12)).toFixed(2)}deg) scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
      // Lagged antenna sway.
      if (ant) {
        const aT = (calm ? 0 : Math.sin(now * 0.0016) * 0.8) - S.lx * 0.2 - (P.hv * 520) * 0.002 + antAmp * 0.7;
        P.aS += (aT - P.aS) * (calm ? 1 : 1 - Math.pow(0.02, dt));
        ant.style.transform = `rotate(${P.aS.toFixed(2)}deg)`;
      }
      // Rare crystal shimmer for the armored variant, only while visible.
      if (variant === "warden" && !calm) {
        if (now - lastShimmer.current > 7000) { lastShimmer.current = now; setShimmer(true); setTimeout(() => setShimmer(false), 900); }
      }
    }, () => visibleRef.current);
    return unsub;
  }, [live, calm, variant, hop]);

  const ex = (f: number) => (f * 100).toFixed(2);
  const eyeW = (v: number) => ex(v);
  const bodyAspect = g.aspect;
  const showBub = showBubble && bubble;

  const face = (
    <svg
      className="cp-face" viewBox="0 0 100 100" preserveAspectRatio="none"
      aria-hidden="true" data-testid="companion-face"
    >
      <ellipse ref={glowRef} cx={ex(g.smile.x)} cy={ex((g.eyeL.y + g.eyeR.y) / 2)} rx="24" ry="17" fill="url(#cpGlow)" opacity="0.5" />
      <defs>
        <radialGradient id="cpGlow">
          <stop offset="0%" stopColor="#ffcf8f" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffcf8f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g ref={lookRef} data-testid="companion-look">
        <g transform={`translate(${ex(g.eyeL.x)} ${ex(g.eyeL.y)})`}>
          <g ref={eyeLRef} className={live ? undefined : "cp-cssblink"}>
            <rect x={-g.eyeL.w * 50} y={-g.eyeL.h * 50} width={eyeW(g.eyeL.w)} height={ex(g.eyeL.h)} rx={eyeW(g.eyeL.w / 2)} fill={GLOW} data-testid="companion-eye" />
            <path ref={arcLRef} d={`M${-g.eyeL.w * 50} 2Q0 ${-g.eyeL.h * 55} ${g.eyeL.w * 50} 2`} fill="none" stroke={GLOW} strokeWidth="4" strokeLinecap="round" opacity="0" />
          </g>
        </g>
        <g transform={`translate(${ex(g.eyeR.x)} ${ex(g.eyeR.y)})`}>
          <g ref={eyeRRef} className={live ? undefined : "cp-cssblink"}>
            <rect x={-g.eyeR.w * 50} y={-g.eyeR.h * 50} width={eyeW(g.eyeR.w)} height={ex(g.eyeR.h)} rx={eyeW(g.eyeR.w / 2)} fill={GLOW} />
            <path ref={arcRRef} d={`M${-g.eyeR.w * 50} 2Q0 ${-g.eyeR.h * 55} ${g.eyeR.w * 50} 2`} fill="none" stroke={GLOW} strokeWidth="4" strokeLinecap="round" opacity="0" />
          </g>
        </g>
        <g transform={`translate(${ex(g.smile.x)} ${ex(g.smile.y)})`}>
          <path ref={mouthRef} d={`M${-g.smile.w * 50} 0Q2 18 ${g.smile.w * 50} 0`} fill="none" stroke={GLOW} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );

  const patches = (
    <>
      {[g.eyeL, g.eyeR].map((e, i) => (
        <span key={i} className="cp-patch" aria-hidden="true" style={{
          left: `${(e.x - e.w * 0.61) * 100}%`, top: `${(e.y - e.h * 0.56) * 100}%`,
          width: `${e.w * 1.22 * 100}%`, height: `${e.h * 1.12 * 100}%`, background: FELT,
        }} />
      ))}
      <span className="cp-patch" aria-hidden="true" style={{
        left: `${(g.smile.x - g.smile.w * 0.65) * 100}%`, top: `${(g.smile.y - 0.045) * 100}%`,
        width: `${g.smile.w * 1.3 * 100}%`, height: "9%", background: FELT,
      }} />
    </>
  );

  const body = (
    <div ref={bodyRef} className="cp-body" data-testid="companion-body">
      <Image className="cp-base" src={BODY_SRC[variant]} alt="" width={520} height={Math.round(520 / bodyAspect)} priority={false} draggable={false} />
      <div ref={antRef} className={`cp-ant cp-ant-${variant}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BODY_SRC[variant]} alt="" draggable={false} />
      </div>
      {patches}
      {face}
      {variant === "warden" ? (
        <span className={`cp-shimmer${shimmer ? " on" : ""}`} aria-hidden="true" />
      ) : null}
    </div>
  );

  if (!live) {
    // Static pose: blink only via CSS, no tracking, hops, or shimmer.
    return (
      <div ref={rootRef} className={`companion companion-static ${className}`} data-variant={variant} aria-hidden="true">
        {showBub ? <div className="cp-bubble" role="status">{bubble}</div> : null}
        {body}
      </div>
    );
  }

  if (!interactive) {
    return (
      <div ref={rootRef} className={`companion${entrance ? " cp-enter" : ""} ${className}`} data-variant={variant} aria-hidden="true">
        {showBub ? <div className="cp-bubble" role="status">{bubble}</div> : null}
        {body}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`companion${entrance ? " cp-enter" : ""} ${className}`} data-variant={variant}>
      {showBub ? <div className="cp-bubble" role="status">{bubble}</div> : null}
      <button
        type="button" className="cp-btn" onClick={poke}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); poke(); } }}
        aria-label={label} data-testid="companion-poke"
      >
        {body}
      </button>
    </div>
  );
}
