import type {
  AssistantMemoryItem,
  ReflectionMemoryProjection,
  ReflectionMemoryProjectionItem,
  ReflectionMemoryReference
} from "../../types";

export const MAX_REFLECTION_MEMORY_ITEMS = 6;
export const MAX_REFLECTION_MEMORY_ITEM_LENGTH = 2_500;
export const MAX_REFLECTION_MEMORY_TOTAL_LENGTH = 12_000;
const BRIDGE_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) &&
    value.length <= 64 &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isBridgeId(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 128 && BRIDGE_ID_PATTERN.test(value);
}

function hasExactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/**
 * Normalizes an already captured request projection without silently dropping or truncating items.
 * A malformed projection is rejected as a whole.
 */
export function normalizeReflectionMemoryProjection(
  value: unknown
): ReflectionMemoryProjection | null {
  if (!value || typeof value !== "object" || !hasExactKeys(value, ["schemaVersion", "items"])) {
    return null;
  }
  const projection = value as Partial<ReflectionMemoryProjection>;
  if (
    projection.schemaVersion !== 1 ||
    !Array.isArray(projection.items) ||
    projection.items.length === 0 ||
    projection.items.length > MAX_REFLECTION_MEMORY_ITEMS
  ) {
    return null;
  }

  const ids = new Set<string>();
  let totalLength = 0;
  const items: ReflectionMemoryProjectionItem[] = [];
  for (const rawItem of projection.items) {
    if (
      !rawItem ||
      typeof rawItem !== "object" ||
      !hasExactKeys(rawItem, ["id", "text", "updatedAt"])
    ) {
      return null;
    }
    const item = rawItem as Partial<ReflectionMemoryProjectionItem>;
    if (
      !isBridgeId(item.id) ||
      !isNonEmptyString(item.text) ||
      item.text.length > MAX_REFLECTION_MEMORY_ITEM_LENGTH ||
      !isIsoDate(item.updatedAt) ||
      ids.has(item.id)
    ) {
      return null;
    }
    totalLength += item.text.length;
    if (totalLength > MAX_REFLECTION_MEMORY_TOTAL_LENGTH) return null;
    ids.add(item.id);
    items.push({ id: item.id, text: item.text, updatedAt: item.updatedAt });
  }

  return { schemaVersion: 1, items };
}

/** Builds a detached, exact projection from only the memory items explicitly selected by id. */
export function buildReflectionMemoryProjection(
  memory: readonly AssistantMemoryItem[],
  selectedIds: readonly string[] = []
): ReflectionMemoryProjection | null {
  if (selectedIds.length === 0) return null;
  if (selectedIds.length > MAX_REFLECTION_MEMORY_ITEMS) {
    throw new Error(`Для одного разбора можно выбрать не больше ${MAX_REFLECTION_MEMORY_ITEMS} записей памяти.`);
  }
  const uniqueIds = new Set(selectedIds);
  if (uniqueIds.size !== selectedIds.length) {
    throw new Error("Одна и та же запись памяти выбрана несколько раз.");
  }

  const items = selectedIds.map((id) => {
    const source = memory.find((item) => item.id === id);
    if (!source) throw new Error("Выбранная запись памяти больше не существует.");
    if (source.status !== "active") {
      throw new Error("Запись памяти на паузе и не может быть добавлена в разбор.");
    }
    return { id: source.id, text: source.text, updatedAt: source.updatedAt };
  });
  const projection = normalizeReflectionMemoryProjection({ schemaVersion: 1, items });
  if (!projection) {
    throw new Error("Выбранная память превышает допустимый объём или содержит некорректные данные.");
  }
  return projection;
}

/** Keeps only non-sensitive identity/version references from an exact request projection. */
export function memoryReferencesFromProjection(
  projection: ReflectionMemoryProjection | null
): ReflectionMemoryReference[] {
  if (projection === null) return [];
  const normalized = normalizeReflectionMemoryProjection(projection);
  if (!normalized) throw new Error("Некорректный снимок памяти для разбора.");
  return normalized.items.map(({ id, updatedAt }) => ({ id, updatedAt }));
}

/** Normalizes persisted non-sensitive references atomically. */
export function normalizeReflectionMemoryReferences(
  value: unknown
): ReflectionMemoryReference[] | null {
  if (!Array.isArray(value) || value.length > MAX_REFLECTION_MEMORY_ITEMS) return null;
  const ids = new Set<string>();
  const references: ReflectionMemoryReference[] = [];
  for (const rawReference of value) {
    if (
      !rawReference ||
      typeof rawReference !== "object" ||
      !hasExactKeys(rawReference, ["id", "updatedAt"])
    ) {
      return null;
    }
    const reference = rawReference as Partial<ReflectionMemoryReference>;
    if (!isBridgeId(reference.id) || !isIsoDate(reference.updatedAt) || ids.has(reference.id)) {
      return null;
    }
    ids.add(reference.id);
    references.push({ id: reference.id, updatedAt: reference.updatedAt });
  }
  return references;
}
