import { createSlice } from "@reduxjs/toolkit";

// Per-scope filter state. Transactions default to current month;
// investments default to all time so legacy / older holdings stay visible.
const defaultByScope = {
  transactions: { mode: "this-month", from: "", to: "" },
  investments: { mode: "all", from: "", to: "" },
};

const filterSlice = createSlice({
  name: "filter",
  initialState: {
    transactions: { ...defaultByScope.transactions },
    investments: { ...defaultByScope.investments },
  },
  reducers: {
    setFilter: (state, action) => {
      const { scope = "transactions", ...rest } = action.payload;
      state[scope] = { ...state[scope], ...rest };
    },
    resetFilter: () => ({
      transactions: { ...defaultByScope.transactions },
      investments: { ...defaultByScope.investments },
    }),
  },
});

export const { setFilter, resetFilter } = filterSlice.actions;
export default filterSlice.reducer;
