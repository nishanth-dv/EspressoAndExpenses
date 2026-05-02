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

// ── Shared data builders ─────────────────────────────

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
  CATEGORIES.forEach((cat) => {
    const spent = transactions
      .filter((t) => {
        const d = new Date(t.occurredAt);
        const now = new Date();
        return (
          t.transactionType === "expense" &&
          (t.category || "Other") === cat &&
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth()
        );
      })
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    const budget = budgets[cat] || 0;
    const status = budget > 0 ? (spent > budget ? "Over budget" : `${((spent / budget) * 100).toFixed(0)}% used`) : "No budget set";
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
    t.transactionType === "income" ? "Income" : "Expense",
    parseFloat(t.amount),
    t.category || "—",
    t.paymentMode || "—",
    t.description || "",
  ]);
}

// ── Excel export ─────────────────────────────────────

export function exportToExcel(transactions, allTransactions, insights, budgets, filterLabel, filterFilename) {
  const wb = XLSX.utils.book_new();

  // Dashboard sheet
  const dashRows = buildDashboardRows(transactions, allTransactions, insights, budgets);
  if (filterLabel) dashRows.unshift([], [`Filter: ${filterLabel}`]);
  const dashSheet = XLSX.utils.aoa_to_sheet(dashRows);
  dashSheet["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, dashSheet, "Dashboard");

  // Transactions sheet
  const txHeaders = ["Date & Time", "Name", "Type", "Amount (₹)", "Category", "Payment Mode", "Notes"];
  const txRows = buildTransactionRows(transactions);
  const txSheet = XLSX.utils.aoa_to_sheet([txHeaders, ...txRows]);
  txSheet["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, txSheet, "Transactions");

  // Investments sheet (placeholder)
  const invSheet = XLSX.utils.aoa_to_sheet([
    ["Investments"],
    [],
    ["No investment data available yet."],
  ]);
  XLSX.utils.book_append_sheet(wb, invSheet, "Investments");

  const filename = filterFilename ? `${filterFilename}.xlsx` : "Expenses.xlsx";

  XLSX.writeFile(wb, filename);
}

// ── PDF export ───────────────────────────────────────

// jsPDF's built-in fonts don't include the ₹ glyph; use "Rs." instead
const PDF_NUM = new Intl.NumberFormat("en-IN");
function pdfMoney(v) {
  return `Rs. ${PDF_NUM.format(Math.round(v))}`;
}

const PDF_FONT = "helvetica";

const PDF_STYLES = {
  headStyles: { fillColor: [8, 8, 22], textColor: [224, 214, 213], fontStyle: "bold", fontSize: 9, font: PDF_FONT },
  bodyStyles: { fontSize: 9, font: PDF_FONT },
  alternateRowStyles: { fillColor: [245, 238, 235] },
  margin: { left: 14, right: 14 },
};

function pdfSection(doc, title, head, body, startY) {
  doc.setFont(PDF_FONT, "bold");
  doc.setFontSize(11);
  doc.setTextColor(8, 8, 22);
  doc.text(title, 14, startY);
  autoTable(doc, {
    head: [head],
    body,
    startY: startY + 4,
    ...PDF_STYLES,
  });
  return doc.lastAutoTable.finalY + 8;
}

export function exportToPDF(transactions, allTransactions, insights, budgets, filterLabel, filterFilename) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const summary = getSummary(transactions, insights);
  const categoryData = getCategoryBreakdown(transactions);
  const paymentData = getPaymentSplit(transactions);
  const trend = getMonthlyTrend(allTransactions);
  const monthDelta = getMonthDelta(allTransactions);
  const velocity = getSpendingVelocity(allTransactions);
  const recurring = getRecurringSpend(transactions);

  // ── Page 1: Dashboard ──────────────────────────────
  doc.setFont(PDF_FONT);
  doc.setFontSize(18);
  doc.setTextColor(8, 8, 22);
  doc.text("Dashboard", 14, 16);
  if (filterLabel) {
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 120);
    doc.text(`Filter: ${filterLabel}`, 14, 22);
  }

  let y = filterLabel ? 28 : 22;

  y = pdfSection(doc, "Summary", ["Metric", "Value"], [
    ["Balance", pdfMoney(summary.balance)],
    ["Total Income", pdfMoney(summary.totalIncome)],
    ["Total Expenses", pdfMoney(summary.totalExpenses)],
    ["Savings Rate", `${summary.savingsRate.toFixed(1)}%`],
    ["This Month vs Last", `${pdfMoney(monthDelta.thisTotal)} (last: ${pdfMoney(monthDelta.lastTotal)})`],
    ["Projected Month-end", pdfMoney(velocity.projected)],
  ], y);

  if (categoryData.length > 0) {
    y = pdfSection(doc, "Category Breakdown", ["Category", "Amount", "% of Total"],
      categoryData.map((c) => [c.category, pdfMoney(c.amount), `${c.pct}%`]), y);
  }

  if (paymentData.length > 0) {
    y = pdfSection(doc, "Payment Mode Split", ["Mode", "Amount", "% of Total"],
      paymentData.map((p) => [p.mode, pdfMoney(p.amount), `${p.pct}%`]), y);
  }

  y = pdfSection(doc, "Monthly Trend (Last 6 Months)", ["Month", "Income", "Expenses"],
    trend.map((m) => [m.month, pdfMoney(m.income), pdfMoney(m.expense)]), y);

  const now = new Date();
  const budgetRows = CATEGORIES.map((cat) => {
    const spent = allTransactions
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
    return [cat, pdfMoney(spent), budget > 0 ? pdfMoney(budget) : "—",
      budget > 0 ? (spent > budget ? "Over" : `${((spent / budget) * 100).toFixed(0)}%`) : "—"];
  });
  y = pdfSection(doc, "Budget vs Actual (This Month)",
    ["Category", "Spent", "Budget", "Used"], budgetRows, y);

  if (recurring.length > 0) {
    pdfSection(doc, "Recurring Expenses", ["Name", "Count", "Total"],
      recurring.map((r) => [r.name, String(r.count), pdfMoney(r.total)]), y);
  }

  // ── Page 2: Transactions ───────────────────────────
  doc.addPage();
  doc.setFont(PDF_FONT);
  doc.setFontSize(18);
  doc.setTextColor(8, 8, 22);
  doc.text("Transactions", 14, 16);
  if (filterLabel) {
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 120);
    doc.text(`Filter: ${filterLabel}`, 14, 22);
  }

  autoTable(doc, {
    head: [["Date & Time", "Name", "Type", "Amount", "Category", "Mode"]],
    body: transactions.map((t) => [
      fmtDate(t.occurredAt),
      t.name || t.source || "—",
      t.transactionType === "income" ? "Income" : "Expense",
      pdfMoney(parseFloat(t.amount)),
      t.category || "—",
      t.paymentMode || "—",
    ]),
    startY: filterLabel ? 28 : 22,
    ...PDF_STYLES,
    columnStyles: { 0: { cellWidth: 32 }, 2: { cellWidth: 18 }, 3: { cellWidth: 22 } },
  });

  // ── Page 3: Investments ────────────────────────────
  doc.addPage();
  doc.setFont(PDF_FONT);
  doc.setFontSize(18);
  doc.setTextColor(8, 8, 22);
  doc.text("Investments", 14, 16);
  doc.setFontSize(11);
  doc.setTextColor(120, 120, 140);
  doc.text("No investment data available yet.", 14, 28);

  const filename = filterFilename ? `${filterFilename}.pdf` : "Expenses.pdf";

  doc.save(filename);
}
