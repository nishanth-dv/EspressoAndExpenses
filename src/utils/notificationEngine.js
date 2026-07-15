// Notification engine.
//
// Notifications are DERIVED, never stored: every reminder is a pure function of
// the user's existing data (cards, commitments, subscriptions, SIPs) + today's
// date. That single decision is what makes "auto-clear" free — an item simply
// stops being derived once its date passes, the obligation is met, or its
// source is removed. The only thing we persist is the user's explicit early
// dismissals (transactionData.notificationDismissals), which self-expire.
//
// Each derived notification carries a stable `id` (eventKey) of the form
//   `${type}:${sourceId}:${cycleKey}`
// so this cycle's reminder and next cycle's reminder are different keys — a
// dismissal silences only the current cycle and the reminder returns next time.

import {
  daysUntil,
  nextRenewal,
  isBilling,
  isCurrentCyclePosted,
  detectAnomaly,
  trialStatus,
} from "./subscriptionUtils";
import {
  calcInvestmentValues,
  resolveGrace,
  graceToDays,
  findAutoDeductAmount,
} from "./investmentUtils";
import { getInvestmentTypeSchema } from "./investmentTypeSchemas";
import { resolveLogMode } from "./loggingMode";
import { getCardDue } from "./solvencyUtils";
import { getPage } from "./pages";
import { runAdvisory } from "./advisory/engine";
import { mergeProfile } from "./advisory/profile";
import { isSuppressed } from "./advisory/state";

// ── Type registry ────────────────────────────────────────
// The single source of truth for what notifications exist. The Preferences
// panel renders a toggle per entry (grouped by `group`), and the engine skips
// any type the user has disabled. Adding a new reminder = one entry here + one
// branch in deriveNotifications.
//
// `defaultOn` is the out-of-the-box state; the user's per-type override in
// preferences.notificationTypes wins when present. `lead`/`grace` are the
// look-ahead and post-due windows (days) for date-based reminders.
export const NOTIFICATION_TYPES = [
  {
    key: "cardDue",
    group: "obligations",
    label: "Credit-card payment due",
    hint: "Reminds you a week before each card's payment due date.",
    icon: "fa-credit-card",
    defaultOn: true,
    lead: 7,
    grace: 2,
  },
  {
    key: "commitmentDue",
    group: "obligations",
    label: "EMI · rent · insurance due",
    hint: "Any fixed-date obligation you track under Solvency.",
    icon: "fa-file-invoice-dollar",
    defaultOn: true,
    lead: 5,
    grace: 2,
  },
  {
    key: "subscriptionRenewal",
    group: "obligations",
    label: "Subscription renewal",
    hint: "Heads-up before a subscription bills again.",
    icon: "fa-rotate",
    defaultOn: true,
    lead: 5,
    grace: 1,
  },
  {
    key: "sipDue",
    group: "obligations",
    label: "SIP debit date",
    hint: "Before your monthly SIP instalment is auto-debited.",
    icon: "fa-seedling",
    defaultOn: true,
    lead: 3,
    grace: 1,
  },
  {
    key: "contributionDue",
    group: "obligations",
    label: "Premium · contribution due",
    hint: "Before a LIC/recurring premium is due — and again if it slips past its grace period.",
    icon: "fa-shield-halved",
    defaultOn: true,
    lead: 5,
    grace: 3,
  },
  {
    key: "autoDeductDue",
    group: "obligations",
    label: "Chit · recurring contribution",
    hint: "Nudges you to log each chit fund or auto-deduct instalment for the current period — log it straight from the reminder.",
    icon: "fa-handshake-angle",
    defaultOn: true,
    lead: 3,
    grace: 3,
  },
  {
    key: "noteReminder",
    group: "obligations",
    label: "Note reminder",
    hint: "Surfaces a note (Toolbox → Notes) when the reminder you set on it comes due.",
    icon: "fa-note-sticky",
    defaultOn: true,
    lead: 1,
    grace: 3,
  },
  // ── Insights (insight-driven, not a fixed calendar date) ──
  // Default OFF — only the fixed-date Reminders fire out of the box; the user
  // opts into the proactive nudges from Preferences.
  {
    key: "trialEnding",
    group: "insights",
    label: "Free-trial ending",
    hint: "Before a trial converts to a paid charge.",
    icon: "fa-hourglass-half",
    defaultOn: false,
    lead: 5,
  },
  {
    key: "subAnomaly",
    group: "insights",
    label: "Price hike & missed charges",
    hint: "Silent price increases, or a charge that was expected but never posted.",
    icon: "fa-triangle-exclamation",
    defaultOn: false,
  },
  {
    key: "premiumPileup",
    group: "insights",
    label: "Payment pile-up",
    hint: "Warns when several fixed debits land in the same week — before the cash crunch.",
    icon: "fa-calendar-week",
    defaultOn: false,
    lead: 10, // look this far ahead for clustered outflows
  },
  {
    key: "idleCash",
    group: "insights",
    label: "Idle cash",
    hint: "Nudges you when your balance sits well above a healthy buffer — money that could be earning.",
    icon: "fa-piggy-bank",
    defaultOn: false,
  },
  {
    key: "milestone",
    group: "insights",
    label: "Milestones",
    hint: "Celebrates the wins — an investment crossing 2× / 3× / 5× / 10×. Each shows once.",
    icon: "fa-trophy",
    defaultOn: false,
  },
  {
    key: "advisoryDigest",
    group: "insights",
    label: "Advisory digest",
    hint: "A monthly round-up of your top money moves and the savings on the table — jumps straight to Advisory.",
    icon: "fa-lightbulb",
    defaultOn: false,
  },
];

