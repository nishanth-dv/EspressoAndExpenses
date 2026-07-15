import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import transactionReducer from "./slices/transactionSlice";
import filterReducer from "./slices/filterSlice";
import toastReducer from "./slices/toastSlice";
import accessReducer from "./slices/accessSlice";
import { api } from "./api";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    transactions: transactionReducer,
    filter: filterReducer,
    toast: toastReducer,
    access: accessReducer,
    [api.reducerPath]: api.reducer,
  },
  // Append the RTK Query middleware for cache lifecycle, request de-duplication,
  // and (later) polling/refetch. Defaults are otherwise preserved.
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(api.middleware),
});
