import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  INR,
  getSummary,
  getMonthlyTrend,
  getCategoryBreakdown,
  getPaymentSplit,
  getDailyAverage,
  getMonthDelta,
  getSpendingVelocity,
  getIncomeCoverage,
  getTransactionFrequency,
  getRecurringSpend,
} from "./dashboardUtils";
import { calcReturns, getTypeInfo } from "./investmentUtils";
import { calcHealthScore, cardUtilization, COMMITMENT_TYPES } from "./solvencyUtils";
import { CATEGORIES } from "./constants";

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtDate(iso) {
  return DATE_FMT.format(new Date(iso));
}

function fmtDateShort(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Data builders ────────────────────────────────────

function buildDashboardRows(transactions, allTransactions, insights, budgets) {
  const summary = getSummary(transactions, insights);
  const categoryData = getCategoryBreakdown(transactions);
  const paymentData = getPaymentSplit(transactions);
  const trend = getMonthlyTrend(allTransactions);
  const dailyAvg = getDailyAverage(transactions);
  const monthDelta = getMonthDelta(allTransactions);
  const velocity = getSpendingVelocity(allTransactions);
  const coverage = getIncomeCoverage(transactions);
  const freq = getTransactionFrequency(transactions);
  const recurring = getRecurringSpend(transactions);

  const rows = [];

  rows.push(["SUMMARY"]);
  rows.push(["Balance", INR.format(summary.balance)]);
  rows.push(["Total Income", INR.format(summary.totalIncome)]);
  rows.push(["Total Expenses", INR.format(summary.totalExpenses)]);
  rows.push(["Savings Rate", `${summary.savingsRate.toFixed(1)}%`]);
  rows.push([]);

  rows.push(["INSIGHTS"]);
  rows.push(["Daily Avg Spend", INR.format(dailyAvg.avg), `over ${dailyAvg.days} days`]);
  rows.push(["This Month Spend", INR.format(monthDelta.thisTotal), `vs last month: ${INR.format(monthDelta.lastTotal)}`]);
  rows.push(["Projected Month-end", INR.format(velocity.projected)]);
  rows.push(["Income Coverage", coverage.coverage !== null ? `${coverage.coverage.toFixed(1)}%` : "—"]);
  rows.push(["Expense Frequency", `${freq.txPerDay.toFixed(1)} per day`]);
  rows.push([]);

  rows.push(["CATEGORY BREAKDOWN"]);
  rows.push(["Category", "Amount", "% of Total"]);
  categoryData.forEach((c) => rows.push([c.category, INR.format(c.amount), `${c.pct}%`]));
  rows.push([]);

  rows.push(["PAYMENT MODE SPLIT"]);
  rows.push(["Mode", "Amount", "% of Total"]);
  paymentData.forEach((p) => rows.push([p.mode, INR.format(p.amount), `${p.pct}%`]));
  rows.push([]);

  rows.push(["MONTHLY TREND (LAST 6 MONTHS)"]);
  rows.push(["Month", "Income", "Expenses"]);
  trend.forEach((m) => rows.push([m.month, INR.format(m.income), INR.format(m.expense)]));
  rows.push([]);

  rows.push(["BUDGET VS ACTUAL (THIS MONTH)"]);
  rows.push(["Category", "Spent", "Budget", "Status"]);
  const now = new Date();
  CATEGORIES.forEach((cat) => {
    const spent = transactions
      .filter((t) => {
        const d = new Date(t.occurredAt);
        return (
          t.transactionType === "expense" &&
          (t.category || "Other") === cat &&
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth()
        );
      })
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    const budget = budgets[cat] || 0;
    const status =
      budget > 0
        ? spent > budget ? "Over budget" : `${((spent / budget) * 100).toFixed(0)}% used`
        : "No budget set";
    rows.push([cat, INR.format(spent), budget > 0 ? INR.format(budget) : "—", status]);
  });
  rows.push([]);

  if (recurring.length > 0) {
    rows.push(["RECURRING EXPENSES"]);
    rows.push(["Name", "Count", "Total Paid"]);
    recurring.forEach((r) => rows.push([r.name, r.count, INR.format(r.total)]));
  }

  return rows;
}

function buildTransactionRows(transactions) {
  return transactions.map((t) => [
    fmtDate(t.occurredAt),
    t.name || t.source || "—",
    t.transactionType === "income" ? "Income" : t.transactionType === "investment" ? "Investment" : "Expense",
    parseFloat(t.amount),
    t.category || "—",
    t.paymentMode || "—",
    t.description || "",
  ]);
}

function buildInvestmentRows(investments) {
  return investments.map((inv) => {
    const info = getTypeInfo(inv.type);
    const { investedAmount, currentValue, absoluteReturn, returnPct } = calcReturns(inv);
    return [
      inv.name,
      info.label,
      inv.ticker || "—",
      info.subtype === "unit" ? inv.quantity : "—",
      INR.format(investedAmount),
      INR.format(currentValue),
      INR.format(absoluteReturn),
      `${returnPct.toFixed(2)}%`,
    ];
  });
}

function buildSolvencyRows(cards, commitments, lendings) {
  const { score, grade } = calcHealthScore(cards, commitments, lendings);
  const rows = [];

  rows.push(["HEALTH SCORE"]);
  rows.push(["Score", score, "Grade", grade]);
  rows.push([]);

  rows.push(["CREDIT CARDS"]);
  rows.push(["Name", "Network", "Limit (₹)", "Outstanding (₹)", "Due Day", "Utilization %"]);
  cards.forEach((c) =>
    rows.push([
      c.name,
      c.network || "—",
      parseFloat(c.limit) || 0,
      parseFloat(c.outstanding) || 0,
      c.dueDay || "—",
      `${(cardUtilization(c) * 100).toFixed(0)}%`,
    ]),
  );
  rows.push([]);

  rows.push(["COMMITMENTS / EMIs"]);
  rows.push(["Name", "Type", "EMI / Month (₹)", "Outstanding (₹)", "Due Day"]);
  commitments.forEach((c) => {
    const typeLabel = COMMITMENT_TYPES.find((t) => t.key === c.type)?.label ?? c.type;
    rows.push([
      c.name,
      typeLabel,
      parseFloat(c.emiAmount) || 0,
      parseFloat(c.outstanding) || 0,
      c.dueDay || "—",
    ]);
  });
  rows.push([]);

  rows.push(["LENDINGS"]);
  rows.push(["Name", "Direction", "Outstanding (₹)", "Expected Return"]);
  lendings.forEach((l) =>
    rows.push([
      l.name,
      l.direction === "lent" ? "Lent" : "Borrowed",
      parseFloat(l.outstanding) || 0,
      fmtDateShort(l.expectedReturn),
    ]),
  );

  return rows;
}

// ── Excel export ─────────────────────────────────────

export function exportToExcel(
  { transactions, allTransactions, insights, budgets, investments, cards, commitments, lendings, sections },
  filterLabel,
  filterFilename,
) {
  const wb = XLSX.utils.book_new();

  if (sections.dashboard) {
    const dashRows = buildDashboardRows(transactions, allTransactions, insights, budgets);
    if (filterLabel) dashRows.unshift([], [`Filter: ${filterLabel}`]);
    const sheet = XLSX.utils.aoa_to_sheet(dashRows);
    sheet["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, sheet, "Dashboard");
  }

  if (sections.transactions) {
    const headers = ["Date & Time", "Name", "Type", "Amount (₹)", "Category", "Payment Mode", "Notes"];
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...buildTransactionRows(transactions)]);
    sheet["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, sheet, "Transactions");
  }

  if (sections.investments) {
    const headers = ["Name", "Type", "Ticker", "Quantity", "Invested", "Current Value", "Return (₹)", "Return %"];
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...buildInvestmentRows(investments)]);
    sheet["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, sheet, "Investments");
  }

  if (sections.solvency) {
    const rows = buildSolvencyRows(cards, commitments, lendings);
    if (filterLabel) rows.unshift([], [`Filter: ${filterLabel}`]);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, sheet, "Solvency");
  }

  XLSX.writeFile(wb, `${filterFilename || "Expenses"}.xlsx`);
}

