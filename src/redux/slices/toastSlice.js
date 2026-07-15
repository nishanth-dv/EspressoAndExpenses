import { createSlice } from "@reduxjs/toolkit";

let _id = 1;

const toastSlice = createSlice({
  name: "toast",
  initialState: { toasts: [] },
  reducers: {
    showToast: {
      reducer(state, action) {
        state.toasts.push(action.payload);
        if (state.toasts.length > 4) state.toasts.shift();
      },
      prepare({ message, type = "success", duration = 3500, action = null }) {
        return { payload: { id: _id++, message, type, duration, action } };
      },
    },
    dismissToast(state, action) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
  },
});

export const { showToast, dismissToast } = toastSlice.actions;
export default toastSlice.reducer;
