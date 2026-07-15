// Calendar event generator.
//
// Like the notification engine, calendar events are DERIVED from existing data
// — nothing new is stored. We expand each recurring source (card dues, EMIs,
// subscription renewals, SIP debits, LIC premiums, auto-deduct contributions)
// into its occurrences across a horizon, reconcile each against the ledger to
// mark it Paid / Due / Overdue, then add fixed-income maturities, note
// reminders and the actual ledger (the "spending" half).

import { isBilling, nextRenewal } from "./subscriptionUtils";
import { getUpcomingMaturities } from "./investmentUtils";
import { getCardDue } from "./solvencyUtils";

const DAY = 86_400_000;

// Local YYYY-MM-DD key for a date or ISO string.
export function dayKey(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function clampDay(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

// Monthly occurrences of a day-of-month within [from, to].
function monthlyOccurrences(day, from, to) {
  const d = parseInt(day, 10);
  if (!d) return [];
  const out = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    const occ = clampDay(cursor.getFullYear(), cursor.getMonth(), d);
    if (occ >= from && occ <= to) out.push(occ);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return out;
}

// Occurrences every `interval` months, anchored to `startDate`'s month.
function periodicOccurrences(startDate, day, interval, from, to) {
  const anchor = startDate ? new Date(startDate) : from;
  const anchorAbs = anchor.getFullYear() * 12 + anchor.getMonth();
  const out = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    const abs = cursor.getFullYear() * 12 + cursor.getMonth();
    if ((((abs - anchorAbs) % interval) + interval) % interval === 0) {
      const occ = clampDay(cursor.getFullYear(), cursor.getMonth(), day);
      if (occ >= from && occ <= to) out.push(occ);
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return out;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function autoDeductAmount(inv) {
  for (const k of [
    "monthlyContribution",
    "monthlyAmount",
    "monthlyPremium",
    "premiumAmount",
    "contributionAmount",
  ]) {
    const v = parseFloat(inv[k]);
    if (v > 0) return v;
  }
  return null;
}

function txIcon(type) {
  if (type === "income") return "fa-arrow-down";
  if (type === "investment") return "fa-seedling";
  if (type === "self_transfer") return "fa-arrow-right-arrow-left";
  return "fa-arrow-up";
}

export function deriveCalendarEvents(data, prefs, now = new Date()) {
  if (!data) return [];
  const events = [];
  const today = startOfDay(now);
  const forwardTo = new Date(today.getFullYear(), today.getMonth() + 13, 0);
  // The whole calendar is TODAY-forward — obligations, reminders and the actual
  // ledger alike never surface a past date. This also means a bill can never
  // read as a false "overdue".
  const schedFrom = today;

  const cards = data.cards ?? [];
  const commitments = data.commitments ?? [];
  const subscriptions = data.subscriptions ?? [];
  const investments = data.investments ?? [];
  const transactions = data.transactions ?? [];
  const notes = data.notes ?? [];

  // Ledger reconciliation index: `${sourceId}:${YYYY-MM}` for every payment
  // linked to a card / commitment / subscription / investment. Source ids are
  // UUIDs so one flat set works regardless of which link field carried it.
  const paidIndex = new Set();
  for (const t of transactions) {
    const id =
      t.repaymentFor ||
      t.subscriptionId ||
      t.sipInvestmentId ||
      t.licPolicyId ||
      t.autoDeductInvestmentId;
    if (id) paidIndex.add(`${id}:${monthKey(t.occurredAt)}`);
  }
  // An occurrence is Paid when a linked payment lands in its month. `matchIds`
  // lets an obligation reconcile against several ids — e.g. a card-funded EMI is
  // settled by paying the card, so it must also match its cardId. This mirrors
  // solvencyUtils' commitmentPaidThisMonth (the single source of truth).
  const statusFor = (occ, ids) => {
    const mk = monthKey(occ);
    for (const id of ids) {
      if (id && paidIndex.has(`${id}:${mk}`)) return "paid";
    }
    return startOfDay(occ) < today ? "overdue" : "due";
  };

  const pushObligation = (sourceId, occ, base) => {
    const { matchIds, ...rest } = base;
    events.push({
      id: `${rest.tag}:${sourceId}:${dayKey(occ)}`,
      date: occ.toISOString(),
      status: statusFor(occ, matchIds ?? [sourceId]),
      ...rest,
    });
  };

  // ── Credit-card payment due days ──
  // getCardDue is the single source of truth: null means the statement is
  // settled, so this cycle's payment must NOT surface as due. A non-null result
  // carries the outstanding amount + due date for the current cycle.
  const nowMonth = monthKey(now);
  for (const card of cards) {
    if (!card.dueDay || card.archived) continue;
    const info = getCardDue(card, transactions, commitments, now);
    const dueMonth = info?.dueDate ? monthKey(info.dueDate) : null;
    for (const occ of monthlyOccurrences(card.dueDay, schedFrom, forwardTo)) {
      const om = monthKey(occ);
      // Current statement is fully paid → skip this cycle's due entirely.
      if (!info && om === nowMonth) continue;
      pushObligation(card.id, occ, {
        kind: "obligation",
        tag: "card",
        title: `${card.name} payment`,
        amount: dueMonth === om ? num(info?.amount) : null,
        severity: "warn",
        icon: "fa-credit-card",
        hint: "Interest-free if paid in full by the due date",
        href: `/Solvency?highlight=${card.id}&focus=card`,
      });
    }
  }

  // ── EMI / rent / insurance and other fixed-date commitments ──
  for (const c of commitments) {
    if (!c.dueDay || c.archived || c.closed) continue;
    for (const occ of monthlyOccurrences(c.dueDay, schedFrom, forwardTo)) {
      pushObligation(c.id, occ, {
        kind: "obligation",
        tag: "commit",
        title: c.name || "Commitment",
        amount: num(c.emiAmount),
        severity: "warn",
        icon: "fa-file-invoice-dollar",
        // A card-funded EMI is settled by paying its card — reconcile both.
        matchIds: [c.id, c.cardId],
        href: `/Solvency?highlight=${c.id}&focus=commitment`,
      });
    }
  }

  // ── Subscription renewals ──
  for (const sub of subscriptions) {
    if (!isBilling(sub)) continue;
    let occ = nextRenewal(sub, schedFrom);
    let guard = 0;
    while (occ && occ <= forwardTo && guard < 80) {
      pushObligation(sub.id, occ, {
        kind: "obligation",
        tag: "sub",
        title: `${sub.name} renews`,
        amount: num(sub.amount),
        severity: "info",
        icon: "fa-rotate",
        href: `/Subscriptions?highlight=${sub.id}`,
      });
      occ = nextRenewal(sub, new Date(occ.getTime() + DAY));
      guard += 1;
    }
  }

  // ── Investment schedules — SIP debits, LIC premiums, auto-deduct ──
  for (const inv of investments) {
    if (inv.inHistory) continue;

    if (inv.type === "sip" && !inv.paused) {
      const day =
        parseInt(inv.sipDay, 10) ||
        (inv.startDate ? new Date(inv.startDate).getDate() : 1);
      for (const occ of monthlyOccurrences(day, schedFrom, forwardTo)) {
        pushObligation(inv.id, occ, {
          kind: "obligation",
          tag: "sip",
          title: `${inv.name} SIP`,
          amount: num(inv.monthlyAmount),
          severity: "info",
          icon: "fa-seedling",
          href: `/Invest?highlight=${inv.id}`,
        });
      }
    } else if (
      inv.type === "lic" &&
      Array.isArray(inv.premiumMonths) &&
      inv.premiumMonths.length
    ) {
      if (inv.surrendered || inv.matured) continue;
      const startDay = inv.startDate ? new Date(inv.startDate).getDate() : 1;
      for (let y = schedFrom.getFullYear(); y <= forwardTo.getFullYear(); y++) {
        for (const pm of inv.premiumMonths) {
          const occ = clampDay(y, pm - 1, startDay);
          if (occ >= schedFrom && occ <= forwardTo) {
            pushObligation(inv.id, occ, {
              kind: "obligation",
              tag: "lic",
              title: `${inv.name} premium`,
              amount: num(inv.premiumAmount),
              severity: "warn",
              icon: "fa-shield-halved",
              href: `/Invest?highlight=${inv.id}`,
            });
          }
        }
      }
    } else if (inv.autoDeduct?.enabled && !inv.paused) {
      const freq = inv.autoDeduct.frequency || "monthly";
      const interval =
        freq === "yearly" ? 12 : freq === "halfyearly" ? 6 : freq === "quarterly" ? 3 : 1;
      const day =
        parseInt(inv.autoDeduct.dayOfMonth, 10) ||
        (inv.startDate ? new Date(inv.startDate).getDate() : 1);
      const amount = autoDeductAmount(inv);
      const occs =
        interval === 1
          ? monthlyOccurrences(day, schedFrom, forwardTo)
          : periodicOccurrences(inv.startDate, day, interval, schedFrom, forwardTo);
      for (const occ of occs) {
        pushObligation(inv.id, occ, {
          kind: "obligation",
          tag: "auto",
          title: `${inv.name} contribution`,
          amount,
          severity: "info",
          icon: "fa-handshake-angle",
          href: `/Invest?highlight=${inv.id}`,
        });
      }
    }
  }

  // ── Indian tax calendar (fixed FY dates, future only) ──
  const taxAdd = (date, title, icon, href) => {
    if (date < today || date > forwardTo) return;
    events.push({
      id: `tax:${title}:${date.getFullYear()}`,
      date: date.toISOString(),
      kind: "tax",
      status: "due",
      title,
      amount: null,
      severity: "info",
      icon,
      href,
    });
  };
  for (let y = today.getFullYear(); y <= forwardTo.getFullYear(); y++) {
    taxAdd(new Date(y, 5, 15), "Advance tax · Q1 (15%)", "fa-landmark", "/Solvency");
    taxAdd(new Date(y, 8, 15), "Advance tax · Q2 (45%)", "fa-landmark", "/Solvency");
    taxAdd(new Date(y, 11, 15), "Advance tax · Q3 (75%)", "fa-landmark", "/Solvency");
    taxAdd(new Date(y, 2, 15), "Advance tax · Q4 (100%)", "fa-landmark", "/Solvency");
    taxAdd(new Date(y, 2, 31), "80C investment deadline", "fa-receipt", "/Invest");
    taxAdd(new Date(y, 6, 31), "ITR filing due", "fa-file-invoice", "/Solvency");
  }

  // ── Fixed-income maturities ──
  for (const m of getUpcomingMaturities(investments)) {
    events.push({
      id: `maturity:${m.inv.id}`,
      date: m.maturity.toISOString(),
      kind: "maturity",
      status: "due",
      title: `${m.inv.name} matures`,
      amount: num(m.inv.maturityAmount),
      severity: "info",
      icon: "fa-flag-checkered",
      href: `/Invest?highlight=${m.inv.id}`,
    });
  }

  // ── Note reminders (today forward only) ──
  for (const note of notes) {
    if (!note.remindAt || note.archivedAt) continue;
    const d = new Date(note.remindAt);
    if (Number.isNaN(d.getTime()) || startOfDay(d) < today || d > forwardTo)
      continue;
    const label =
      (note.title || "").trim() ||
      (note.body || "").split("\n").find((l) => l.trim()) ||
      "Reminder";
    events.push({
      id: `note:${note.id}`,
      date: note.remindAt,
      kind: "reminder",
      status: startOfDay(d) < today ? "overdue" : "due",
      title: label.replace(/\*\*|~~/g, "").slice(0, 60),
      amount: null,
      severity: "info",
      icon: "fa-bell",
      href: `/Dashboard?note=${note.id}`,
    });
  }

  // ── Actual ledger (today forward only — no past spending) ──
  for (const t of transactions) {
    if (!t.occurredAt) continue;
    const d = new Date(t.occurredAt);
    if (Number.isNaN(d.getTime()) || startOfDay(d) < today || d > forwardTo)
      continue;
    const type = t.transactionType;
    events.push({
      id: `tx:${t.id}`,
      date: t.occurredAt,
      kind: "actual",
      txType: type,
      title:
        t.name ||
        t.source ||
        (type === "investment" ? "Investment" : "Transaction"),
      subtitle: t.category ?? null,
      amount: parseFloat(t.amount) || 0,
      status: "actual",
      severity: "info",
      icon: txIcon(type),
      href: null,
    });
  }

  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return events;
}

// Split forward events into agenda buckets relative to `now`. Actuals and
// already-paid obligations are excluded — the agenda is what still needs doing.
export function agendaBuckets(events, now = new Date()) {
  const today = startOfDay(now);
  const weekEnd = new Date(today.getTime() + 7 * DAY);
  const buckets = { overdue: [], today: [], week: [], later: [] };
  for (const e of events) {
    if (e.kind === "actual" || e.status === "paid") continue;
    const d = startOfDay(e.date);
    if (d < today) buckets.overdue.push(e);
    else if (d.getTime() === today.getTime()) buckets.today.push(e);
    else if (d < weekEnd) buckets.week.push(e);
    else buckets.later.push(e);
  }
  return buckets;
}

// Events on a given calendar day (local).
export function eventsOnDay(events, date) {
  const key = dayKey(date);
  return events.filter((e) => dayKey(e.date) === key);
}

// Per-day summary for the month grid: pending markers + spend intensity.
// `busy` flags a day carrying several unpaid obligations (a pile-up).
export function monthDayIndex(events) {
  const map = new Map();
  for (const e of events) {
    const key = dayKey(e.date);
    if (!key) continue;
    let entry = map.get(key);
    if (!entry) {
      entry = { dots: [], spend: 0, obligations: 0 };
      map.set(key, entry);
    }
    if (e.kind === "actual") {
      if (e.txType === "expense") entry.spend += e.amount || 0;
    } else if (e.status !== "paid") {
      entry.dots.push({ kind: e.kind, severity: e.severity });
      if (e.kind === "obligation") entry.obligations += 1;
    }
  }
  for (const entry of map.values()) entry.busy = entry.obligations >= 3;
  return map;
}

// The 6-week grid (Mon-first) covering `monthCursor`'s month.
export function monthMatrix(monthCursor) {
  const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(first);
  start.setDate(1 - offset);
  const weeks = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

// Count + known total of obligations in a bucket (for the "busy week" heads-up).
export function bucketLoad(items) {
  let total = 0;
  let count = 0;
  for (const e of items) {
    if (e.kind === "actual" || e.status === "paid") continue;
    count += 1;
    if (e.amount) total += e.amount;
  }
  return { count, total };
}

// Projected balance drawdown over the next `days` days: start from the current
// balance and subtract each unpaid obligation on its day. Conservative — it
// does NOT add expected income, so it reads as "runway before any new income".
export function runwaySeries(events, startBalance, days = 45, now = new Date()) {
  const today = startOfDay(now);
  const byOffset = new Array(days + 1).fill(0);
  for (const e of events) {
    if (e.kind === "actual" || e.kind === "maturity" || e.status === "paid") continue;
    if (!e.amount) continue;
    const off = Math.round((startOfDay(e.date).getTime() - today.getTime()) / DAY);
    if (off < 0 || off > days) continue;
    byOffset[off] += e.amount;
  }
  let bal = startBalance;
  const series = [];
  let min = startBalance;
  let firstNegative = null;
  for (let i = 0; i <= days; i++) {
    bal -= byOffset[i];
    const date = new Date(today.getTime() + i * DAY);
    series.push({ offset: i, date: date.toISOString(), balance: Math.round(bal), due: byOffset[i] });
    if (bal < min) min = bal;
    if (firstNegative == null && bal < 0) firstNegative = date.toISOString();
  }
  return { series, min: Math.round(min), firstNegative, committed: Math.round(startBalance - bal) };
}

// Serialise the derived events to an iCal (.ics) string for import into Google
// / Apple Calendar. Actuals (past ledger) are skipped — obligations, reminders,
// maturities and tax dates export as events.
export function toICS(events) {
  const pad = (n) => String(n).padStart(2, "0");
  const esc = (s) =>
    String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const asDate = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
  };
  const asUTC = (d) => {
    const x = new Date(d);
    return (
      `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}` +
      `T${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}${pad(x.getUTCSeconds())}Z`
    );
  };
  const stamp = asUTC(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Espresso & Expenses//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const e of events) {
    if (e.kind === "actual") continue;
    let summary = e.title;
    if (e.amount) summary += ` (₹${Math.round(e.amount).toLocaleString("en-IN")})`;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.id}@espresso-expenses`);
    lines.push(`DTSTAMP:${stamp}`);
    if (e.kind === "reminder") {
      lines.push(`DTSTART:${asUTC(e.date)}`);
    } else {
      const start = asDate(e.date);
      const end = new Date(new Date(e.date).getTime() + DAY);
      lines.push(`DTSTART;VALUE=DATE:${start}`);
      lines.push(`DTEND;VALUE=DATE:${asDate(end)}`);
    }
    lines.push(`SUMMARY:${esc(summary)}`);
    if (e.hint) lines.push(`DESCRIPTION:${esc(e.hint)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
