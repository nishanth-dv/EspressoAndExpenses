import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useDeepLinkNav } from "../../hooks/useDeepLinkNav";
import Modal from "../../preStyledElements/modal/Modal";
import Scroller from "../Scroller";
import { INR } from "../../utils/dashboardUtils";
import { useCalendar } from "../../context/CalendarContext";
import { useNotes } from "../../context/NotesContext";
import {
  deriveCalendarEvents,
  agendaBuckets,
  eventsOnDay,
  monthDayIndex,
  monthMatrix,
  dayKey,
  bucketLoad,
} from "../../utils/calendarUtils";
import "../../styles/calendar.css";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function dotColor(dot) {
  if (dot.kind === "reminder") return "#0ea5e9";
  if (dot.kind === "maturity") return "#9b59b6";
  if (dot.kind === "tax") return "#14b8a6";
  if (dot.severity === "urgent") return "#ef4444";
  if (dot.severity === "warn") return "#f59e0b";
  return "#64748b";
}

function dateFromKey(key, hour = 9) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0);
}

function fmtDayLabel(iso) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function ActualAmount({ e }) {
  const cls =
    e.txType === "income"
      ? "cal-amt cal-amt--income"
      : e.txType === "investment"
        ? "cal-amt cal-amt--invest"
        : e.txType === "self_transfer"
          ? "cal-amt"
          : "cal-amt cal-amt--expense";
  const sign = e.txType === "income" ? "+" : e.txType === "expense" ? "−" : "";
  return (
    <span className={cls}>
      {sign}
      {INR.format(e.amount)}
    </span>
  );
}

function EventRow({ e, showDay, onNavigate }) {
  const clickable = !!e.href;
  return (
    <button
      type="button"
      className={`cal-row${clickable ? "" : " cal-row--static"}${e.status === "paid" ? " cal-row--paid" : ""}`}
      onClick={() => clickable && onNavigate(e.href)}
    >
      <span className={`cal-row-icon cal-row-icon--${e.kind}`}>
        <i className={`fa-solid ${e.icon}`} />
      </span>
      <span className="cal-row-main">
        <span className="cal-row-title">{e.title}</span>
        <span className="cal-row-sub">
          {showDay && <span className="cal-row-day">{fmtDayLabel(e.date)}</span>}
          {e.status === "paid" && (
            <span className="cal-chip cal-chip--paid">
              <i className="fa-solid fa-check" /> Paid
            </span>
          )}
          {e.status === "overdue" && (
            <span className="cal-chip cal-chip--overdue">Overdue</span>
          )}
          {e.status === "due" && (
            <span className="cal-chip cal-chip--due">Due</span>
          )}
          {e.subtitle && e.kind === "actual" && (
            <span className="cal-row-cat">{e.subtitle}</span>
          )}
        </span>
        {e.hint && e.status !== "paid" && (
          <span className="cal-row-hint">{e.hint}</span>
        )}
      </span>
      {e.kind === "actual" ? (
        <ActualAmount e={e} />
      ) : (
        e.amount != null && <span className="cal-amt">{INR.format(e.amount)}</span>
      )}
    </button>
  );
}

