import type { AppSettings } from "../types";

export function createDefaultSettings(): AppSettings {
  return {
    userName: "",
    workdayStart: "09:00",
    workdayEnd: "18:00",
    dailyCapacityMinutes: 360,
    focusBlockMinutes: 50,
    bufferMinutes: 10,
    currentEnergy: "medium",
    theme: "system",
    accentPreset: "lime",
    accentColor: "#cfee45",
    secondaryColor: "#7c6cff",
    surfaceTone: "warm",
    visualStyle: "soft",
    density: "comfortable",
    cornerStyle: "rounded",
    fontScale: "normal",
    sidebarCollapsed: false
  };
}
