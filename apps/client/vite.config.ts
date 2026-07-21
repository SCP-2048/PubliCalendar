import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

export default defineConfig(({ mode }) => ({
  plugins: [uni()],
  optimizeDeps: {
    exclude: ["@publicalendar/shared"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
}));
