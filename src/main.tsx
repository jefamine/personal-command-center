import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DashboardProvider } from "./state/DashboardContext";
import { AppNavigationProvider } from "./navigation/NavigationContext";
import "./styles.css";

let reloadingForServiceWorker = false;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForServiceWorker) return;
    reloadingForServiceWorker = true;
    window.location.reload();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardProvider>
      <AppNavigationProvider>
        <App />
      </AppNavigationProvider>
    </DashboardProvider>
  </StrictMode>
);
