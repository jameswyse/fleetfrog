import { fileURLToPath } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const hubUrl = process.env.FLEETFROG_HUB_URL ?? "http://localhost:7420";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    // The hub serves the RPC socket, sign-in, project icons and pictures; in development Vite
    // serves the dashboard and forwards the rest.
    proxy: {
      "/rpc": { target: hubUrl, ws: true },
      "/project-icons": { target: hubUrl },
      "/auth": { target: hubUrl },
      "/avatars": { target: hubUrl },
    },
  },
});
