/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useRef, useState } from "react";
import Loader from "./Loader";

const LoaderContext = createContext(null);

export const LoaderProvider = ({ children }) => {
  const [config, setConfig] = useState(null);
  const delayRef = useRef(null);

  const showLoader = (options = {}) => {
    clearTimeout(delayRef.current);

    delayRef.current = setTimeout(() => {
      setConfig({
        fullscreen: true,
        size: 96,
        label: "Brewing",
        ...options,
      });
    }, 300);
  };

  const hideLoader = () => {
    clearTimeout(delayRef.current);
    setConfig(null);
  };

  return (
    <LoaderContext.Provider value={{ showLoader, hideLoader }}>
      {children}
      {config && <Loader {...config} />}
    </LoaderContext.Provider>
  );
};

export const useLoader = () => {
  const ctx = useContext(LoaderContext);
  if (!ctx) {
    throw new Error("useLoader must be used within LoaderProvider");
  }
  return ctx;
};
