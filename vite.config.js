import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("jspdf") ||
            id.includes("xlsx") ||
            id.includes("pdfjs-dist") ||
            id.includes("html2canvas") ||
            id.includes("dompurify")
          )
            return; // keep dynamically-imported export/import libs lazy
          if (
            id.includes("recharts") ||
            id.includes("/d3-") ||
            id.includes("victory-vendor")
          )
            return "vendor-charts";
          if (id.includes("framer-motion")) return "vendor-motion";
          // Anchor to the actual package folders — a bare "/react/" substring
          // also matches unrelated paths like
          // @reduxjs/toolkit/dist/query/react/*, which would misfile RTK Query
          // into vendor-react and create a circular chunk dependency (breaks the
          // prod bundle with "Cannot set properties of undefined (setting
          // 'Activity')").
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/") ||
            id.includes("/node_modules/react-compiler-runtime/")
          )
            return "vendor-react";
          return "vendor";
        },
      },
    },
  },
});
