import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import transactionReducer from "./slices/transactionSlice";
import filterReducer from "./slices/filterSlice";
import toastReducer from "./slices/toastSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    transactions: transactionReducer,
    filter: filterReducer,
    toast: toastReducer,
  },
});
