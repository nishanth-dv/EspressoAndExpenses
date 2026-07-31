const FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const FMT_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function agoLabel(seconds, now = Date.now()) {
  const days = Math.floor((now - seconds * 1000) / 86400000);
  if (days < 0) return "just now";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function whenLabel(seconds, intraday = false) {
  if (!seconds) return "";
  const d = new Date(seconds * 1000);
  return `${(intraday ? FMT_TIME : FMT).format(d)} · ${agoLabel(seconds)}`;
}
