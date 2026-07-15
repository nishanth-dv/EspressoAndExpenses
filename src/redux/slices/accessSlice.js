import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { fetchPageAccess } from "../../utils/access";

export const loadAccess = createAsyncThunk("access/load", async () => {
  return fetchPageAccess();
});

const accessSlice = createSlice({
  name: "access",
  initialState: { status: "idle", pages: [], isAdmin: false },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadAccess.pending, (state) => {
        state.status = "loading";
      })
      .addCase(loadAccess.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.pages = action.payload.pages;
        state.isAdmin = action.payload.isAdmin;
      })
      .addCase(loadAccess.rejected, (state) => {
        state.status = "failed";
        state.pages = [];
        state.isAdmin = false;
      });
  },
});

export default accessSlice.reducer;
