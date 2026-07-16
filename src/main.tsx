import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DashboardProvider } from "./state/DashboardContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardProvider>
      <App />
    </DashboardProvider>
  </StrictMode>
);

