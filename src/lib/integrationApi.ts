import type {
  CodexCommand,
  DashboardState,
  Note,
  ObsidianIntegrationSettings,
  ReflectionAnalysisRequest,
  ReflectionAnalysisResponse
} from "../types";
import { buildCodexSnapshot } from "./codexBridge";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const data = await response.json().catch(() => ({ message: "Локальный помощник не ответил." }));
  if (!response.ok) {
    throw new Error((data as { message?: string }).message ?? "Не удалось выполнить действие.");
  }
  return data as T;
}

export function testObsidianVault(vaultPath: string) {
  return request<{ valid: boolean; vaultName: string }>("/api/obsidian/test", {
    method: "POST",
    body: JSON.stringify({ vaultPath })
  });
}

export function selectLocalFolder() {
  return request<{ path: string | null }>("/api/system/select-folder", { method: "POST" });
}

export function exportNotesToObsidian(
  settings: ObsidianIntegrationSettings,
  notes: Note[]
) {
  return request<{ exported: number; destination: string }>("/api/obsidian/export", {
    method: "POST",
    body: JSON.stringify({
      vaultPath: settings.vaultPath,
      folder: settings.folder,
      includeFrontmatter: settings.includeFrontmatter,
      notes
    })
  });
}

export function publishDashboardSnapshot(state: DashboardState) {
  const snapshot = buildCodexSnapshot(state);
  return request<{ writtenAt: string; fileName: string }>("/api/bridge/snapshot", {
    method: "POST",
    body: JSON.stringify(snapshot)
  });
}

export function deleteDashboardSnapshot() {
  return request<{ deleted: boolean }>("/api/bridge/snapshot/delete", {
    method: "POST",
    body: "{}"
  });
}

export function queueReflectionAnalysis(analysisRequest: ReflectionAnalysisRequest) {
  return request<{ queuedAt: string; fileName: string; requestDigest: string }>("/api/bridge/reflection/request", {
    method: "POST",
    body: JSON.stringify(analysisRequest)
  });
}

export function loadReflectionAnalysisResponse() {
  return request<{ response: ReflectionAnalysisResponse | null }>("/api/bridge/reflection/response");
}

export function cancelReflectionAnalysis(requestId: string, requestDigest: string) {
  return request<{ cancelled: boolean }>("/api/bridge/reflection/cancel", {
    method: "POST",
    body: JSON.stringify({ requestId, requestDigest })
  });
}

export function acknowledgeReflectionAnalysis(
  responseId: string,
  requestId: string,
  requestDigest: string,
  entryId: string,
  sourceUpdatedAt: string
) {
  return request<{ acknowledged: boolean }>("/api/bridge/reflection/ack", {
    method: "POST",
    body: JSON.stringify({ requestId, responseId, requestDigest, entryId, sourceUpdatedAt })
  });
}

export function loadCodexCommands() {
  return request<{ commands: CodexCommand[] }>("/api/bridge/commands");
}

export function acknowledgeCodexCommands(ids: string[]) {
  return request<{ acknowledged: number; remaining: number }>("/api/bridge/ack", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}
