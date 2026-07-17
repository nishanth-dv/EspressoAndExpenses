import { useSelector } from "react-redux";
import { useTally } from "../context/TallyContext";
import { useNotes } from "../context/NotesContext";
import { useCalendar } from "../context/CalendarContext";

export function useToolkitTools() {
  const { start } = useTally();
  const { openNotes } = useNotes();
  const { openCalendar } = useCalendar();
  const tallyEnabled = useSelector(
    (s) => s.transactions.transactionData?.preferences?.tallyEnabled ?? true,
  );
  const notesEnabled = useSelector(
    (s) => s.transactions.transactionData?.preferences?.notesEnabled ?? true,
  );
  const calendarEnabled = useSelector(
    (s) => s.transactions.transactionData?.preferences?.calendarEnabled ?? true,
  );

  const tools = [];
  if (tallyEnabled)
    tools.push({
      key: "tally",
      label: "Tally",
      sub: "Tap amounts to add them up",
      icon: "fa-arrow-down-up-across-line",
      run: start,
    });
  if (notesEnabled)
    tools.push({
      key: "notes",
      label: "Notes",
      sub: "Jot a note or checklist",
      icon: "fa-note-sticky",
      run: () => openNotes(),
    });
  if (calendarEnabled)
    tools.push({
      key: "calendar",
      label: "Calendar",
      sub: "Upcoming dues & spending",
      icon: "fa-calendar-days",
      run: () => openCalendar(),
    });
  return tools;
}
