// app/admin/generate-bills/useGenieMorph.js
//
// The morph engine behind the Generate button and the Verify overlay.
//
// ## The pixel-shift bug, and why this fixes it
//
// The naive way to make a panel grow out of a button is to animate its
// left/top/width/height from the button's rect to the panel's rect. Every one
// of those four properties is a LAYOUT property. Changing them forces the
// browser to re-run layout, then paint, then composite, on every single frame.
// On a 31-row grid that is a reflow of the whole table 60 times a second, and
// it shows up as text jittering by a pixel as sub-pixel widths round
// differently frame to frame.
//
// This module never touches a layout property. The panel is rendered at its
// FINAL size immediately, then pushed back to the button's position and size
// using only `transform: translate() scale()` and `opacity`. Both are
// composited on the GPU. Layout runs exactly once, before the first frame.
//
// We measure with getBoundingClientRect once, compute the delta, and let the
// compositor do the rest. This is the FLIP technique, restricted to transform
// and opacity only.
//
// GSAP is used for the timeline sequencing and easing, not for the maths.

import { useCallback, useRef } from "react";
import { gsap } from "gsap";

/** Respect the OS setting. Motion sickness is not a design preference. */
function reducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Compute the transform that visually places `target` exactly on top of
 * `origin`, without moving `target` in the layout tree.
 */
function deltaTransform(originRect, targetRect) {
  const scaleX = Math.max(0.02, originRect.width / targetRect.width);
  const scaleY = Math.max(0.02, originRect.height / targetRect.height);

  // Transform origin is the centre, so we align centres.
  const originCx = originRect.left + originRect.width / 2;
  const originCy = originRect.top + originRect.height / 2;
  const targetCx = targetRect.left + targetRect.width / 2;
  const targetCy = targetRect.top + targetRect.height / 2;

  return {
    x: originCx - targetCx,
    y: originCy - targetCy,
    scaleX,
    scaleY,
  };
}

