import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "node:fs";
import { componentTagger } from "lovable-tagger";

// Stamps dist/sw.js with a unique build id on every production build so the
// service worker file is byte-different each deploy. Without this the browser
// never detects a new SW, never fires `controllerchange`, and users only see
// new code after a manual hard-refresh. See src/main.tsx for the reload logic.
function swBuildIdPlugin(): Plugin {
  return {
    name: "salci-sw-build-id",
    apply: "build",
    closeBundle() {
      const swPath = path.resolve(__dirname, "dist/sw.js");
      if (!fs.existsSync(swPath)) return;
      const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const content = fs.readFileSync(swPath, "utf-8");
      fs.writeFileSync(swPath, content.replace(/__BUILD_ID__/g, buildId));
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Dev only: let VS Code dev tunnel hosts past Vite 5 host checking, so a
    // forwarded port serves the app. Server config, so vite build is unaffected.
    allowedHosts: [".devtunnels.ms"],
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    swBuildIdPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].[hash].js",
        chunkFileNames: "assets/[name].[hash].js",
        assetFileNames: "assets/[name].[hash][extname]",

        // ── Why the two options below exist (2026-09-23) ─────────────────────
        // ba10b109 (2026-09-17) made 126 routes lazy. Right call for the first
        // download (6.97 MB -> 1.09 MB), but Rollup's default then gave every
        // helper shared by two or more pages its OWN file: 199 of 432 chunks were
        // under 2 KB (subDays: 89 bytes, one file per icon). Vite preloads every
        // file a route needs, so a teacher's normal day went from a handful of
        // requests to 169, and Vercel edge requests roughly tripled on a Hobby
        // plan capped at 1M/month. No cache header can fix that: each 89-byte file
        // is a full request.
        //
        // Measured on the merged tree, cold cache, shared files counted once:
        //
        //                              live   THIS   | 20KB  50KB  200KB  revert*
        //   teacher day, requests       169     45   |  53    46     44       5
        //   admin day, requests         181     53   |  60    54     52       5
        //   gzip before login screen  362KB  403KB   | 404   420    430    1812
        //   entry chunk, raw          1.09MB 1.12MB  | 1.12  1.18   1.22   6.73
        //   * the Sept shape (66 routes eager): fewest requests, but 4.5x the
        //     bytes before the login screen and 4.5x over §23's 1.5 MB cap.
        //
        // 100 KB is the knee: 20 -> 100 cuts requests 15% at the SAME boot size,
        // and 200 KB buys one more request for a heavier login.
        //
        // experimentalMinChunkSize folds a side-effect-free chunk under this size
        // into a chunk loaded under similar conditions. Rollup keeps execution
        // order; no manual assignment is involved.
        experimentalMinChunkSize: 100000,

        // ONLY the two libraries behind the sub-2 KB fan-out. Without this the
        // 100 KB setting alone still costs 100 requests a teacher-day, not 45.
        // Deliberately NOT react / react-dom / radix / router / tanstack: a full
        // vendor split was built and rejected on 2026-09-21 because it produced a
        // circular chunk dependency (vendor-react <-> vendor-radix), the Rollup TDZ
        // hazard that white-screens ONLY in a browser while typecheck and build pass.
        //
        // Verified, do not "tidy": Rollup hoists React core INTO vendor-lucide (the
        // icons call forwardRef at module evaluation), so the entry imports React
        // from it. Both vendor chunks contain ZERO import statements, so neither can
        // be in a cycle, and both execute standalone in Node. Every one of the 146
        // chunks was then evaluated in real Chrome with 0 errors, by a harness first
        // proven able to catch a planted TDZ. Adding a library here needs all three
        // proofs again.
        manualChunks(id) {
          if (id.includes("node_modules/lucide-react")) return "vendor-lucide";
          if (id.includes("node_modules/date-fns")) return "vendor-datefns";
          return undefined;
        },
      },
    },
  },
}));
