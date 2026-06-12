import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { deckApi } from "./vite-plugin-deck-api";

// One route, localhost preview. JSON edits to deck.json/theme.json trigger HMR.
export default defineConfig({
  plugins: [react(), deckApi()],
  server: { port: 5173, open: false },
});
