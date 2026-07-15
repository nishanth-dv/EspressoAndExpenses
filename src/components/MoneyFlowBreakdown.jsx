import { memo, useMemo } from "react";
import { useSelector } from "react-redux";
import { INR } from "../utils/dashboardUtils";
import BankLogo from "./BankLogo";

function buildBankExpenseBreakdown(accounts, transactions) {
  const now = new Date();
  const yr = now.getFullYear();
  const mo = now.getMonth();
  const inMonth = (t) => {
    if (!t.occurredAt) return false;
    const d = new Date(t.occurredAt);
    return d.getFullYear() === yr && d.getMonth() === mo;
  };

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const byAccount = new Map();
  const totalByAccount = new Map();

  for (const t of transactions) {
    if (!inMonth(t)) continue;
    if (t.transactionType !== "expense" || t.cardId) continue;
    if (!t.accountId || !accountById.has(t.accountId)) continue;
    const amt = parseFloat(t.amount) || 0;
    if (amt <= 0) continue;
    const cat = t.category || "Other";
    const m = byAccount.get(t.accountId) ?? new Map();
    m.set(cat, (m.get(cat) || 0) + amt);
    byAccount.set(t.accountId, m);
    totalByAccount.set(
      t.accountId,
      (totalByAccount.get(t.accountId) || 0) + amt,
    );
  }

  const banks = [];
  for (const a of accounts) {
    const m = byAccount.get(a.id);
    const total = totalByAccount.get(a.id) || 0;
    if (!m || total <= 0) continue;
    const cats = [...m.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((x, y) => y.amount - x.amount);
    banks.push({
      id: a.id,
      name: a.bank || a.name || "Bank",
      color: a.color || "#5b8dee",
      total,
      cats,
    });
  }
  banks.sort((x, y) => y.total - x.total);
  return banks.length ? banks : null;
}

const MoneyFlowBreakdown = () => {
  const multiBankEnabled = useSelector(
    (state) =>
      state.transactions.transactionData?.preferences?.multiBankEnabled ??
      false,
  );
  const accounts = useSelector(
    (state) => state.transactions.transactionData?.accounts ?? [],
  );
  const transactions = useSelector(
    (state) => state.transactions.transactionData?.transactions ?? [],
  );

  const banks = useMemo(
    () =>
      multiBankEnabled && accounts.length > 0
        ? buildBankExpenseBreakdown(accounts, transactions)
        : null,
    [multiBankEnabled, accounts, transactions],
  );

  if (!multiBankEnabled) return null;
  if (!banks) {
    return (
      <div className="dash-section money-flow money-flow--empty">
        <p className="dash-section-title">Spending by bank · this month</p>
        <p className="money-flow-empty">
          No tagged spending this month yet. Tag a few expenses to a bank and
          they&apos;ll start showing up here.
        </p>
      </div>
    );
  }

  return (
    <div className="dash-section money-flow">
      <p className="dash-section-title">Spending by bank · this month</p>
      <p className="money-flow-sub">
        How each bank&apos;s spending splits across categories
      </p>
      <div className="bank-split-grid">
        {banks.map((b) => (
          <div key={b.id} className="bank-split-card">
            <div className="bank-split-head">
              <BankLogo bank={b.name} color={b.color} size={20} />
              <span className="bank-split-name">{b.name}</span>
              <span className="bank-split-total">{INR.format(b.total)}</span>
            </div>
            <div className="bank-split-rows">
              {b.cats.map((c) => (
                <div key={c.category} className="bank-split-row">
                  <span className="bank-split-cat" title={c.category}>
                    {c.category}
                  </span>
                  <span className="bank-split-track">
                    <span
                      className="bank-split-fill"
                      style={{
                        width: `${Math.max(4, (c.amount / b.total) * 100)}%`,
                        background: b.color,
                      }}
                    />
                  </span>
                  <span className="bank-split-amt">{INR.format(c.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default memo(MoneyFlowBreakdown);
