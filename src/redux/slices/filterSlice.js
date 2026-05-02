import { createSlice } from "@reduxjs/toolkit";

const filterSlice = createSlice({
  name: "filter",
  initialState: {
    mode: "all", // "all" | "this-month" | "last-month" | "this-year" | "last-year" | "custom"
    from: "",
    to: "",
  },
  reducers: {
    setFilter: (state, action) => ({ ...state, ...action.payload }),
    resetFilter: () => ({ mode: "all", from: "", to: "" }),
  },
});

export const { setFilter, resetFilter } = filterSlice.actions;
export default filterSlice.reducer;
