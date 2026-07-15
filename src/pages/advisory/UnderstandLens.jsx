import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSelector, useDispatch } from "react-redux";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
} from "recharts";
import BankLogo from "../../components/BankLogo";
import CashFlowCard from "./CashFlowCard";
import { runAnalysis } from "../../utils/advisory/analysis";
import { computeFire } from "../../utils/advisory/fire";
import { mergeProfile } from "../../utils/advisory/profile";
import { calcHealthScore, computeCardOutstanding } from "../../utils/solvencyUtils";
import { persistSetPreference } from "../../redux/slices/transactionSlice";

const EASE = [0.25, 0.46, 0.45, 0.94];

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const INR_COMPACT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

function signed(n) {
  return `${n >= 0 ? "+" : "−"}${INR.format(Math.abs(n))}`;
}

function Section({ children, delay = 0 }) {
  return (
    <motion.section
      className="adv-und-section"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE, delay }}
    >
      {children}
    </motion.section>
  );
}

function Bar({ amount, scale, className }) {
  const pct = scale > 0 ? Math.max(2, (amount / scale) * 100) : 0;
  return (
    <div className="adv-und-bar-track">
      <motion.div
        className={`adv-und-bar ${className}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: EASE }}
      />
    </div>
  );
}

function Waterfall({ wf, periodLabel }) {
  const scale = Math.max(
    wf.opening,
    wf.closing,
    wf.income,
    wf.expenses,
    wf.investments,
    1,
  );
  const rows = [
    { key: "opening", label: "Opening balance", amount: wf.opening, cls: "adv-und-bar--neutral", sign: "" },
    { key: "income", label: "Income in", amount: wf.income, cls: "adv-und-bar--in", sign: "+" },
    { key: "expenses", label: "Spending out", amount: wf.expenses, cls: "adv-und-bar--out", sign: "−" },
    { key: "investments", label: "Invested out", amount: wf.investments, cls: "adv-und-bar--invest", sign: "−" },
    { key: "closing", label: "Closing balance", amount: wf.closing, cls: "adv-und-bar--neutral", sign: "" },
  ];
  return (
    <>
      <div className="adv-und-head">
        <h3>Where your balance moved</h3>
        <span className="adv-und-sub">{periodLabel}</span>
      </div>
      <div className="adv-und-waterfall">
        {rows.map((r) => (
          <div key={r.key} className="adv-und-wf-row">
            <span className="adv-und-wf-label">{r.label}</span>
            <Bar amount={r.amount} scale={scale} className={r.cls} />
            <span className="adv-und-wf-amt">
              {r.sign}
              {INR.format(r.amount)}
            </span>
          </div>
        ))}
      </div>
      <p
        className={`adv-und-net ${wf.netFlow >= 0 ? "adv-und-net--up" : "adv-und-net--down"}`}
      >
        <i
          className={`fa-solid fa-arrow-trend-${wf.netFlow >= 0 ? "up" : "down"}`}
        />
        Net this month {signed(wf.netFlow)} —{" "}
        {wf.netFlow >= 0 ? "you saved" : "you drew down"}
      </p>
      {wf.cardSpend > 0 && (
        <p className="adv-und-hint">
          <i className="fa-solid fa-credit-card" /> {INR.format(wf.cardSpend)} on
          credit cards this month — not yet out of your bank, but it&apos;s
          building a bill.
        </p>
      )}
    </>
  );
}

function Spending({ spending }) {
  const [mode, setMode] = useState("category");
  const list = mode === "category" ? spending.byCategory : spending.bySource;
  const scale = Math.max(...list.map((r) => r.amount), 1);
  const momDelta = spending.total - spending.prevTotal;
  return (
    <>
      <div className="adv-und-head">
        <h3>Where your money went</h3>
        {spending.prevTotal > 0 && (
          <span
            className={`adv-und-sub ${momDelta > 0 ? "adv-und-sub--up" : "adv-und-sub--down"}`}
          >
            {signed(momDelta)} vs last month
          </span>
        )}
      </div>
      <div className="adv-und-toggle">
        <button
          type="button"
          className={`adv-und-toggle-btn${mode === "category" ? " adv-und-toggle-btn--active" : ""}`}
          onClick={() => setMode("category")}
        >
          By category
        </button>
        <button
          type="button"
          className={`adv-und-toggle-btn${mode === "source" ? " adv-und-toggle-btn--active" : ""}`}
          onClick={() => setMode("source")}
        >
          By bank / card
        </button>
      </div>
      {list.length === 0 ? (
        <p className="adv-und-hint">No spending recorded this month yet.</p>
      ) : (
        <div className="adv-und-spend">
          <AnimatePresence initial={false} mode="popLayout">
            {list.map((r) => {
              const delta = mode === "category" ? r.amount - (r.prev || 0) : 0;
              return (
                <motion.div
                  key={`${mode}-${r.label}`}
                  layout
                  className="adv-und-spend-row"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
                  <div className="adv-und-spend-top">
                    <span className="adv-und-spend-name">
                      {r.kind === "bank" && (
                        <BankLogo bank={r.bank} color={r.color} size={16} />
                      )}
                      {r.kind === "card" && (
                        <i className="fa-solid fa-credit-card adv-und-spend-ico" />
                      )}
                      {r.label}
                    </span>
                    <span className="adv-und-spend-amt">
                      {INR.format(r.amount)}
                      {mode === "category" && r.prev > 0 && (
                        <span
                          className={`adv-und-spend-delta ${delta > 0 ? "adv-und-spend-delta--up" : "adv-und-spend-delta--down"}`}
                        >
                          <i
                            className={`fa-solid fa-caret-${delta > 0 ? "up" : "down"}`}
                          />
                          {INR.format(Math.abs(delta))}
                        </span>
                      )}
                    </span>
                  </div>
                  <Bar amount={r.amount} scale={scale} className="adv-und-bar--out" />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

function Trend({ trend }) {
  const hasFlow = trend.some((m) => m.income > 0 || m.outflow > 0);
  if (!hasFlow) return null;
  const scale = Math.max(...trend.map((m) => Math.max(m.income, m.outflow)), 1);
  return (
    <>
      <div className="adv-und-head">
        <h3>Cashflow, last 6 months</h3>
        <span className="adv-und-sub">in vs out</span>
      </div>
      <div className="adv-und-trend">
        {trend.map((m) => (
          <div key={m.label} className="adv-und-trend-col">
            <div className="adv-und-trend-bars">
              <motion.div
                className="adv-und-trend-bar adv-und-trend-bar--in"
                initial={{ height: 0 }}
                animate={{ height: `${(m.income / scale) * 100}%` }}
                transition={{ duration: 0.5, ease: EASE }}
                title={`In ${INR.format(m.income)}`}
              />
              <motion.div
                className="adv-und-trend-bar adv-und-trend-bar--out"
                initial={{ height: 0 }}
                animate={{ height: `${(m.outflow / scale) * 100}%` }}
                transition={{ duration: 0.5, ease: EASE }}
                title={`Out ${INR.format(m.outflow)}`}
              />
            </div>
            <span className="adv-und-trend-label">{m.label}</span>
            <span
              className={`adv-und-trend-net ${m.net >= 0 ? "adv-und-trend-net--up" : "adv-und-trend-net--down"}`}
            >
              {m.net >= 0 ? "+" : "−"}
              {INR_COMPACT.format(Math.abs(m.net))}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

const NW_COLORS = {
  cash: "#2d9cdb",
  equity: "#1a9f63",
  debt: "#9aa3b2",
  gold: "#d9a521",
  alt: "#6c5ce7",
  lent: "#e07b39",
};
const LIAB_COLORS = ["#d64545", "#e8743b", "#b3457a"];

function NetWorth({ nw }) {
  const [selected, setSelected] = useState(null);
  if (nw.grossAssets <= 0 && nw.totalLiab <= 0) return null;

  const toggle = (label) => setSelected((s) => (s === label ? null : label));
  const liabColor = (i) => LIAB_COLORS[i % LIAB_COLORS.length];
  const selectedRow =
    [...nw.assets, ...nw.liabilities].find((r) => r.label === selected) || null;

  return (
    <>
      <div className="adv-und-head">
        <h3>What you&apos;re worth</h3>
        <span className="adv-und-sub">assets − liabilities</span>
      </div>

      <div className="adv-und-nw-chart">
        <div className="adv-und-nw-donut">
          <ResponsiveContainer width="100%" height={172}>
            <PieChart>
              <Pie
                data={nw.assets}
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={80}
                paddingAngle={nw.assets.length > 1 ? 2 : 0}
                dataKey="amount"
                stroke="none"
                onClick={(_, i) => toggle(nw.assets[i].label)}
              >
                {nw.assets.map((a) => (
                  <Cell
                    key={a.label}
                    fill={NW_COLORS[a.cls] || "#9aa3b2"}
                    opacity={selected && selected !== a.label ? 0.32 : 1}
                    cursor="pointer"
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="adv-und-nw-center">
            <span className="adv-und-nw-center-label">Net worth</span>
            <span className="adv-und-nw-center-value">
              {INR_COMPACT.format(nw.netWorth)}
            </span>
          </div>
        </div>

        <div className="adv-und-nw-legend">
          {nw.assets.map((a) => {
            const pct =
              nw.grossAssets > 0 ? (a.amount / nw.grossAssets) * 100 : 0;
            return (
              <button
                key={a.label}
                type="button"
                className={`adv-und-nw-leg${selected === a.label ? " adv-und-nw-leg--on" : ""}`}
                onClick={() => toggle(a.label)}
              >
                <span
                  className="adv-und-nw-dot"
                  style={{ background: NW_COLORS[a.cls] || "#9aa3b2" }}
                />
                <span className="adv-und-nw-leg-label">{a.label}</span>
                <span className="adv-und-nw-leg-val">
                  {INR.format(a.amount)} <em>{pct.toFixed(0)}%</em>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {nw.liabilities.length > 0 && (
        <div className="adv-und-nw-owe">
          <div className="adv-und-nw-owe-head">
            <span>You owe</span>
            <span>{INR.format(nw.totalLiab)}</span>
          </div>
          <div className="adv-und-nw-owe-bar">
            {nw.liabilities.map((l, i) => (
              <button
                key={l.label}
                type="button"
                className="adv-und-nw-owe-seg"
                style={{
                  width: `${(l.amount / nw.totalLiab) * 100}%`,
                  background: liabColor(i),
                  opacity: selected && selected !== l.label ? 0.4 : 1,
                }}
                title={`${l.label} ${INR.format(l.amount)}`}
                onClick={() => toggle(l.label)}
              />
            ))}
          </div>
          <div className="adv-und-nw-owe-legend">
            {nw.liabilities.map((l, i) => (
              <button
                key={l.label}
                type="button"
                className={`adv-und-nw-leg adv-und-nw-leg--sm${selected === l.label ? " adv-und-nw-leg--on" : ""}`}
                onClick={() => toggle(l.label)}
              >
                <span
                  className="adv-und-nw-dot"
                  style={{ background: liabColor(i) }}
                />
                <span className="adv-und-nw-leg-label">{l.label}</span>
                <span className="adv-und-nw-leg-val">{INR.format(l.amount)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {selectedRow && (
          <motion.div
            className="adv-und-nw-inspect"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            style={{ overflow: "hidden" }}
          >
            <div className="adv-und-nw-inspect-head">
              {selectedRow.label} · {INR.format(selectedRow.amount)}
            </div>
            {selectedRow.items?.length > 0 ? (
              selectedRow.items.map((it, i) => (
                <div key={`${it.label}-${i}`} className="adv-und-nw-subrow">
                  <span className="adv-und-nw-subname">
                    {it.icon && (
                      <span className="adv-und-nw-subicon-wrap">
                        <i
                          className={`fa-solid ${it.icon} adv-und-nw-subicon`}
                          style={{ color: it.color }}
                        />
                        {it.combo && it.hasSip && (
                          <i className="fa-solid fa-arrows-rotate adv-und-nw-subbadge" />
                        )}
                      </span>
                    )}
                    <span className="adv-und-nw-subtext">
                      <span className="adv-und-nw-subtitle">{it.label}</span>
                      {it.typeLabel && (
                        <span className="adv-und-nw-subtype">{it.typeLabel}</span>
                      )}
                    </span>
                  </span>
                  <span className="adv-und-nw-subamt">{INR.format(it.amount)}</span>
                </div>
              ))
            ) : (
              <p className="adv-und-nw-inspect-empty">
                No itemised breakdown for this bucket.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const LOAD_COLORS = {
  emi: "#d64545",
  subs: "#6c5ce7",
  inv: "#1a9f63",
  card: "#e8743b",
};

function Recurring({ rec }) {
  const [selected, setSelected] = useState(null);
  if (rec.total <= 0) return null;
  const cats = rec.categories;
  const toggle = (k) => setSelected((s) => (s === k ? null : k));
  const selectedRow = cats.find((c) => c.key === selected) || null;
  const pct = rec.pct;
  const tone = pct == null ? "ok" : pct >= 0.6 ? "low" : pct >= 0.4 ? "ok" : "good";
  return (
    <>
      <div className="adv-und-head">
        <h3>Load for {rec.monthLabel}</h3>
        <span className="adv-und-sub">due in {rec.month}</span>
      </div>

      <div className="adv-und-nw-chart">
        <div className="adv-und-nw-donut">
          <ResponsiveContainer width="100%" height={172}>
            <PieChart>
              <Pie
                data={cats}
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={80}
                paddingAngle={cats.length > 1 ? 2 : 0}
                dataKey="amount"
                stroke="none"
                onClick={(_, i) => toggle(cats[i].key)}
              >
                {cats.map((c) => (
                  <Cell
                    key={c.key}
                    fill={LOAD_COLORS[c.key]}
                    opacity={selected && selected !== c.key ? 0.32 : 1}
                    cursor="pointer"
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="adv-und-nw-center">
            <span className="adv-und-nw-center-label">{rec.month}</span>
            <span className="adv-und-nw-center-value">
              {INR_COMPACT.format(rec.total)}
            </span>
          </div>
        </div>

        <div className="adv-und-nw-legend">
          {cats.map((c) => {
            const p = rec.total > 0 ? (c.amount / rec.total) * 100 : 0;
            return (
              <button
                key={c.key}
                type="button"
                className={`adv-und-nw-leg${selected === c.key ? " adv-und-nw-leg--on" : ""}`}
                onClick={() => toggle(c.key)}
              >
                <span
                  className="adv-und-nw-dot"
                  style={{ background: LOAD_COLORS[c.key] }}
                />
                <span className="adv-und-nw-leg-label">
                  {c.label}
                  {c.variable && <span className="adv-und-load-tag">varies</span>}
                </span>
                <span className="adv-und-nw-leg-val">
                  {INR.format(c.amount)} <em>{p.toFixed(0)}%</em>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {selectedRow && (
          <motion.div
            className="adv-und-nw-inspect"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            style={{ overflow: "hidden" }}
          >
            <div className="adv-und-nw-inspect-head">
              {selectedRow.label} · {INR.format(selectedRow.amount)}
            </div>
            {selectedRow.items.map((it, i) => (
              <div key={`${it.label}-${i}`} className="adv-und-nw-subrow">
                <span className="adv-und-nw-subname">
                  {it.icon && (
                    <span className="adv-und-nw-subicon-wrap">
                      <i
                        className={`fa-solid ${it.icon} adv-und-nw-subicon`}
                        style={{ color: it.color }}
                      />
                    </span>
                  )}
                  <span className="adv-und-nw-subtext">
                    <span className="adv-und-nw-subtitle">{it.label}</span>
                    {(it.typeLabel || it.variable || it.overdue) && (
                      <span className="adv-und-nw-subtype">
                        {it.typeLabel}
                        {it.variable && (
                          <span className="adv-und-varies-tag">
                            <i className="fa-solid fa-arrow-down-up-across-line" />{" "}
                            varies
                          </span>
                        )}
                        {it.overdue && (
                          <span className="adv-und-overdue-tag">
                            <i className="fa-solid fa-triangle-exclamation" />{" "}
                            overdue
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </span>
                <span className="adv-und-nw-subamt">
                  {it.variable ? "∼" : ""}
                  {INR.format(it.amount)}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {pct != null && (
        <>
          <div className="adv-und-bar-track adv-und-load-track">
            <motion.div
              className={`adv-und-bar adv-und-load adv-und-load--${tone}`}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, pct * 100)}%` }}
              transition={{ duration: 0.5, ease: EASE }}
            />
          </div>
          <p className="adv-und-hint">
            <strong>{(pct * 100).toFixed(0)}%</strong> of your{" "}
            {INR.format(rec.monthlyIncome)}/mo income
            {rec.incomeFromProfile ? (
              <> (your take-home)</>
            ) : rec.incomeMonths < 12 ? (
              <> (averaged over {rec.incomeMonths} month
                {rec.incomeMonths === 1 ? "" : "s"} of recorded income — set your
                take-home in Actions for accuracy)</>
            ) : null}
            .
          </p>
        </>
      )}

      <p className="adv-und-hint adv-und-hint--meta">
        <i className="fa-solid fa-circle-info" /> Shows what&apos;s actually due in{" "}
        {rec.month} — monthly commitments every month, plus periodic ones (e.g. a
        half-yearly LIC) at full amount only in the months they fall due. Card
        bills count only once the statement is generated — those due that month
        plus any still overdue — so unbilled spends aren&apos;t pulled forward.
        Income excludes borrowings.
      </p>
    </>
  );
}

