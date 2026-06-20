import { useSyncExternalStore } from "react";

// Reactively tracks whether the Liquid-Glass skin is active (data-skin="glass"
// on <html>). Lets components opt their Framer Motion behaviour in/out without
// prop-drilling the skin — and means classic skin pays zero motion overhead.
function subscribe(callback) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-skin"],
  });
  return () => observer.disconnect();
}

function getSkin() {
  return document.documentElement.getAttribute("data-skin") || "classic";
}

export function useGlassActive() {
  return useSyncExternalStore(subscribe, getSkin, () => "classic") === "glass";
}