export default function CalendarModal() {
  const { open, focusDate, closeCalendar } = useCalendar();
  const { openNotes } = useNotes();
  const deepNav = useDeepLinkNav();
  const data = useSelector((s) => s.transactions.transactionData);
  const prefs = data?.preferences;

  const [view, setView] = useState("month");
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(null);

  const events = useMemo(
    () => deriveCalendarEvents(data, prefs),
    [data, prefs],
  );

  useEffect(() => {
    if (!open) {
      setView("month");
      setSelectedDay(null);
      return;
    }
    if (focusDate) {
      const d = new Date(focusDate);
      setView("month");
      setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
      setSelectedDay(dayKey(d));
    }
  }, [open, focusDate]);

  const go = (href) => {
    closeCalendar();
    deepNav(href);
  };

  const addReminder = (key) => {
    closeCalendar();
    openNotes({ seedNote: { remindAt: dateFromKey(key).toISOString() } });
  };

  const buckets = useMemo(() => agendaBuckets(events), [events]);
  const dayIndex = useMemo(() => monthDayIndex(events), [events]);
  const weeks = useMemo(() => monthMatrix(monthCursor), [monthCursor]);
  const maxSpend = useMemo(() => {
    let m = 0;
    dayIndex.forEach((v) => {
      if (v.spend > m) m = v.spend;
    });
    return m;
  }, [dayIndex]);

  const todayKey = dayKey(new Date());
  const cursorMonth = monthCursor.getMonth();

  const agendaSections = [
    { key: "overdue", label: "Overdue", items: buckets.overdue },
    { key: "today", label: "Today", items: buckets.today },
    { key: "week", label: "This week", items: buckets.week },
    { key: "later", label: "Later", items: buckets.later },
  ].filter((s) => s.items.length);

  const dayEvents = selectedDay ? eventsOnDay(events, selectedDay) : [];
  const dayPending = dayEvents.filter((e) => e.kind !== "actual");
  const dayActuals = dayEvents.filter((e) => e.kind === "actual");

  const shiftMonth = (delta) =>
    setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));

  return (
    <Modal open={open} onClose={closeCalendar} title="Calendar">
      <div className="cal-modal">
        <div className="cal-viewtabs">
          <button
            type="button"
            className={`cal-viewtab${view === "month" ? " cal-viewtab--active" : ""}`}
            onClick={() => setView("month")}
          >
            <i className="fa-solid fa-calendar-days" /> Month
          </button>
          <button
            type="button"
            className={`cal-viewtab${view === "agenda" ? " cal-viewtab--active" : ""}`}
            onClick={() => setView("agenda")}
          >
            <i className="fa-solid fa-list-ul" /> Agenda
          </button>
        </div>

        {view === "agenda" && (
          <Scroller className="cal-agenda">
            {agendaSections.length === 0 ? (
              <div className="cal-empty">
                <i className="fa-solid fa-calendar-check" />
                <p>Nothing coming up.</p>
                <p className="cal-empty-sub">
                  Dues, renewals, debits and reminders will show here.
                </p>
              </div>
            ) : (
              agendaSections.map((s) => {
                const load = s.key === "week" ? bucketLoad(s.items) : null;
                return (
                  <div className="cal-section" key={s.key}>
                    <p className="cal-section-title">{s.label}</p>
                    {load && load.count >= 3 && (
                      <p className="cal-pileup">
                        <i className="fa-solid fa-triangle-exclamation" />{" "}
                        {load.count} payments this week
                        {load.total > 0 ? ` · ${INR.format(load.total)}` : ""}
                      </p>
                    )}
                    {s.items.map((e) => (
                      <EventRow key={e.id} e={e} showDay onNavigate={go} />
                    ))}
                  </div>
                );
              })
            )}
          </Scroller>
        )}

        {view === "month" && (
          <div className="cal-month">
            <div className="cal-monthnav">
              <button
                type="button"
                className="cal-navbtn"
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
              >
                <i className="fa-solid fa-chevron-left" />
              </button>
              <span className="cal-monthlabel">
                {MONTHS[cursorMonth]} {monthCursor.getFullYear()}
              </span>
              <button
                type="button"
                className="cal-navbtn"
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
              >
                <i className="fa-solid fa-chevron-right" />
              </button>
            </div>

            <div className="cal-grid cal-grid--head">
              {WEEKDAYS.map((w, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <span key={i} className="cal-weekday">
                  {w}
                </span>
              ))}
            </div>

            {weeks.map((row, wi) => (
              // eslint-disable-next-line react/no-array-index-key
              <div className="cal-grid" key={wi}>
                {row.map((date) => {
                  const key = dayKey(date);
                  const entry = dayIndex.get(key);
                  const spend = entry?.spend || 0;
                  const alpha =
                    maxSpend > 0 && spend > 0
                      ? Math.min(0.5, 0.12 + 0.38 * (spend / maxSpend))
                      : 0;
                  const outside = date.getMonth() !== cursorMonth;
                  const isToday = key === todayKey;
                  const isSel = key === selectedDay;
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`cal-cell${outside ? " cal-cell--out" : ""}${isToday ? " cal-cell--today" : ""}${isSel ? " cal-cell--sel" : ""}${entry?.busy ? " cal-cell--busy" : ""}`}
                      style={
                        alpha
                          ? { background: `rgba(220, 80, 80, ${alpha})` }
                          : undefined
                      }
                      onClick={() => setSelectedDay(key)}
                    >
                      <span className="cal-cell-num">{date.getDate()}</span>
                      {entry?.dots?.length > 0 && (
                        <span className="cal-cell-dots">
                          {entry.dots.slice(0, 3).map((d, di) => (
                            <span
                              // eslint-disable-next-line react/no-array-index-key
                              key={di}
                              className="cal-dot"
                              style={{ background: dotColor(d) }}
                            />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {selectedDay && (
              <div className="cal-daysheet">
                <div className="cal-daysheet-head">
                  <span className="cal-daysheet-title">
                    {fmtDayLabel(dateFromKey(selectedDay).toISOString())}
                  </span>
                  <button
                    type="button"
                    className="cal-daysheet-add"
                    onClick={() => addReminder(selectedDay)}
                  >
                    <i className="fa-solid fa-bell" /> Add reminder
                  </button>
                </div>
                {dayEvents.length === 0 ? (
                  <p className="cal-daysheet-empty">
                    Nothing on this day.
                  </p>
                ) : (
                  <>
                    {dayPending.map((e) => (
                      <EventRow key={e.id} e={e} onNavigate={go} />
                    ))}
                    {dayActuals.map((e) => (
                      <EventRow key={e.id} e={e} onNavigate={go} />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
