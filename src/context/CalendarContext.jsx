import { createContext, useCallback, useContext, useMemo, useState } from "react";
import PropTypes from "prop-types";

// App-wide Calendar modal state. Mirrors TallyContext / NotesContext — a light
// provider mounted in the shell so the Toolbox (and, later, other surfaces) can
// open it. `focusDate` optionally pre-selects a day.
const CalendarContext = createContext(null);

export const useCalendar = () => useContext(CalendarContext);

export function CalendarProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [focusDate, setFocusDate] = useState(null);

  const openCalendar = useCallback((date = null) => {
    setFocusDate(date);
    setOpen(true);
  }, []);
  const closeCalendar = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, focusDate, openCalendar, closeCalendar }),
    [open, focusDate, openCalendar, closeCalendar],
  );

  return (
    <CalendarContext.Provider value={value}>
      {children}
    </CalendarContext.Provider>
  );
}

CalendarProvider.propTypes = {
  children: PropTypes.node,
};
