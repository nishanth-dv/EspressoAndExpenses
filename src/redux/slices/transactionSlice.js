import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { createOrFetchFile, updateFile } from "../../utils/googleDrive";
import { DEFAULT_DATA } from "../../utils/constants";

export const initializeDrive = createAsyncThunk(
  "transactions/initializeDrive",
  async () => {
    const { fileId, data } = await createOrFetchFile("espresso-expenses.json", DEFAULT_DATA);
    return { fileId, data };
  }
);

const transactionSlice = createSlice({
  name: "transactions",
  initialState: {
    fileID: "",
    transactionData: {},
    status: "idle", // "idle" | "loading" | "ready" | "error"
  },
  reducers: {
    setDriveFile: (state, action) => {
      state.fileID = action.payload.fileID;
      state.transactionData = action.payload.data;
    },
    reset: () => ({ fileID: "", transactionData: {}, status: "idle" }),
    addTransaction: (state, action) => {
      if (!state.transactionData.insights) return;
      const transaction = action.payload;
      const amount = parseFloat(transaction.amount);

      if (transaction.transactionType === "income") {
        state.transactionData.insights.balance += amount;
      } else {
        state.transactionData.insights.balance -= amount;
        state.transactionData.insights.expenses += amount;
      }

      const updated = [...state.transactionData.transactions, transaction].sort(
        (a, b) => b.occurredAt.localeCompare(a.occurredAt)
      );
      state.transactionData.transactions = updated;
    },
    setBudget: (state, action) => {
      if (!state.transactionData.budgets) state.transactionData.budgets = {};
      const { category, amount } = action.payload;
      if (amount > 0) {
        state.transactionData.budgets[category] = amount;
      } else {
        delete state.transactionData.budgets[category];
      }
    },
    deleteTransaction: (state, action) => {
      if (!state.transactionData.transactions) return;
      const id = action.payload;
      const transaction = state.transactionData.transactions.find((t) => t.id === id);
      if (!transaction) return;

      const amount = parseFloat(transaction.amount);
      if (transaction.transactionType === "income") {
        state.transactionData.insights.balance -= amount;
      } else {
        state.transactionData.insights.balance += amount;
        state.transactionData.insights.expenses -= amount;
      }

      state.transactionData.transactions = state.transactionData.transactions.filter(
        (t) => t.id !== id
      );
    },
    // ── Investments ──────────────────────────────────────
    addInvestment: (state, action) => {
      if (!state.transactionData.investments) state.transactionData.investments = [];
      state.transactionData.investments.push(action.payload);
    },
    updateInvestment: (state, action) => {
      if (!state.transactionData.investments) return;
      const idx = state.transactionData.investments.findIndex((i) => i.id === action.payload.id);
      if (idx !== -1) state.transactionData.investments[idx] = action.payload;
    },
    deleteInvestment: (state, action) => {
      if (!state.transactionData.investments) return;
      state.transactionData.investments = state.transactionData.investments.filter(
        (i) => i.id !== action.payload
      );
    },
    // ── Goals ────────────────────────────────────────────
    addGoal: (state, action) => {
      if (!state.transactionData.goals) state.transactionData.goals = [];
      state.transactionData.goals.push(action.payload);
    },
    updateGoal: (state, action) => {
      if (!state.transactionData.goals) return;
      const idx = state.transactionData.goals.findIndex((g) => g.id === action.payload.id);
      if (idx !== -1) state.transactionData.goals[idx] = action.payload;
    },
    deleteGoal: (state, action) => {
      if (!state.transactionData.goals) return;
      state.transactionData.goals = state.transactionData.goals.filter(
        (g) => g.id !== action.payload
      );
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeDrive.pending, (state) => {
        state.status = "loading";
      })
      .addCase(initializeDrive.fulfilled, (state, action) => {
        state.fileID = action.payload.fileId;
        state.transactionData = action.payload.data;
        state.status = "ready";
      })
      .addCase(initializeDrive.rejected, (state) => {
        state.status = "error";
      });
  },
});

export const {
  setDriveFile, reset,
  addTransaction, deleteTransaction, setBudget,
  addInvestment, updateInvestment, deleteInvestment,
  addGoal, updateGoal, deleteGoal,
} = transactionSlice.actions;

// ── Thunks ───────────────────────────────────────────

export const persistTransaction = (transaction) => async (dispatch, getState) => {
  dispatch(addTransaction(transaction));
  const { fileID, transactionData } = getState().transactions;
  await updateFile(fileID, transactionData);
};

export const persistBudget = (category, amount) => async (dispatch, getState) => {
  dispatch(setBudget({ category, amount }));
  const { fileID, transactionData } = getState().transactions;
  await updateFile(fileID, transactionData);
};

export const persistDeleteTransaction = (id) => async (dispatch, getState) => {
  dispatch(deleteTransaction(id));
  const { fileID, transactionData } = getState().transactions;
  await updateFile(fileID, transactionData);
};

export const persistAddInvestment = (investment) => async (dispatch, getState) => {
  dispatch(addInvestment(investment));
  const { fileID, transactionData } = getState().transactions;
  await updateFile(fileID, transactionData);
};

export const persistUpdateInvestment = (investment) => async (dispatch, getState) => {
  dispatch(updateInvestment(investment));
  const { fileID, transactionData } = getState().transactions;
  await updateFile(fileID, transactionData);
};

export const persistDeleteInvestment = (id) => async (dispatch, getState) => {
  dispatch(deleteInvestment(id));
  const { fileID, transactionData } = getState().transactions;
  await updateFile(fileID, transactionData);
};

export const persistAddGoal = (goal) => async (dispatch, getState) => {
  dispatch(addGoal(goal));
  const { fileID, transactionData } = getState().transactions;
  await updateFile(fileID, transactionData);
};

export const persistUpdateGoal = (goal) => async (dispatch, getState) => {
  dispatch(updateGoal(goal));
  const { fileID, transactionData } = getState().transactions;
  await updateFile(fileID, transactionData);
};

export const persistDeleteGoal = (id) => async (dispatch, getState) => {
  dispatch(deleteGoal(id));
  const { fileID, transactionData } = getState().transactions;
  await updateFile(fileID, transactionData);
};

export default transactionSlice.reducer;
