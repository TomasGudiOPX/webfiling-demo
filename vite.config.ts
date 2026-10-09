import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, normalizePath } from "vite";
import path from "node:path";

export default defineConfig({
  plugins: [reactRouter()],
  ssr: { external: ["node:sqlite"] },
  server: {
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/private-fixtures/**",
        "**/fixtures/**",
        "**/data/**",
        "**/.test-data/**",
        normalizePath(path.resolve(process.env.SOURCE_ROOT ?? "fixtures")) +
          "/**",
        normalizePath(
          path.resolve(
            process.env.MANAGED_STORAGE_ROOT ?? "data/managed-files",
          ),
        ) + "/**",
        normalizePath(
          path.resolve(process.env.DATABASE_PATH ?? "data/webfiling.sqlite"),
        ) + "*",
      ],
    },
    watch: { ignored: ["**/data/**", "**/.test-data/**"] },
  },
});
