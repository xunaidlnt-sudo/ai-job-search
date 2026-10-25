import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  optimizeDeps: { exclude: ["web-ifc"] },
  test: { globals: true, environment: "node", include: ["tests/**/*.test.ts"] },
});