function Runway({ runway }) {
  if (!runway.months) return null;
  const m = runway.months;
  const tone = m >= 6 ? "good" : m >= 3 ? "ok" : "low";
  return (
    <>
      <div className="adv-und-head">
        <h3>How long your cash lasts</h3>
      </div>
      <div className={`adv-und-runway adv-und-runway--${tone}`}>
        <span className="adv-und-runway-value">{m.toFixed(1)}</span>
        <span className="adv-und-runway-unit">months of runway</span>
      </div>
      <p className="adv-und-hint">
        At {INR.format(runway.monthlyExpense)}/mo average spending, your{" "}
        {INR.format(runway.cash)} liquid balance covers{" "}
        <strong>{m.toFixed(1)} months</strong> with no income.
      </p>
    </>
  );
}

// Financial-health score with its drivers, reusing the app's Solvency scorer.
function HealthScore({ data }) {
  const cards = data.cards ?? [];
  const commitments = data.commitments ?? [];
  const lendings = data.lendings ?? [];
  const txns = data.transactions ?? [];
  const config = data.preferences?.healthScore;
  const result = useMemo(() => {
    const enriched = cards.map((c) => ({
      ...c,
      outstanding: computeCardOutstanding(c, txns, commitments),
    }));
    return calcHealthScore(enriched, commitments, lendings, config || {});
  }, [cards, commitments, lendings, txns, config]);

  if (cards.length === 0 && commitments.length === 0 && lendings.length === 0)
    return null;

  return (
    <Section delay={0.15}>
      <div className="adv-und-head">
        <h3>Financial health</h3>
        <span className="adv-und-sub">credit &amp; obligations</span>
      </div>
      <div className="adv-health">
        <div className="adv-health-score" style={{ color: result.color }}>
          <span className="adv-health-num">{result.score}</span>
          <span className="adv-health-grade">{result.grade}</span>
        </div>
        <div className="adv-health-bar-wrap">
          <div
            className="adv-health-bar"
            style={{ width: `${result.score}%`, background: result.color }}
          />
        </div>
      </div>
      {result.deductions.length > 0 ? (
        <ul className="adv-health-list">
          {result.deductions.map((d, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={i}>
              <span>{d.reason}</span>
              <span className="adv-health-pts">−{d.points}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="adv-und-hint">
          <i className="fa-solid fa-circle-check" /> Nothing is dragging your
          score — a clean bill of health.
        </p>
      )}
    </Section>
  );
}

// Net-worth trajectory. Real monthly snapshots (persisted going forward) are
// exact; months before tracking began are estimated by walking your savings
// backwards from today's net worth (so it excludes market moves — flagged).
function NetWorthTrend({ data, current }) {
  const history = data.preferences?.netWorthHistory ?? [];
  const series = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        y: d.getFullYear(),
        m: d.getMonth(),
        label: d.toLocaleDateString("en-IN", { month: "short" }),
      });
    }
    // Monthly savings (income − expense); investments are net-worth-neutral.
    const savings = {};
    for (const t of data.transactions ?? []) {
      const d = new Date(t.occurredAt || t.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const amt = parseFloat(t.amount) || 0;
      if (t.transactionType === "income" && !t.lendingId)
        savings[key] = (savings[key] || 0) + amt;
      else if (t.transactionType === "expense")
        savings[key] = (savings[key] || 0) - amt;
    }
    const nw = new Array(months.length);
    nw[months.length - 1] = current;
    for (let i = months.length - 2; i >= 0; i--) {
      const nextKey = `${months[i + 1].y}-${months[i + 1].m}`;
      nw[i] = nw[i + 1] - (savings[nextKey] || 0);
    }
    const recorded = new Map(history.map((h) => [h.ym, h.value]));
    return months.map((mo, i) => ({
      label: mo.label,
      nw: Math.round(recorded.has(mo.ym) ? recorded.get(mo.ym) : nw[i]),
    }));
  }, [data, current, history]);

  const hasMovement = series.some((p, i) => i > 0 && p.nw !== series[0].nw);
  if (!hasMovement) return null;

  return (
    <Section delay={0.19}>
      <div className="adv-und-head">
        <h3>Net worth over time</h3>
        <span className="adv-und-sub">last 6 months</span>
      </div>
      <div className="adv-nwtrend-chart">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={series} margin={{ top: 6, right: 6, left: -6, bottom: 0 }}>
            <defs>
              <linearGradient id="nwTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1a9f63" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#1a9f63" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-label)" }} />
            <YAxis
              tickFormatter={(v) => INR_COMPACT.format(v)}
              width={44}
              tick={{ fontSize: 10, fill: "var(--text-label)" }}
            />
            <RTooltip
              formatter={(v) => [INR.format(v), "Net worth"]}
              contentStyle={{
                background: "var(--modal-bg)",
                border: "1px solid var(--surface-border-open)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="nw"
              stroke="#1a9f63"
              strokeWidth={2}
              fill="url(#nwTrendFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="adv-und-hint">
        Exact from the month tracking began; earlier months are estimated from
        your savings (they exclude market ups and downs). It sharpens each month.
      </p>
    </Section>
  );
}

// Categories whose spend this month is well above the trailing 3-month average.
function SpendingWatch({ transactions }) {
  const anomalies = useMemo(() => {
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth();
    const cur = {};
    const prior = {};
    for (const t of transactions ?? []) {
      if (t.transactionType !== "expense" || t.cardId) continue;
      const d = new Date(t.occurredAt || t.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const cat = t.category || "Other";
      const amt = parseFloat(t.amount) || 0;
      if (d.getFullYear() === cy && d.getMonth() === cm) {
        cur[cat] = (cur[cat] || 0) + amt;
      } else {
        const diff = (cy - d.getFullYear()) * 12 + (cm - d.getMonth());
        if (diff >= 1 && diff <= 3) prior[cat] = (prior[cat] || 0) + amt;
      }
    }
    const out = [];
    for (const cat of Object.keys(cur)) {
      const c = cur[cat];
      const avg = (prior[cat] || 0) / 3;
      if (avg <= 0) continue;
      if (c >= avg * 1.5 && c - avg >= 2000) {
        out.push({ cat, cur: c, avg, pct: (c - avg) / avg });
      }
    }
    return out.sort((a, b) => b.pct - a.pct).slice(0, 4);
  }, [transactions]);

  if (anomalies.length === 0) return null;
  return (
    <Section delay={0.34}>
      <div className="adv-und-head">
        <h3>Watch these categories</h3>
        <span className="adv-und-sub">above your usual</span>
      </div>
      <div className="adv-watch-list">
        {anomalies.map((a) => (
          <div key={a.cat} className="adv-watch-row">
            <span className="adv-watch-cat">{a.cat}</span>
            <span className="adv-watch-amt">
              {INR.format(a.cur)}{" "}
              <span className="adv-watch-up">▲ {(a.pct * 100).toFixed(0)}%</span>
            </span>
            <span className="adv-watch-avg">usual {INR.format(a.avg)}/mo</span>
          </div>
        ))}
      </div>
      <p className="adv-und-hint">
        Spending here is well above your recent average this month — worth a
        glance in case something slipped.
      </p>
    </Section>
  );
}

// Financial-independence progress — your "work-optional" number, how far along
// you are, and years to get there at your current savings pace.
function Fire({ data, analysis }) {
  const profile = useMemo(
    () => mergeProfile(data, data.preferences?.advisoryProfile),
    [data],
  );
  const age = new Date().getFullYear() - profile.birthYear;
  const fire = useMemo(
    () =>
      computeFire({
        monthlyExpense: analysis.runway.monthlyExpense,
        corpus: analysis.netWorth.netWorth,
        monthlyContribution: Math.max(
          0,
          analysis.recurring.monthlyIncome - analysis.runway.monthlyExpense,
        ),
        currentAge: age,
      }),
    [analysis, age],
  );
  if (!fire) return null;

  const tone = fire.pct >= 75 ? "good" : fire.pct >= 40 ? "ok" : "low";
  return (
    <Section delay={0.32}>
      <div className="adv-und-head">
        <h3>Financial independence</h3>
        <span className="adv-und-sub">the {fire.multiple}× number</span>
      </div>
      <div className="adv-fire">
        <div className="adv-fire-nums">
          <div className="adv-fire-big">
            <span className="adv-fire-pct">{fire.pct}%</span>
            <span className="adv-fire-oftarget">of the way there</span>
          </div>
          <div className="adv-fire-target">
            <span className="adv-fire-target-val">
              {INR_COMPACT.format(fire.fireNumber)}
            </span>
            <span className="adv-fire-target-lbl">FI target</span>
          </div>
        </div>
        <div className={`adv-und-bar-track adv-fire-track adv-fire-track--${tone}`}>
          <motion.div
            className={`adv-und-bar adv-fire-bar adv-fire-bar--${tone}`}
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(2, fire.pct)}%` }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        </div>
      </div>
      <p className="adv-und-hint">
        At a {(fire.swr * 100).toFixed(0)}% safe withdrawal rate you&apos;d need{" "}
        <strong>{INR.format(fire.fireNumber)}</strong> ({fire.multiple}× your{" "}
        {INR.format(fire.annualExpense)}/yr spending). You&apos;re at{" "}
        {INR.format(fire.corpus)} today
        {fire.monthlyContribution > 0 ? (
          <>
            {" "}
            and investing about {INR.format(fire.monthlyContribution)}/mo.
          </>
        ) : (
          <>.</>
        )}{" "}
        {fire.pct >= 100 ? (
          <strong>You&apos;re already financially independent — nice.</strong>
        ) : fire.reachable ? (
          <>
            At this pace that&apos;s about{" "}
            <strong>
              {fire.yearsToFI} year{fire.yearsToFI === 1 ? "" : "s"} away
            </strong>
            {fire.fiAge ? <> (around age {fire.fiAge})</> : null}.
          </>
        ) : (
          <>
            Your current savings rate doesn&apos;t close the gap within{" "}
            {60} years — investing more each month is what moves this.
          </>
        )}
      </p>
    </Section>
  );
}

// Interactive "invest ₹X/mo for Y years at Z%" corpus projection.
function WhatIf() {
  const [monthly, setMonthly] = useState(10000);
  const [years, setYears] = useState(10);
  const [rate, setRate] = useState(11);
  const r = rate / 100 / 12;
  const n = years * 12;
  const invested = monthly * n;
  const corpus = r > 0 ? monthly * ((Math.pow(1 + r, n) - 1) / r) : invested;
  const gains = corpus - invested;
  return (
    <Section delay={0.4}>
      <div className="adv-und-head">
        <h3>What if you invested…</h3>
        <span className="adv-und-sub">a quick projection</span>
      </div>
      <div className="adv-whatif-controls">
        <label className="adv-whatif-row">
          <span>
            Monthly <strong>{INR.format(monthly)}</strong>
          </span>
          <input
            type="range"
            min="500"
            max="200000"
            step="500"
            value={monthly}
            onChange={(e) => setMonthly(+e.target.value)}
          />
        </label>
        <label className="adv-whatif-row">
          <span>
            For <strong>{years} years</strong>
          </span>
          <input
            type="range"
            min="1"
            max="40"
            value={years}
            onChange={(e) => setYears(+e.target.value)}
          />
        </label>
        <label className="adv-whatif-row">
          <span>
            At <strong>{rate}%</strong> return
          </span>
          <input
            type="range"
            min="4"
            max="15"
            value={rate}
            onChange={(e) => setRate(+e.target.value)}
          />
        </label>
      </div>
      <div className="adv-whatif-out">
        <div>
          <span className="adv-whatif-label">Corpus</span>
          <span className="adv-whatif-val">{INR_COMPACT.format(corpus)}</span>
        </div>
        <div>
          <span className="adv-whatif-label">You invest</span>
          <span className="adv-whatif-val adv-whatif-val--sub">
            {INR_COMPACT.format(invested)}
          </span>
        </div>
        <div>
          <span className="adv-whatif-label">Gains</span>
          <span className="adv-whatif-val adv-whatif-val--up">
            {INR_COMPACT.format(gains)}
          </span>
        </div>
      </div>
      <p className="adv-und-hint">
        Assumes a steady monthly SIP and a constant return — real markets vary. A
        rough guide, not a guarantee.
      </p>
    </Section>
  );
}

export default function UnderstandLens() {
  const dispatch = useDispatch();
  const data = useSelector((s) => s.transactions.transactionData) ?? {};
  const analysis = useMemo(() => runAnalysis(data), [data]);

  const showTrend = analysis.trend.some((m) => m.income > 0 || m.outflow > 0);
  const showNetWorth =
    analysis.netWorth.grossAssets > 0 || analysis.netWorth.totalLiab > 0;
  const showRecurring = analysis.recurring.total > 0;

  // Record one net-worth snapshot per month, so the trend becomes exact over
  // time. Only added when a new month rolls over — never overwritten, so it
  // doesn't churn writes as prices refresh through the month.
  const netWorthHistory = data.preferences?.netWorthHistory;
  useEffect(() => {
    if (!analysis.hasData) return;
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const hist = netWorthHistory ?? [];
    if (hist.some((h) => h.ym === ym)) return;
    const next = [...hist, { ym, value: Math.round(analysis.netWorth.netWorth) }].slice(-24);
    dispatch(persistSetPreference("netWorthHistory", next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.hasData, netWorthHistory]);

  if (!analysis.hasData) {
    return (
      <motion.div
        className="adv-understand-empty"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: EASE }}
      >
        <i className="fa-solid fa-chart-line adv-understand-icon" />
        <h3>Nothing to read yet</h3>
        <p>
          Add a few transactions and this page will show where your balance
          moves, where your money goes, and how long your cash lasts.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="adv-und">
      <Section delay={0}>
        <CashFlowCard />
      </Section>
      <Section delay={0.03}>
        <Waterfall wf={analysis.waterfall} periodLabel={analysis.period.label} />
      </Section>
      <Section delay={0.06}>
        <Spending spending={analysis.spending} />
      </Section>
      <HealthScore data={data} />
      {showTrend && (
        <Section delay={0.12}>
          <Trend trend={analysis.trend} />
        </Section>
      )}
      {showNetWorth && (
        <Section delay={0.18}>
          <NetWorth nw={analysis.netWorth} />
        </Section>
      )}
      <NetWorthTrend data={data} current={analysis.netWorth.netWorth} />
      {showRecurring && (
        <Section delay={0.24}>
          <Recurring rec={analysis.recurring} />
        </Section>
      )}
      {analysis.runway.months != null && (
        <Section delay={0.3}>
          <Runway runway={analysis.runway} />
        </Section>
      )}
      <Fire data={data} analysis={analysis} />
      <SpendingWatch transactions={data.transactions} />
      <WhatIf />
    </div>
  );
}
