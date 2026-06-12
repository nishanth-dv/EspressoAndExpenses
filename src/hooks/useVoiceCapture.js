import { useCallback, useEffect, useRef, useState } from "react";

// Browser SpeechRecognition is webkit-prefixed on Safari (incl. iOS).
function getRecognitionClass() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// Detect the current platform once so error messages can be tailored to
// where the user actually is. iPadOS reports its UA as Macintosh — we
// distinguish via maxTouchPoints.
function detectPlatform() {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

const PLATFORM = detectPlatform();

// Platform-aware messages for the speech-API error codes. Each user only
// sees instructions relevant to the device they're actually using.
const ERROR_MESSAGES = {
  "not-allowed":
    PLATFORM === "ios"
      ? "Microphone access denied. Open Settings → Safari → Microphone to allow."
      : PLATFORM === "android"
        ? "Microphone access denied. Allow microphone for this site in your browser's site settings."
        : "Microphone access denied. Click the lock icon in the address bar and allow microphone for this site.",
  "service-not-allowed":
    PLATFORM === "android"
      ? "Speech recognition is disabled by this browser (Brave on Android blocks it by default). Try Chrome."
      : PLATFORM === "ios"
        ? "Speech recognition isn't available. Make sure Dictation is enabled in iOS Settings."
        : "Speech recognition is disabled by this browser. Try Chrome or Edge.",
  "no-speech": "Didn't catch that — try again.",
  "audio-capture": "No microphone detected.",
  network: "Speech recognition needs an internet connection.",
  aborted: "Voice capture cancelled.",
  "language-not-supported": "Language not supported by your browser.",
};

const STARTUP_TIMEOUT_MESSAGE =
  PLATFORM === "ios"
    ? "Mic didn't start. Enable Settings → General → Keyboard → Dictation, then allow microphone for this site."
    : PLATFORM === "android"
      ? "Mic didn't start. Some Android browsers (like Brave) block speech recognition — try Chrome."
      : "Mic didn't start. Check your browser's microphone permission for this site.";

const SILENT_FAILURE_MESSAGE =
  PLATFORM === "desktop"
    ? "Couldn't start the mic. Check the browser's site permissions."
    : "This browser blocked the mic. Try Chrome or Safari.";

// Single-shot speech capture. Caller passes `enabled` (the user's
// voice-add preference), `onResult({transcript, name, amount})`, and
// optionally `onError(message)` to surface failures (e.g. via a toast).
export function useVoiceCapture({ enabled, onResult, onError }) {
  const RecognitionClass = getRecognitionClass();
  const supported = !!RecognitionClass && enabled;
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore — recognition may have already ended
    }
    setListening(false);
  }, []);

  const startupTimerRef = useRef(null);

  const start = useCallback(() => {
    if (!supported || listening) return;
    const r = new RecognitionClass();
    r.lang = "en-IN";
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;

    // Optimistically flip the UI so the user sees the mic pulse immediately.
    // If onstart doesn't fire within 1.5s, the browser silently rejected us
    // (iOS Safari can do this if Dictation is off or site permission isn't
    // granted) — surface that as an error instead of a stuck pulse.
    setListening(true);
    clearTimeout(startupTimerRef.current);
    startupTimerRef.current = setTimeout(() => {
      try {
        r.abort();
      } catch {
        // ignore
      }
      setListening(false);
      onError?.(STARTUP_TIMEOUT_MESSAGE);
    }, 1500);

    r.onstart = () => {
      clearTimeout(startupTimerRef.current);
    };
    r.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      onResult?.({ transcript });
    };
    r.onerror = (event) => {
      clearTimeout(startupTimerRef.current);
      setListening(false);
      const code = event?.error ?? "unknown";
      // "aborted" fires when we call abort() above — already surfaced via the
      // timeout, don't double-toast.
      if (code === "aborted") return;
      onError?.(ERROR_MESSAGES[code] ?? `Voice capture failed: ${code}`);
    };
    r.onend = () => {
      clearTimeout(startupTimerRef.current);
      setListening(false);
    };
    recognitionRef.current = r;
    try {
      r.start();
    } catch (err) {
      clearTimeout(startupTimerRef.current);
      setListening(false);
      onError?.(err?.message ?? SILENT_FAILURE_MESSAGE);
    }
  }, [supported, listening, RecognitionClass, onResult, onError]);

  useEffect(() => () => stop(), [stop]);

  return { supported, listening, start, stop };
}