// ── PDF export ───────────────────────────────────────

const PDF_NUM = new Intl.NumberFormat("en-IN");
function pdfMoney(v) {
  return `Rs. ${PDF_NUM.format(Math.round(v))}`;
}

const PDF_FONT = "helvetica";

const PDF_STYLES = {
  headStyles: {
    fillColor: [8, 8, 22],
    textColor: [224, 214, 213],
    fontStyle: "bold",
    fontSize: 9,
    font: PDF_FONT,
  },
  bodyStyles: { fontSize: 9, font: PDF_FONT },
  alternateRowStyles: { fillColor: [245, 238, 235] },
  margin: { left: 14, right: 14 },
};

function pdfPageTitle(doc, title, subtitle) {
  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(18);
  doc.setTextColor(8, 8, 22);
  doc.text(title, 14, 16);
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont(PDF_FONT, "normal");
    doc.setTextColor(100, 100, 120);
    doc.text(subtitle, 14, 22);
  }
  return subtitle ? 28 : 22;
}

function pdfSection(doc, title, head, body, startY) {
  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(11);
  doc.setTextColor(8, 8, 22);
  doc.text(title, 14, startY);
  autoTable(doc, { head: [head], body, startY: startY + 4, ...PDF_STYLES });
  return doc.lastAutoTable.finalY + 8;
}