const TYPE_BY_KEY = new Map(NOTIFICATION_TYPES.map((t) => [t.key, t]));

// ── Insight tuning ───────────────────────────────────────
// The insight nudges run on heuristics with thresholds the user can dial in
// from Preferences. Stored as preferences.notificationTuning; absent keys fall
// back to these defaults. The Preferences panel writes here.
export const NOTIFICATION_TUNING_DEFAULTS = {
  idleBufferMonths: 3, // months of spending kept as a buffer before "idle"
  idleMinSurplus: 25_000, // ₹ surplus floor before the idle-cash nudge fires
  pileupMinCount: 3, // how many outflows in the window count as a pile-up
  pileupWindowDays: 7, // size of the clustering window (days)
  trialLeadDays: 5, // remind this many days before a trial converts
  milestoneMultiples: [2, 3, 5, 10], // growth bands that earn a celebration
};

function posInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function nonNegNum(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Merge stored tuning over defaults, sanitising each value so a bad/blank
// stored entry can never break derivation.
export function getNotificationTuning(prefs) {
  const t = prefs?.notificationTuning ?? {};
  const D = NOTIFICATION_TUNING_DEFAULTS;
  const multiples = Array.isArray(t.milestoneMultiples)
    ? [...new Set(t.milestoneMultiples.map((m) => parseFloat(m)))]
        .filter((m) => Number.isFinite(m) && m > 1)
        .sort((a, b) => a - b)
    : null;
  return {
    idleBufferMonths: posInt(t.idleBufferMonths, D.idleBufferMonths),
    idleMinSurplus: nonNegNum(t.idleMinSurplus, D.idleMinSurplus),
    pileupMinCount: Math.max(2, posInt(t.pileupMinCount, D.pileupMinCount)),
    pileupWindowDays: posInt(t.pileupWindowDays, D.pileupWindowDays),
    trialLeadDays: posInt(t.trialLeadDays, D.trialLeadDays),
    milestoneMultiples: multiples?.length ? multiples : D.milestoneMultiples,
  };
}

export function getNotificationType(key) {
  return TYPE_BY_KEY.get(key) ?? null;
}

// Is a type currently switched on? Per-type override beats the default.
export function isTypeEnabled(prefs, key) {
  const t = TYPE_BY_KEY.get(key);
  if (!t) return false;
  const override = prefs?.notificationTypes?.[key];
  return override === undefined ? t.defaultOn : !!override;
}

// ── Date helpers ─────────────────────────────────────────
function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

// A given day-of-month, clamped to the month's real length (so a due day of 31
// lands on Feb 28/29, not March 3).
function clampDay(year, month, day) {
  const lastOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastOfMonth));
}

