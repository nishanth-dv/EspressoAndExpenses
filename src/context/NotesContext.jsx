import { createContext, useCallback, useContext, useMemo, useState } from "react";
import PropTypes from "prop-types";

// App-wide Notes drawer state. Mirrors TallyContext: a light provider mounted
// in the shell so any surface (the Toolbox launcher today, entity ⋯-menus in
// Phase 2) can open the drawer. `context` carries an optional default scope for
// a brand-new note — e.g. { entityRef } when opened from a specific card.
const NotesContext = createContext(null);

export const useNotes = () => useContext(NotesContext);

export function NotesProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState(null);

  const openNotes = useCallback((ctx = null) => {
    setContext(ctx);
    setOpen(true);
  }, []);
  const closeNotes = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, context, openNotes, closeNotes }),
    [open, context, openNotes, closeNotes],
  );

  return (
    <NotesContext.Provider value={value}>{children}</NotesContext.Provider>
  );
}

NotesProvider.propTypes = {
  children: PropTypes.node,
};
