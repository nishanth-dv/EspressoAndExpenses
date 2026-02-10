import { createSlice } from "@reduxjs/toolkit";

const transactionSlice = createSlice({
  name: "auth",
  initialState: {
    fileID: "",
    transactionData: {},
  },
  reducers: {
    setDriveFile: (state, action) => {
      state.fileID = action.payload.fileID;
      state.transactionData = action.payload.data;
    },
    addTransaction: (state, action) => {
      const oldTransactions = state.transactions;
      const newTransaction = action.payload;
      const updatedTransactions = [...oldTransactions, newTransaction].sort(
        (a, b) => b.occurredAt.localeCompare(a.occurredAt)
      );

      console.log(updatedTransactions);
      state.transactions = updatedTransactions;
    },
  },
});

export const { setDriveFile, addTransaction } = transactionSlice.actions;
export default transactionSlice.reducer;
