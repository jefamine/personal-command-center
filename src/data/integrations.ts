import type { IntegrationSettings } from "../types";

export function createDefaultIntegrations(): IntegrationSettings {
  return {
    google: {
      enabled: false,
      status: "disconnected",
      calendarEnabled: true,
      tasksEnabled: true,
      syncIntervalMinutes: 15,
      readAllCalendars: true,
      focusCalendarName: "Фокус",
      writeFocusBlocks: false,
      tasksListName: "Личный дашборд",
      tasksMode: "inbox",
      conflictPolicy: "latest",
      lastSyncAt: null
    },
    obsidian: {
      enabled: false,
      vaultPath: "",
      folder: "Личный дашборд",
      includeFrontmatter: true,
      mode: "manual",
      lastExportAt: null
    },
    codex: {
      enabled: true,
      permissionMode: "confirm",
      allowCreateTasks: true,
      allowUpdateTasks: true,
      allowCompleteTasks: false,
      allowNotes: true,
      allowReading: true,
      snapshotScope: {
        tasks: true,
        projects: true,
        calendar: true,
        notes: false,
        journal: false,
        reading: true
      },
      lastSnapshotAt: null,
      lastCommandImportAt: null
    }
  };
}
