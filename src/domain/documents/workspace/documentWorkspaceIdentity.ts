import type { DocumentId } from "../documentContract";

function asDocumentId(value: string): DocumentId {
  return value as DocumentId;
}

export function isValidPsozhId(value: string | null | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim();
  return normalized === value && normalized.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(normalized);
}

/** Managed files deliberately expose the stored id unchanged. */
export function managedExternalDocumentId(psozhId: string): DocumentId {
  if (!isValidPsozhId(psozhId)) throw new Error("Некорректный psozh-id.");
  return asDocumentId(psozhId);
}

/** Unmanaged identity is explicitly path-based and therefore not durable across move. */
export function unmanagedExternalDocumentId(workspaceId: string, relativePath: string): DocumentId {
  return asDocumentId(`external-path:${encodeURIComponent(workspaceId)}:${encodeURIComponent(relativePath)}`);
}

/** Duplicate claimed ids remain separate conflict entries instead of collapsing in a map. */
export function conflictingExternalDocumentId(workspaceId: string, relativePath: string): DocumentId {
  return asDocumentId(`external-conflict:${encodeURIComponent(workspaceId)}:${encodeURIComponent(relativePath)}`);
}

export function createWorkspaceId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("В этой среде недоступно создание устойчивого идентификатора.");
  }
  return globalThis.crypto.randomUUID();
}
