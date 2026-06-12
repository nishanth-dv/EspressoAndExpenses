import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./redux/store.js";
import App from "./App.jsx";
import { LoaderProvider } from "./preStyledElements/loader/LoaderContext.jsx";

// Debug exposure for diagnosing balance / data discrepancies. Remove after.
if (typeof window !== "undefined") window.__store = store;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Provider store={store}>
      <LoaderProvider>
        <App />
      </LoaderProvider>
    </Provider>
  </StrictMode>,
);
