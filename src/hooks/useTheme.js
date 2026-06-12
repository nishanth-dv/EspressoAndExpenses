import { useState, useEffect, useCallback } from "react";

// Theme is the light/dark axis (existing behaviour).
// Skin is the visual treatment axis — "classic" (current look) or "glass"
// (iOS 26 Liquid-Glass-inspired translucent treatment). Both persist to
// localStorage and are reflected on <html> so CSS can target either axis
// independently.
export function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "dark",
  );
  const [skin, setSkin] = useState(
    () => localStorage.getItem("skin") || "classic",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-skin", skin);
    localStorage.setItem("skin", skin);
  }, [skin]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  // Preserve the original tuple signature so existing callers using
  // `const [theme, toggleTheme] = useTheme()` keep working. New callers
  // can also access `useTheme().skin` because functions / arrays in JS are
  // also objects — but cleaner to just expose extras via array indices.
  const result = [theme, toggleTheme, skin, setSkin];
  return result;
}
