function getDateRange(filter) {
  const now = new Date();
  let from = null;
  let to = null;
  if (filter.mode === "this-month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (filter.mode === "last-month") {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  } else if (filter.mode === "this-year") {
    from = new Date(now.getFullYear(), 0, 1);
    to = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else if (filter.mode === "last-year") {
    from = new Date(now.getFullYear() - 1, 0, 1);
    to = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
  } else if (filter.mode === "custom") {
    if (filter.from) from = new Date(filter.from);
    if (filter.to) to = new Date(filter.to + "T23:59:59.999");
  }
  return { from, to };
}

export function applyFilter(transactions, filter) {
  const accountId = filter?.accountId || null;
  const cardId = filter?.cardId || null;
  if (filter.mode === "all" && !accountId && !cardId) return transactions;
  const { from, to } = getDateRange(filter);
  return transactions.filter((t) => {
    if (from || to) {
      const d = new Date(t.occurredAt);
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
    if (cardId && t.cardId !== cardId) return false;
    if (accountId) {
      // Self transfers touch the account if it's either side.
      if (t.transactionType === "self_transfer") {
        if (t.fromAccountId !== accountId && t.toAccountId !== accountId) {
          return false;
        }
      } else if (t.accountId !== accountId) {
        return false;
      }
    }
    return true;
  });
}

export function filterInvestmentsByDate(investments, filter) {
  if (filter.mode === "all") return investments;
  const { from, to } = getDateRange(filter);
  return investments.filter((inv) => {
    const raw = new Date(inv.startDate);
    const d = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
    if (inv.type === "sip") {
      // A SIP is active from startDate onward with no end date.
      // Show it whenever the filter period overlaps that range,
      // i.e. the SIP had already started before the period ends.
      if (to && d > to) return false;
      return true;
    }
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

export function getFilterFilename(filter) {
  const now = new Date();
  const month = (d) => d.toLocaleString("en-US", { month: "long" });
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (filter.mode === "all")
    return `${String(now.getDate()).padStart(2, "0")} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  if (filter.mode === "this-month") return `${month(now)} ${now.getFullYear()}`;
  if (filter.mode === "last-month") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${month(d)} ${d.getFullYear()}`;
  }
  if (filter.mode === "this-year") return `${now.getFullYear()}`;
  if (filter.mode === "last-year") return `${now.getFullYear() - 1}`;
  if (filter.mode === "custom") {
    if (filter.from && filter.to) return `${filter.from} to ${filter.to}`;
    if (filter.from) return `From ${filter.from}`;
    if (filter.to) return `Until ${filter.to}`;
  }
  return `${String(now.getDate()).padStart(2, "0")} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

export function getFilterLabel(filter) {
  const now = new Date();
  if (filter.mode === "all") return null;
  if (filter.mode === "this-month")
    return now.toLocaleString("en-IN", { month: "long", year: "numeric" });
  if (filter.mode === "last-month") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
  }
  if (filter.mode === "this-year") return `Year ${now.getFullYear()}`;
  if (filter.mode === "last-year") return `Year ${now.getFullYear() - 1}`;
  if (filter.mode === "custom") {
    if (filter.from && filter.to) return `${filter.from}  →  ${filter.to}`;
    if (filter.from) return `From ${filter.from}`;
    if (filter.to) return `Until ${filter.to}`;
    return "Custom range";
  }
  return null;
}
