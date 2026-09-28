import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      // Every package shares one version, so the site's own version is the latest release's.
      name: "fleetfrog-version",
      transformIndexHtml: (html) => html.replaceAll("%FLEETFROG_VERSION%", packageJson.version),
    },
  ],
  build: {
    rollupOptions: {
      input: ["index.html", "404.html"],
    },
  },
});
