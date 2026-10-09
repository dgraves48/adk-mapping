import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

/**
 * Browser preview only: serve ./packs/*.pmtiles at /packs with HTTP range support,
 * so the offline packs can be tried without the Tauri shell.
 */
function servePacks(): Plugin {
  // Must not return anything: a returned function is treated as a post-middleware hook.
  const install = (server: { middlewares: { use: (path: string, fn: (req: any, res: any, next: () => void) => void) => void } }): void => {
      server.middlewares.use("/packs", (req, res, next) => {
        const file = path.join(process.cwd(), "packs", path.basename(req.url ?? ""));
        if (!fs.existsSync(file)) return next();
        const size = fs.statSync(file).size;
        const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Type", "application/octet-stream");
        if (!range) {
          res.setHeader("Content-Length", size);
          if (req.method === "HEAD") return res.end();
          return fs.createReadStream(file).pipe(res);
        }
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Content-Length", end - start + 1);
        fs.createReadStream(file, { start, end }).pipe(res);
      });
  };
  return { name: "serve-packs", configureServer: install, configurePreviewServer: install };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), servePacks()],
  // maplibre-gl v6 loads its worker relative to its own module; pre-bundling breaks that path.
  optimizeDeps: { exclude: ["maplibre-gl"] },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
