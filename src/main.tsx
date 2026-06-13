import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// No StrictMode: its dev-only remount-on-mount recreates the TipTap editor on
// every double-click, tearing down and re-applying the restored word selection
// (a visible blink). The app runs only in dev, so the wrapper is all cost.
createRoot(document.getElementById("root")!).render(<App />);