export function exportToPDF(
  { transactions, allTransactions, insights, budgets, investments, cards, commitments, lendings, sections },
  filterLabel,
  filterFilename,
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const subtitle = filterLabel ? `Filter: ${filterLabel}` : null;
  let firstPage = true;

  function nextPage() {
    if (!firstPage) doc.addPage();
    firstPage = false;
  }

  // ── Dashboard ──────────────────────────────────────
  if (sections.dashboard) {
    nextPage();
    let y = pdfPageTitle(doc, "Dashboard", subtitle);
    const summary = getSummary(transactions, insights);
    const categoryData = getCategoryBreakdown(transactions);
    const paymentData = getPaymentSplit(transactions);
    const trend = getMonthlyTrend(allTransactions);
    const monthDelta = getMonthDelta(allTransactions);
    const velocity = getSpendingVelocity(allTransactions);
    const recurring = getRecurringSpend(transactions);
    const now = new Date();

    y = pdfSection(doc, "Summary", ["Metric", "Value"], [
      ["Balance", pdfMoney(summary.balance)],
      ["Total Income", pdfMoney(summary.totalIncome)],
      ["Total Expenses", pdfMoney(summary.totalExpenses)],
      ["Savings Rate", `${summary.savingsRate.toFixed(1)}%`],
      ["This Month vs Last", `${pdfMoney(monthDelta.thisTotal)} (last: ${pdfMoney(monthDelta.lastTotal)})`],
      ["Projected Month-end", pdfMoney(velocity.projected)],
    ], y);

    if (categoryData.length > 0)
      y = pdfSection(doc, "Category Breakdown", ["Category", "Amount", "% of Total"],
        categoryData.map((c) => [c.category, pdfMoney(c.amount), `${c.pct}%`]), y);

    if (paymentData.length > 0)
      y = pdfSection(doc, "Payment Mode Split", ["Mode", "Amount", "% of Total"],
        paymentData.map((p) => [p.mode, pdfMoney(p.amount), `${p.pct}%`]), y);

    y = pdfSection(doc, "Monthly Trend (Last 6 Months)", ["Month", "Income", "Expenses"],
      trend.map((m) => [m.month, pdfMoney(m.income), pdfMoney(m.expense)]), y);

    const budgetRows = CATEGORIES.map((cat) => {
      const spent = allTransactions
        .filter((t) => {
          const d = new Date(t.occurredAt);
          return t.transactionType === "expense" && (t.category || "Other") === cat
            && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        })
        .reduce((s, t) => s + parseFloat(t.amount), 0);
      const budget = budgets[cat] || 0;
      return [cat, pdfMoney(spent), budget > 0 ? pdfMoney(budget) : "—",
        budget > 0 ? (spent > budget ? "Over" : `${((spent / budget) * 100).toFixed(0)}%`) : "—"];
    });
    y = pdfSection(doc, "Budget vs Actual (This Month)", ["Category", "Spent", "Budget", "Used"], budgetRows, y);

    if (recurring.length > 0)
      pdfSection(doc, "Recurring Expenses", ["Name", "Count", "Total"],
        recurring.map((r) => [r.name, String(r.count), pdfMoney(r.total)]), y);
  }

  // ── Transactions ───────────────────────────────────
  if (sections.transactions) {
    nextPage();
    const y = pdfPageTitle(doc, "Transactions", subtitle);
    autoTable(doc, {
      head: [["Date & Time", "Name", "Type", "Amount", "Category", "Mode"]],
      body: transactions.map((t) => [
        fmtDate(t.occurredAt),
        t.name || t.source || "—",
        t.transactionType === "income" ? "Income" : t.transactionType === "investment" ? "Investment" : "Expense",
        pdfMoney(parseFloat(t.amount)),
        t.category || "—",
        t.paymentMode || "—",
      ]),
      startY: y,
      ...PDF_STYLES,
      columnStyles: { 0: { cellWidth: 32 }, 2: { cellWidth: 20 }, 3: { cellWidth: 22 } },
    });
  }

  // ── Investments ────────────────────────────────────
  if (sections.investments) {
    nextPage();
    let y = pdfPageTitle(doc, "Investments", subtitle);
    if (investments.length === 0) {
      doc.setFontSize(11);
      doc.setTextColor(120, 120, 140);
      doc.text("No investments recorded.", 14, y);
    } else {
      autoTable(doc, {
        head: [["Name", "Type", "Ticker", "Qty", "Invested", "Current", "Return", "Return %"]],
        body: investments.map((inv) => {
          const info = getTypeInfo(inv.type);
          const { investedAmount, currentValue, absoluteReturn, returnPct } = calcReturns(inv);
          return [
            inv.name,
            info.label,
            inv.ticker || "—",
            info.subtype === "unit" ? String(inv.quantity) : "—",
            pdfMoney(investedAmount),
            pdfMoney(currentValue),
            pdfMoney(absoluteReturn),
            `${returnPct.toFixed(1)}%`,
          ];
        }),
        startY: y,
        ...PDF_STYLES,
        columnStyles: { 0: { cellWidth: 36 }, 1: { cellWidth: 20 } },
      });
    }
  }

  // ── Solvency ───────────────────────────────────────
  if (sections.solvency) {
    nextPage();
    let y = pdfPageTitle(doc, "Solvency", subtitle);
    const { score, grade } = calcHealthScore(cards, commitments, lendings);

    y = pdfSection(doc, "Health Score", ["Score", "Grade"],
      [[String(score), grade]], y);

    if (cards.length > 0)
      y = pdfSection(doc, "Credit Cards",
        ["Name", "Network", "Limit", "Outstanding", "Due Day", "Utilization"],
        cards.map((c) => [
          c.name, c.network || "—", pdfMoney(parseFloat(c.limit) || 0),
          pdfMoney(parseFloat(c.outstanding) || 0), c.dueDay || "—",
          `${(cardUtilization(c) * 100).toFixed(0)}%`,
        ]), y);

    if (commitments.length > 0)
      y = pdfSection(doc, "Commitments / EMIs",
        ["Name", "Type", "EMI / Month", "Outstanding", "Due Day"],
        commitments.map((c) => {
          const typeLabel = COMMITMENT_TYPES.find((t) => t.key === c.type)?.label ?? c.type;
          return [c.name, typeLabel, pdfMoney(parseFloat(c.emiAmount) || 0),
            pdfMoney(parseFloat(c.outstanding) || 0), c.dueDay || "—"];
        }), y);

    if (lendings.length > 0)
      pdfSection(doc, "Lendings",
        ["Name", "Direction", "Outstanding", "Expected Return"],
        lendings.map((l) => [
          l.name, l.direction === "lent" ? "Lent" : "Borrowed",
          pdfMoney(parseFloat(l.outstanding) || 0), fmtDateShort(l.expectedReturn),
        ]), y);
  }

  doc.save(`${filterFilename || "Expenses"}.pdf`);
}
