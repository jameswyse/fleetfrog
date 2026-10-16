import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rolldownOptions: {
      input: ["index.html", "404.html"],
    },
  },
});
