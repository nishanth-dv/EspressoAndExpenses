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
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          )
            return "vendor-react";
          return "vendor";
        },
      },
    },
  },
});
