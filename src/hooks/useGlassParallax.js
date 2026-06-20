import { useEffect } from "react";

// Glass surfaces whose specular hotspot should track the cursor. Mirrors the
// ::before selector list in glass.css.
const GLASS_SURFACE_SELECTOR = [
  ".summary-card",
  ".insight-card",
  ".inv-hero-card",
  ".inv-insight-card",
  ".inv-holding-card",
  ".sol-card-item",
  ".sol-commitment-item",
  ".sol-lending-item",
  ".sol-section",
  ".sol-hero-card",
  ".sol-stat-card",
  ".sol-emi-bill",
  ".pref-section",
  ".dash-section",
  ".dash-card",
].join(",");

// Mouse-tracking specular parallax. Mounted once near the app root: a single
// delegated pointermove glides each glass pane's glossy highlight (--gx/--gy)
// to follow the cursor, so the reflection slides realistically across the
// surface. Pure CSS-variable writes — no React re-renders, and a no-op unless
// the Glass skin is active. The @property tweens in glass.css ease the
// highlight back to rest when the pointer leaves a card.
export function useGlassParallax() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) return;

    let active = null;

    const clear = (el) => {
      if (!el) return;
      el.style.removeProperty("--gx");
      el.style.removeProperty("--gy");
    };

    const onMove = (e) => {
      if (root.getAttribute("data-skin") !== "glass") return;
      const card = e.target.closest?.(GLASS_SURFACE_SELECTOR) ?? null;
      if (card !== active) clear(active);
      active = card;
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      card.style.setProperty("--gx", `${x.toFixed(1)}%`);
      card.style.setProperty("--gy", `${y.toFixed(1)}%`);
    };

    const onLeave = () => {
      clear(active);
      active = null;
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", onLeave);

    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", onLeave);
      clear(active);
    };
  }, []);
}