// The upcoming occurrence of a monthly due day relative to `now`: this month's
// instance unless it's already more than `grace` days past, in which case roll
// to next month.
function upcomingMonthly(day, now, grace) {
  const d = parseInt(day, 10);
  if (!d) return null;
  const thisMonth = clampDay(now.getFullYear(), now.getMonth(), d);
  if (daysUntil(thisMonth, now) >= -grace) return thisMonth;
  return clampDay(now.getFullYear(), now.getMonth() + 1, d);
}

// Within the visible window: lead days before → grace days after the due date.
function inWindow(days, lead, grace) {
  return days != null && days <= lead && days >= -grace;
}

// Urgency from how close (or overdue) the due date is.
function severityFor(days) {
  if (days == null) return "info";
  if (days < 0) return "urgent"; // overdue
  if (days <= 1) return "urgent";
  if (days <= 3) return "warn";
  return "info";
}

// A dismissal of a date-based event expires once its grace window closes — by
// then the event has dropped out of the derived list on its own anyway.
function expiryFor(dueDate, grace) {
  const e = new Date(dueDate);
  e.setDate(e.getDate() + grace + 1);
  return e.toISOString();
}

// Last moment of the current month — used as the dismissal expiry for
// insight-type notifications that have no single due date.
function endOfMonth(now) {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// A commitment is still live unless it's a fully-paid / preclosed EMI.
function commitmentActive(c) {
  if (c.preclosedAt) return false;
  if (c.type === "emi" && Number(c.currentOutstanding) === 0) return false;
  return true;
}

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
function inr(n) {
  return INR.format(Math.round(n || 0));
}

const SHORT_DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
});
function shortDate(d) {
  return SHORT_DATE.format(d);
}

// Rolling 30-day expense total — the basis for the idle-cash buffer. Derived
// straight from the ledger, so it tracks the user's real spending rate.
function recentMonthlyExpense(transactions, now) {
  const cutoff = now.getTime() - 30 * 86_400_000;
  let sum = 0;
  for (const t of transactions) {
    if (t.transactionType !== "expense") continue;
    const ts = new Date(t.occurredAt ?? t.createdAt).getTime();
    if (ts >= cutoff && ts <= now.getTime()) sum += parseFloat(t.amount) || 0;
  }
  return sum;
}

// Earliest unpaid premium for a LIC/plan policy: the first overdue one
// (negative daysLeft) if any, else the next upcoming. null when fully paid.
// "Paid" = a licPolicyId transaction in that calendar month.
function licPremiumState(inv, transactions, now) {
  const start = new Date(inv.startDate);
  if (Number.isNaN(start.getTime())) return null;
  const startDay = start.getDate();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const enrolledRaw = inv.createdAt ? new Date(inv.createdAt) : start;
  const enrolled = new Date(
    enrolledRaw.getFullYear(),
    enrolledRaw.getMonth(),
    enrolledRaw.getDate(),
  );
  const paid = new Set();
  for (const tx of transactions) {
    if (tx.licPolicyId !== inv.id) continue;
    const d = new Date(tx.occurredAt);
    paid.add(`${d.getFullYear()}-${d.getMonth()}`);
  }
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const horizon = new Date(now.getFullYear() + 1, now.getMonth() + 1, 1);
  let nextDue = null;
  while (cursor < horizon) {
    if (inv.premiumMonths.includes(cursor.getMonth() + 1)) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      if (!paid.has(key)) {
        const lastDay = new Date(
          cursor.getFullYear(),
          cursor.getMonth() + 1,
          0,
        ).getDate();
        const due = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          Math.min(startDay, lastDay),
        );
        if (due >= enrolled) {
          const days = Math.round((due - today) / 86_400_000);
          if (days < 0) return { due, daysLeft: days };
          if (!nextDue) nextDue = { due, daysLeft: days };
        }
      }
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return nextDue;
}