export function useGenieMorph() {
  const tlRef = useRef(null);

  /**
   * seed -> stretch -> open
   *
   * Three beats, deliberately not one. A single scale from a button to a full
   * panel reads as a zoom, which feels cheap. The genie reads as an object
   * being pulled out of another object because the two axes are decoupled:
   *
   *   1. SEED    the panel appears at the button, slightly squashed
   *   2. STRETCH it grows along X first, becoming a bar
   *   3. OPEN    it grows along Y into the full panel while contents fade up
   *
   * Y lags X by ~120ms. That lag is the entire illusion.
   */
  const openFrom = useCallback((originEl, panelEl, opts = {}) => {
    if (!originEl || !panelEl) return Promise.resolve();

    const {
      contentSelector = "[data-genie-content]",
      staggerSelector = "[data-genie-stagger]",
      onComplete,
    } = opts;

    if (tlRef.current) tlRef.current.kill();

    const originRect = originEl.getBoundingClientRect();
    const targetRect = panelEl.getBoundingClientRect();
    const d = deltaTransform(originRect, targetRect);

    const content = panelEl.querySelector(contentSelector);
    const staggerItems = panelEl.querySelectorAll(staggerSelector);

    if (reducedMotion()) {
      gsap.set(panelEl, { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 });
      if (content) gsap.set(content, { opacity: 1, y: 0 });
      if (staggerItems.length) gsap.set(staggerItems, { opacity: 1, y: 0 });
      onComplete?.();
      return Promise.resolve();
    }

    // will-change is set only for the duration of the animation. Leaving it on
    // permanently pins a compositor layer per element and costs more VRAM than
    // it saves.
    gsap.set(panelEl, {
      transformOrigin: "50% 50%",
      willChange: "transform, opacity",
      x: d.x,
      y: d.y,
      scaleX: d.scaleX,
      scaleY: d.scaleY,
      opacity: 0,
      force3D: true,
    });
    if (content) gsap.set(content, { opacity: 0, y: 8, force3D: true });
    if (staggerItems.length) {
      gsap.set(staggerItems, { opacity: 0, y: 10, force3D: true });
    }

    return new Promise((resolve) => {
      const tl = gsap.timeline({
        defaults: { force3D: true },
        onComplete: () => {
          // Drop the compositor hint and clear the transform so the panel goes
          // back to being a plain laid-out element. Anything measured after
          // this point (focus rings, scrollIntoView) behaves normally.
          gsap.set(panelEl, { willChange: "auto", clearProps: "transform" });
          onComplete?.();
          resolve();
        },
      });
      tlRef.current = tl;

      // 1. SEED
      tl.to(panelEl, { opacity: 1, duration: 0.12, ease: "none" }, 0);

      // 2. STRETCH along X
      tl.to(
        panelEl,
        {
          x: 0,
          scaleX: 1,
          duration: 0.42,
          ease: "power3.out",
        },
        0,
      );

      // 3. OPEN along Y, lagging X. back.out gives the faint overshoot that
      //    makes it feel physical rather than linear.
      tl.to(
        panelEl,
        {
          y: 0,
          scaleY: 1,
          duration: 0.5,
          ease: "back.out(1.25)",
        },
        0.12,
      );

      if (content) {
        tl.to(
          content,
          { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" },
          0.32,
        );
      }

      if (staggerItems.length) {
        tl.to(
          staggerItems,
          {
            opacity: 1,
            y: 0,
            duration: 0.34,
            ease: "power2.out",
            // Cap the total stagger window. With 31 rows a fixed per-item
            // delay would take 2.4s; `amount` spreads them across 0.4s
            // regardless of count, so 31 flats and 300 flats feel identical.
            stagger: { amount: Math.min(0.4, staggerItems.length * 0.012) },
          },
          0.34,
        );
      }
    });
  }, []);

  /** The same motion played backwards, slightly faster. Exits should be quicker than entrances. */
  const closeTo = useCallback((originEl, panelEl, opts = {}) => {
    if (!originEl || !panelEl) return Promise.resolve();
    const { contentSelector = "[data-genie-content]", onComplete } = opts;

    if (tlRef.current) tlRef.current.kill();

    const originRect = originEl.getBoundingClientRect();
    const targetRect = panelEl.getBoundingClientRect();
    const d = deltaTransform(originRect, targetRect);
    const content = panelEl.querySelector(contentSelector);

    if (reducedMotion()) {
      onComplete?.();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const tl = gsap.timeline({
        defaults: { force3D: true },
        onComplete: () => {
          gsap.set(panelEl, { willChange: "auto" });
          onComplete?.();
          resolve();
        },
      });
      tlRef.current = tl;

      gsap.set(panelEl, { willChange: "transform, opacity" });

      if (content) {
        tl.to(content, { opacity: 0, y: 6, duration: 0.14, ease: "power2.in" }, 0);
      }
      tl.to(
        panelEl,
        { y: d.y, scaleY: d.scaleY, duration: 0.3, ease: "power3.in" },
        0.06,
      );
      tl.to(
        panelEl,
        { x: d.x, scaleX: d.scaleX, duration: 0.28, ease: "power3.in" },
        0.14,
      );
      tl.to(panelEl, { opacity: 0, duration: 0.14, ease: "none" }, 0.3);
    });
  }, []);

  /**
   * Per-row status flash during verification.
   *
   * Only backgroundColor and transform are animated. Crucially we do NOT
   * animate height or padding, which is what would make the rows below shuffle
   * as each result lands.
   */
  const flashRow = useCallback((rowEl, status) => {
    if (!rowEl || reducedMotion()) return;
    const tint =
      status === "pass"
        ? "rgba(16, 185, 129, 0.18)"
        : status === "fail"
          ? "rgba(239, 68, 68, 0.18)"
          : "rgba(79, 70, 229, 0.14)";

    gsap
      .timeline()
      .fromTo(
        rowEl,
        { backgroundColor: tint },
        { backgroundColor: "rgba(0,0,0,0)", duration: 0.9, ease: "power2.out" },
        0,
      )
      .fromTo(
        rowEl,
        { x: status === "fail" ? -3 : 0 },
        {
          x: 0,
          duration: status === "fail" ? 0.45 : 0.3,
          ease: status === "fail" ? "elastic.out(1, 0.4)" : "power2.out",
        },
        0,
      );
  }, []);

  const kill = useCallback(() => {
    tlRef.current?.kill();
    tlRef.current = null;
  }, []);

  return { openFrom, closeTo, flashRow, kill };
}