function autoDeductPeriodInfo(frequency, day, now, anchorMonth) {
  const yr = now.getFullYear();
  const mo = now.getMonth();
  const d = parseInt(day, 10) || 1;
  const am = Number.isInteger(anchorMonth) ? anchorMonth : mo;
  if (frequency === "yearly") {
    return {
      key: `${yr}`,
      due: clampDay(yr, am, d),
      matches: (x) => x.getFullYear() === yr,
      periodEnd: new Date(yr, 11, 31, 23, 59, 59),
    };
  }
  if (frequency === "halfyearly") {
    const h = Math.floor(mo / 6);
    let dueMonth = h * 6;
    for (let m = h * 6; m < h * 6 + 6; m++) {
      if ((((m - am) % 6) + 6) % 6 === 0) {
        dueMonth = m;
        break;
      }
    }
    return {
      key: `${yr}-H${h}`,
      due: clampDay(yr, dueMonth, d),
      matches: (x) =>
        x.getFullYear() === yr && Math.floor(x.getMonth() / 6) === h,
      periodEnd: new Date(yr, h * 6 + 6, 0, 23, 59, 59),
    };
  }
  if (frequency === "quarterly") {
    const q = Math.floor(mo / 3);
    let dueMonth = q * 3;
    for (let m = q * 3; m < q * 3 + 3; m++) {
      if ((((m - am) % 3) + 3) % 3 === 0) {
        dueMonth = m;
        break;
      }
    }
    return {
      key: `${yr}-Q${q}`,
      due: clampDay(yr, dueMonth, d),
      matches: (x) =>
        x.getFullYear() === yr && Math.floor(x.getMonth() / 3) === q,
      periodEnd: new Date(yr, q * 3 + 3, 0, 23, 59, 59),
    };
  }
  return {
    key: `${yr}-${mo}`,
    due: clampDay(yr, mo, d),
    matches: (x) => x.getFullYear() === yr && x.getMonth() === mo,
    periodEnd: new Date(yr, mo + 1, 0, 23, 59, 59),
  };
}

// ── Derivation ───────────────────────────────────────────
// Returns the full live notification list (already filtered to enabled types),
// sorted soonest-due first with dateless insights last. Dismissal filtering
// happens in the useNotifications hook, not here, so this stays pure + testable.
export function deriveNotifications(data, prefs, now = new Date()) {
  if (!data) return [];
  const out = [];

  const cards = data.cards ?? [];
  const commitments = data.commitments ?? [];
  const subscriptions = data.subscriptions ?? [];
  const investments = data.investments ?? [];
  const transactions = data.transactions ?? [];
  const tuning = getNotificationTuning(prefs);

  // 1. Credit-card payment due
  if (isTypeEnabled(prefs, "cardDue")) {
    const t = TYPE_BY_KEY.get("cardDue");
    for (const card of cards) {
      if (!card.dueDay) continue;
      const info = getCardDue(card, transactions, commitments, now);
      if (!info) continue;
      const due = info.dueDate;
      const days = info.diffDays;
      if (!inWindow(days, t.lead, t.grace)) continue;
      out.push({
        id: `cardDue:${card.id}:${isoDay(due)}`,
        type: "cardDue",
        group: t.group,
        icon: t.icon,
        severity: severityFor(days),
        title: `${card.name} payment ${days < 0 ? "overdue" : "due"}`,
        subtitle: dueLabel(days),
        amount: info.amount,
        dueOn: due.toISOString(),
        daysLeft: days,
        href: `/Solvency?highlight=${card.id}&focus=card`,
        expiresAt: expiryFor(due, t.grace),
      });
    }
  }

  // 2. EMI / rent / insurance and other fixed-date commitments
  if (isTypeEnabled(prefs, "commitmentDue")) {
    const t = TYPE_BY_KEY.get("commitmentDue");
    for (const c of commitments) {
      if (!c.dueDay || !commitmentActive(c)) continue;
      const due = upcomingMonthly(c.dueDay, now, t.grace);
      const days = daysUntil(due, now);
      if (!inWindow(days, t.lead, t.grace)) continue;
      out.push({
        id: `commitmentDue:${c.id}:${isoDay(due)}`,
        type: "commitmentDue",
        group: t.group,
        icon: t.icon,
        severity: severityFor(days),
        title: `${c.name} ${days < 0 ? "overdue" : "due"}`,
        subtitle: dueLabel(days),
        amount: num(c.emiAmount),
        dueOn: due.toISOString(),
        daysLeft: days,
        href: `/Solvency?highlight=${c.id}&focus=commitment`,
        expiresAt: expiryFor(due, t.grace),
      });
    }
  }

  // 3. Subscription renewals (skip if this cycle's charge already posted)
  if (isTypeEnabled(prefs, "subscriptionRenewal")) {
    const t = TYPE_BY_KEY.get("subscriptionRenewal");
    for (const sub of subscriptions) {
      if (!isBilling(sub)) continue;
      const due = nextRenewal(sub, now);
      const days = daysUntil(due, now);
      if (!inWindow(days, t.lead, t.grace)) continue;
      if (isCurrentCyclePosted(sub, transactions, now)) continue;
      out.push({
        id: `subscriptionRenewal:${sub.id}:${isoDay(due)}`,
        type: "subscriptionRenewal",
        group: t.group,
        icon: t.icon,
        severity: severityFor(days),
        title: `${sub.name} renews`,
        subtitle: dueLabel(days),
        amount: num(sub.amount),
        dueOn: due.toISOString(),
        daysLeft: days,
        href: `/Subscriptions?highlight=${sub.id}`,
        expiresAt: expiryFor(due, t.grace),
      });
    }
  }

  // 4. SIP debit dates
  if (isTypeEnabled(prefs, "sipDue")) {
    const t = TYPE_BY_KEY.get("sipDue");
    for (const inv of investments) {
      if (!inv.sipDay || inv.paused || inv.soldDate || inv.maturedAt) continue;
      const due = upcomingMonthly(inv.sipDay, now, t.grace);
      const days = daysUntil(due, now);
      if (!inWindow(days, t.lead, t.grace)) continue;
      out.push({
        id: `sipDue:${inv.id}:${isoDay(due)}`,
        type: "sipDue",
        group: t.group,
        icon: t.icon,
        severity: severityFor(days),
        title: `${inv.name} SIP debit`,
        subtitle: dueLabel(days),
        amount: num(inv.monthlyAmount),
        dueOn: due.toISOString(),
        daysLeft: days,
        href: `/Invest?highlight=${inv.id}`,
        expiresAt: expiryFor(due, t.grace),
      });
    }
  }

  // 4b. LIC / recurring premium due + past-grace lapse
  if (isTypeEnabled(prefs, "contributionDue")) {
    const t = TYPE_BY_KEY.get("contributionDue");
    for (const inv of investments) {
      if (inv.type !== "lic" && inv.type !== "plan") continue;
      if (!Array.isArray(inv.premiumMonths) || inv.premiumMonths.length === 0) continue;
      if (inv.soldDate || inv.maturedAt || inv.inHistory) continue;
      const s = licPremiumState(inv, transactions, now);
      if (!s) continue;
      const overdue = s.daysLeft < 0;
      const graceDays = graceToDays(
        resolveGrace(inv),
        Math.round(365 / (inv.premiumMonths.length || 12)),
      );
      const lapsed = overdue && -s.daysLeft > graceDays;
      if (!overdue && !inWindow(s.daysLeft, t.lead, t.grace)) continue;
      out.push({
        id: `contributionDue:${inv.id}:${isoDay(s.due)}`,
        type: "contributionDue",
        group: t.group,
        icon: t.icon,
        severity: lapsed ? "urgent" : severityFor(s.daysLeft),
        title: lapsed
          ? `${inv.name} lapsed`
          : `${inv.name} premium ${overdue ? "overdue" : "due"}`,
        subtitle: lapsed
          ? `Past ${graceDays}-day grace · pay overdue to revive`
          : dueLabel(s.daysLeft),
        amount: num(inv.premiumAmount),
        dueOn: s.due.toISOString(),
        daysLeft: s.daysLeft,
        href: `/Invest?highlight=${inv.id}`,
        expiresAt: overdue ? null : expiryFor(s.due, t.grace),
      });
    }
  }

  // 4c. Chit fund & recurring auto-deduct contributions
  if (isTypeEnabled(prefs, "autoDeductDue")) {
    const t = TYPE_BY_KEY.get("autoDeductDue");
    const userTypes = data.investmentTypes ?? [];
    for (const inv of investments) {
      if (resolveLogMode(inv) !== "manual" || !inv.startDate) continue;
      if (inv.paused || inv.inHistory || inv.soldDate || inv.maturedAt) continue;
      if (inv.type === "lic") continue; // LIC has its own arrears reminders
      const start = new Date(inv.startDate);
      if (Number.isNaN(start.getTime()) || start > now) continue;
      const schema = getInvestmentTypeSchema(inv.type, userTypes);
      const amount = findAutoDeductAmount(inv, schema);
      if (!(amount > 0)) continue;
      const frequency = inv.autoDeduct.frequency || "monthly";
      const anchorMonth = inv.startDate
        ? new Date(inv.startDate).getMonth()
        : undefined;
      const period = autoDeductPeriodInfo(
        frequency,
        inv.autoDeduct.dayOfMonth,
        now,
        anchorMonth,
      );
      const logged = transactions.some(
        (tx) =>
          tx.autoDeductInvestmentId === inv.id &&
          period.matches(new Date(tx.occurredAt)),
      );
      if (logged) continue;
      const days = daysUntil(period.due, now);
      if (days > t.lead) continue;
      const variable = !!inv.autoDeduct.variableAmount;
      out.push({
        id: `autoDeductDue:${inv.id}:${period.key}`,
        type: "autoDeductDue",
        group: t.group,
        icon: schema?.icon || t.icon,
        severity: severityFor(days),
        title: `${inv.name} contribution ${days < 0 ? "overdue" : "due"}`,
        subtitle: variable
          ? "Tap to enter this period's amount and log it"
          : dueLabel(days),
        amount,
        dueOn: period.due.toISOString(),
        daysLeft: days,
        href: `/Invest?ledger=${inv.id}`,
        action: variable
          ? null
          : { kind: "logAutoDeduct", investmentId: inv.id, amount },
        expiresAt: period.periodEnd.toISOString(),
      });
    }
  }

  // 5. Free-trial ending (surprise)
  if (isTypeEnabled(prefs, "trialEnding")) {
    const t = TYPE_BY_KEY.get("trialEnding");
    const lead = tuning.trialLeadDays;
    for (const sub of subscriptions) {
      const trial = trialStatus(sub, now);
      if (!trial || trial.days == null || trial.days < 0 || trial.days > lead) continue;
      out.push({
        id: `trialEnding:${sub.id}:${isoDay(trial.endsOn)}`,
        type: "trialEnding",
        group: t.group,
        icon: t.icon,
        severity: trial.days <= 1 ? "urgent" : "warn",
        title: `${sub.name} trial ending`,
        subtitle: `Converts to a paid charge ${dueLabel(trial.days).toLowerCase()}`,
        amount: trial.firstCharge || null,
        dueOn: trial.endsOn.toISOString(),
        daysLeft: trial.days,
        href: `/Subscriptions?highlight=${sub.id}`,
        expiresAt: expiryFor(trial.endsOn, 1),
      });
    }
  }

  // 6. Price hikes & missed (ghost) charges (surprise)
  if (isTypeEnabled(prefs, "subAnomaly")) {
    const t = TYPE_BY_KEY.get("subAnomaly");
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    for (const sub of subscriptions) {
      for (const flag of detectAnomaly(sub, transactions, now)) {
        out.push({
          id: `subAnomaly:${sub.id}:${flag.kind}:${monthKey}`,
          type: "subAnomaly",
          group: t.group,
          icon: flag.kind === "hike" ? "fa-arrow-trend-up" : "fa-ghost",
          severity: "warn",
          title: `${sub.name}: ${flag.kind === "hike" ? "price increase" : "missed charge"}`,
          subtitle: flag.message,
          amount: flag.to ?? null,
          dueOn: null,
          daysLeft: null,
          href: `/Subscriptions?highlight=${sub.id}`,
          expiresAt: endOfMonth(now),
        });
      }
    }
  }

  // 7. Payment pile-up: N+ fixed outflows landing within a tunable window.
  if (isTypeEnabled(prefs, "premiumPileup")) {
    const t = TYPE_BY_KEY.get("premiumPileup");
    // Gather far enough ahead to cover the clustering window even if the user
    // widened it past the type's default lookahead.
    const gatherDays = Math.max(t.lead, tuning.pileupWindowDays);
    const events = [];
    const pushEvent = (date, amount) => {
      if (!date) return;
      const days = daysUntil(date, now);
      if (days != null && days >= 0 && days <= gatherDays) {
        events.push({ date, amount: amount || 0 });
      }
    };
    for (const c of commitments) {
      if (c.dueDay && commitmentActive(c)) {
        pushEvent(upcomingMonthly(c.dueDay, now, 0), num(c.emiAmount));
      }
    }
    for (const card of cards) {
      const outstanding = num(card.outstanding);
      if (card.dueDay && (outstanding == null || outstanding > 0)) {
        pushEvent(upcomingMonthly(card.dueDay, now, 0), outstanding);
      }
    }
    for (const sub of subscriptions) {
      if (isBilling(sub) && !isCurrentCyclePosted(sub, transactions, now)) {
        pushEvent(nextRenewal(sub, now), num(sub.amount));
      }
    }
    for (const inv of investments) {
      if (inv.sipDay && !inv.paused && !inv.soldDate && !inv.maturedAt) {
        pushEvent(upcomingMonthly(inv.sipDay, now, 0), num(inv.monthlyAmount));
      }
    }
    events.sort((a, b) => a.date - b.date);
    // Slide the clustering window over the sorted events; report the first
    // cluster meeting the minimum count. One aggregate notification — not one
    // per payment.
    let cluster = null;
    for (let i = 0; i < events.length && !cluster; i += 1) {
      const windowItems = events.filter(
        (e) =>
          e.date >= events[i].date &&
          (e.date - events[i].date) / 86_400_000 <= tuning.pileupWindowDays,
      );
      if (windowItems.length >= tuning.pileupMinCount) cluster = windowItems;
    }
    if (cluster) {
      const total = cluster.reduce((s, e) => s + e.amount, 0);
      const first = cluster[0].date;
      const last = cluster[cluster.length - 1].date;
      out.push({
        id: `premiumPileup:${isoDay(first)}`,
        type: "premiumPileup",
        group: t.group,
        icon: t.icon,
        severity: "warn",
        title: `${cluster.length} payments due close together`,
        subtitle: `Between ${shortDate(first)} and ${shortDate(last)}`,
        amount: total > 0 ? total : null,
        dueOn: first.toISOString(),
        daysLeft: daysUntil(first, now),
        href: "/Solvency",
        expiresAt: expiryFor(last, 1),
      });
    }
  }

  // 8. Idle cash sitting above a healthy buffer (tunable months of spending).
  if (isTypeEnabled(prefs, "idleCash")) {
    const balance = num(data.insights?.balance) ?? 0;
    const monthlyExpense = recentMonthlyExpense(transactions, now);
    const surplus = balance - monthlyExpense * tuning.idleBufferMonths;
    // Only when there's a real spending baseline and a meaningful surplus, so
    // we don't nag accounts with little history or trivial amounts.
    if (monthlyExpense > 0 && surplus >= tuning.idleMinSurplus) {
      const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
      out.push({
        id: `idleCash:${monthKey}`,
        type: "idleCash",
        group: "insights",
        icon: TYPE_BY_KEY.get("idleCash").icon,
        severity: "info",
        title: `${inr(surplus)} sitting idle`,
        subtitle: `Above a ${tuning.idleBufferMonths}-month spending buffer — could be earning in an FD.`,
        amount: null,
        dueOn: null,
        daysLeft: null,
        href: "/Invest",
        expiresAt: endOfMonth(now),
      });
    }
  }

  // 9. Milestones — an investment crossing a growth multiple (a win worth a nod).
  // Fires once per band: the event key encodes the highest multiple reached and
  // carries NO expiry, so dismissing it is permanent. Reaching the next band
  // (e.g. 2× → 5×) is a new key, so it celebrates again — exactly once each.
  if (isTypeEnabled(prefs, "milestone")) {
    const icon = TYPE_BY_KEY.get("milestone").icon;
    for (const inv of investments) {
      if (inv.soldDate || inv.maturedAt) continue;
      const { investedAmount, currentValue } = calcInvestmentValues(inv);
      if (investedAmount <= 0) continue;
      const reached = tuning.milestoneMultiples.filter(
        (m) => currentValue >= investedAmount * m,
      );
      if (reached.length === 0) continue;
      const band = reached[reached.length - 1]; // highest band reached so far
      out.push({
        id: `milestone:multiple:${inv.id}:${band}`,
        type: "milestone",
        group: "insights",
        icon,
        severity: "info",
        title: band === 2 ? `${inv.name} has doubled` : `${inv.name} is up ${band}×`,
        subtitle: `Now worth ${inr(currentValue)} — ${band}× your ${inr(investedAmount)} in.`,
        amount: null,
        dueOn: null,
        daysLeft: null,
        href: `/Invest?highlight=${inv.id}`,
        expiresAt: null, // permanent: cleared only by the user, once
      });
    }
  }

  // Advisory digest — a monthly nudge summarising the top open recommendations
  // and the savings on the table. Runs the same client advisory engine (without
  // market rates, which aren't available here), skips cards the user already
  // suppressed, and self-expires at month-end so it shows at most once a month.
  if (isTypeEnabled(prefs, "advisoryDigest")) {
    try {
      const profile = mergeProfile(data, prefs?.advisoryProfile);
      const { cards, moneyFound } = runAdvisory(
        data,
        profile,
        {},
        prefs?.advisoryFeedback,
      );
      const active = cards.filter((c) => !isSuppressed(prefs?.advisoryState, c.id));
      if (active.length > 0) {
        const t = TYPE_BY_KEY.get("advisoryDigest");
        const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
        const top = active[0];
        out.push({
          id: `advisoryDigest:${monthKey}`,
          type: "advisoryDigest",
          group: "insights",
          icon: t.icon,
          severity: "info",
          title: `${active.length} money move${active.length === 1 ? "" : "s"} for you`,
          subtitle:
            moneyFound > 0
              ? `About ${inr(moneyFound)}/yr on the table — starting with "${top.title}".`
              : `Top pick: ${top.title}.`,
          amount: null,
          dueOn: null,
          daysLeft: null,
          href: "/Advisory/actions",
          expiresAt: endOfMonth(now),
        });
      }
    } catch {
      /* advisory engine is best-effort here — never break notifications */
    }
  }

  // Note reminders — user-set reminders on notes (Toolbox → Notes). Gated by
  // the notes feature toggle so disabling Notes silences them too.
  if (prefs?.notesEnabled !== false && isTypeEnabled(prefs, "noteReminder")) {
    const t = TYPE_BY_KEY.get("noteReminder");
    for (const note of data.notes ?? []) {
      if (!note.remindAt || note.archivedAt) continue;
      const due = new Date(note.remindAt);
      if (Number.isNaN(due.getTime())) continue;
      const days = daysUntil(due, now);
      if (!inWindow(days, t.lead, t.grace)) continue;
      const firstLine =
        (note.body ?? "").split("\n").find((l) => l.trim()) ?? "Note";
      const label =
        (note.title ?? "").trim() ||
        firstLine
          .replace(/^-\s+(\[[ xX]\]\s*)?/, "")
          .replace(/\*\*|~~/g, "")
          .slice(0, 60) ||
        "Note";
      const route = getPage(note.pageKey)?.route ?? "/Dashboard";
      out.push({
        id: `noteReminder:${note.id}:${isoDay(due)}`,
        type: "noteReminder",
        group: t.group,
        icon: t.icon,
        severity: severityFor(days),
        title: `Note: ${label}`,
        subtitle: dueLabel(days),
        amount: null,
        dueOn: due.toISOString(),
        daysLeft: days,
        href: `${route}?note=${note.id}`,
        expiresAt: expiryFor(due, t.grace),
      });
    }
  }

  return out.sort((a, b) => {
    if (a.dueOn && b.dueOn) return new Date(a.dueOn) - new Date(b.dueOn);
    if (a.dueOn) return -1;
    if (b.dueOn) return 1;
    return 0;
  });
}

// Human label for a day delta. Kept here so engine + UI agree on wording.
export function dueLabel(days) {
  if (days == null) return "";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}
