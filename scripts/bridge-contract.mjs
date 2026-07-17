export class BridgeContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "BridgeContractError";
  }
}

const TASK_STATUSES = new Set(["inbox", "next", "planned", "waiting", "someday", "done"]);
const EDITABLE_TASK_STATUSES = new Set(["inbox", "next", "planned", "waiting", "someday"]);
const TASK_ENERGY_LEVELS = new Set(["low", "medium", "high"]);
const TASK_RECURRENCES = new Set(["none", "daily", "weekdays", "weekly", "monthly"]);
const PROJECT_STATUSES = new Set(["active", "paused", "completed"]);
const EVENT_KINDS = new Set(["meeting", "focus", "personal", "break"]);
const EVENT_SOURCES = new Set(["local", "dashboard", "google"]);
const REFLECTION_STATUSES = new Set([
  "captured", "queued", "analyzed", "confirmed", "corrected", "ignored"
]);

const TASK_UPDATE_VALIDATORS = {
  title: (value, label) => requireString(value, label, 500),
  notes: (value, label) => requireString(value, label, 200_000, true),
  status: (value, label) => requireEnum(value, label, EDITABLE_TASK_STATUSES),
  projectId: (value, label) => requireNullableId(value, label),
  priority: (value, label) => requireInteger(value, label, 1, 4),
  estimateMinutes: (value, label) => requireInteger(value, label, 0, 24 * 60),
  energy: (value, label) => requireEnum(value, label, TASK_ENERGY_LEVELS),
  context: (value, label) => requireString(value, label, 200),
  dueDate: (value, label) => requireNullableDate(value, label),
  scheduledDate: (value, label) => requireNullableDate(value, label),
  recurrence: (value, label) => requireEnum(value, label, TASK_RECURRENCES)
};

const NOTE_DRAFT_VALIDATORS = {
  title: (value, label) => requireString(value, label, 500),
  body: (value, label) => requireString(value, label, 200_000, true),
  projectId: (value, label) => requireNullableId(value, label),
  tags: (value, label) => requireStringArray(value, label, 100, 100),
  pinned: (value, label) => requireBoolean(value, label)
};

const READING_DRAFT_VALIDATORS = {
  title: (value, label) => requireString(value, label, 500),
  summary: (value, label) => requireString(value, label, 20_000, true),
  body: (value, label) => requireString(value, label, 200_000, true),
  url: (value, label) => requireHttpUrl(value, label),
  source: (value, label) => requireString(value, label, 500, true),
  tags: (value, label) => requireStringArray(value, label, 100, 100)
};

function fail(message) {
  throw new BridgeContractError(message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length && actualKeys.every((key) => expectedKeys.includes(key));
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(`${label}: ожидался объект.`);
  return value;
}

function requireExactKeys(value, expectedKeys, label) {
  requireRecord(value, label);
  if (!hasExactKeys(value, expectedKeys)) {
    fail(`${label}: обнаружены неизвестные или отсутствующие поля.`);
  }
  return value;
}

function requireString(value, label, maximumLength, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    value.length > maximumLength ||
    (!allowEmpty && !value.trim())
  ) {
    fail(`${label}: некорректная строка.`);
  }
  return value;
}

function requireId(value, label) {
  const id = requireString(value, label, 128);
  if (!/^[a-zA-Z0-9._:-]+$/.test(id)) fail(`${label}: некорректный идентификатор.`);
  return id;
}

function requireNullableId(value, label) {
  if (value === null) return value;
  return requireId(value, label);
}

function requireDate(value, label) {
  const date = requireString(value, label, 64);
  if (!Number.isFinite(Date.parse(date))) fail(`${label}: некорректная дата.`);
  return date;
}

function requireNullableDate(value, label) {
  if (value === null) return value;
  return requireDate(value, label);
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") fail(`${label}: ожидалось логическое значение.`);
  return value;
}

function requireInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${label}: некорректное целое число.`);
  }
  return value;
}

function requireEnum(value, label, allowed) {
  if (typeof value !== "string" || !allowed.has(value)) fail(`${label}: неизвестное значение.`);
  return value;
}

function requireStringArray(value, label, maximumItems, maximumLength) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    fail(`${label}: неверный формат или слишком много элементов.`);
  }
  value.forEach((entry, index) => requireString(entry, `${label}[${index}]`, maximumLength));
  return value;
}

function requireHttpUrl(value, label) {
  const url = requireString(value, label, 4_000, true);
  if (!url.trim()) return url;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail(`${label}: недопустимый протокол.`);
  } catch (error) {
    if (error instanceof BridgeContractError) throw error;
    fail(`${label}: некорректный URL.`);
  }
  return url;
}

function isSafeDraftPayload(value, validators, requiredKeys, label) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.some((key) => !Object.hasOwn(validators, key)) ||
    requiredKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    return false;
  }
  try {
    keys.forEach((key) => validators[key](value[key], `${label}.${key}`));
    return true;
  } catch (error) {
    if (error instanceof BridgeContractError) return false;
    throw error;
  }
}

function validateArray(value, label, maximumItems, validators) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    fail(`${label}: неверный формат или слишком много элементов.`);
  }
  const keys = Object.keys(validators);
  value.forEach((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    requireExactKeys(entry, keys, itemLabel);
    for (const [key, validator] of Object.entries(validators)) {
      validator(entry[key], `${itemLabel}.${key}`);
    }
  });
  return value;
}

const projectionValidators = {
  tasks: {
    maximumItems: 10_000,
    fields: {
      id: requireId,
      title: (value, label) => requireString(value, label, 500),
      status: (value, label) => requireEnum(value, label, TASK_STATUSES),
      projectId: requireNullableId,
      priority: (value, label) => requireInteger(value, label, 1, 4),
      estimateMinutes: (value, label) => requireInteger(value, label, 0, 24 * 60),
      energy: (value, label) => requireEnum(value, label, TASK_ENERGY_LEVELS),
      context: (value, label) => requireString(value, label, 200),
      dueDate: requireNullableDate,
      scheduledDate: requireNullableDate,
      completedAt: requireNullableDate,
      recurrence: (value, label) => requireEnum(value, label, TASK_RECURRENCES),
      generatedFromTaskId: requireNullableId,
      createdAt: requireDate,
      updatedAt: requireDate
    }
  },
  projects: {
    maximumItems: 2_000,
    fields: {
      id: requireId,
      title: (value, label) => requireString(value, label, 500),
      area: (value, label) => requireString(value, label, 500, true),
      color: (value, label) => requireString(value, label, 100),
      status: (value, label) => requireEnum(value, label, PROJECT_STATUSES),
      nextReviewAt: requireNullableDate,
      createdAt: requireDate,
      updatedAt: requireDate
    }
  },
  events: {
    maximumItems: 10_000,
    fields: {
      id: requireId,
      title: (value, label) => requireString(value, label, 500),
      startAt: requireDate,
      endAt: requireDate,
      kind: (value, label) => requireEnum(value, label, EVENT_KINDS),
      source: (value, label) => requireEnum(value, label, EVENT_SOURCES),
      taskId: requireNullableId,
      locked: requireBoolean,
      createdAt: requireDate,
      updatedAt: requireDate
    }
  },
  notes: {
    maximumItems: 2_000,
    fields: {
      id: requireId,
      title: (value, label) => requireString(value, label, 500),
      body: (value, label) => requireString(value, label, 200_000, true),
      projectId: requireNullableId,
      tags: (value, label) => requireStringArray(value, label, 100, 100),
      pinned: requireBoolean,
      createdAt: requireDate,
      updatedAt: requireDate
    }
  },
  journal: {
    maximumItems: 2_000,
    fields: {
      id: requireId,
      text: (value, label) => requireString(value, label, 200_000),
      status: (value, label) => requireEnum(value, label, REFLECTION_STATUSES),
      correction: (value, label) => value === null || requireString(value, label, 200_000),
      createdAt: requireDate,
      updatedAt: requireDate,
      confirmedAt: requireNullableDate
    }
  },
  readingItems: {
    maximumItems: 2_000,
    fields: {
      id: requireId,
      title: (value, label) => requireString(value, label, 500),
      summary: (value, label) => requireString(value, label, 20_000, true),
      body: (value, label) => requireString(value, label, 200_000, true),
      url: (value, label) => requireHttpUrl(value, label),
      source: (value, label) => requireString(value, label, 500, true),
      tags: (value, label) => requireStringArray(value, label, 100, 100),
      createdAt: requireDate
    }
  }
};

export function validateCodexSnapshot(value) {
  const snapshot = requireExactKeys(
    value,
    ["schemaVersion", "writtenAt", "scope", "data"],
    "Снимок Codex"
  );
  if (snapshot.schemaVersion !== 2) fail("Снимок Codex имеет неизвестную версию.");
  requireDate(snapshot.writtenAt, "Снимок Codex.writtenAt");

  const scopeKeys = ["tasks", "projects", "calendar", "notes", "journal", "reading"];
  const scope = requireExactKeys(snapshot.scope, scopeKeys, "Снимок Codex.scope");
  scopeKeys.forEach((key) => requireBoolean(scope[key], `Снимок Codex.scope.${key}`));

  const dataKeys = ["tasks", "projects", "events", "notes", "journal", "readingItems"];
  const data = requireExactKeys(snapshot.data, dataKeys, "Снимок Codex.data");
  for (const [key, definition] of Object.entries(projectionValidators)) {
    validateArray(data[key], `Снимок Codex.data.${key}`, definition.maximumItems, definition.fields);
  }

  const categoryChecks = [
    ["tasks", data.tasks],
    ["projects", data.projects],
    ["calendar", data.events],
    ["notes", data.notes],
    ["journal", data.journal],
    ["reading", data.readingItems]
  ];
  for (const [key, items] of categoryChecks) {
    if (!scope[key] && items.length) fail(`Снимок Codex содержит отключённую категорию ${key}.`);
  }
  return snapshot;
}

export function isSafeTaskUpdatePayload(value) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !Object.hasOwn(TASK_UPDATE_VALIDATORS, key))) return false;
  try {
    for (const key of keys) TASK_UPDATE_VALIDATORS[key](value[key], `update_task.payload.${key}`);
    return true;
  } catch (error) {
    if (error instanceof BridgeContractError) return false;
    throw error;
  }
}

function isSafeNoteUpdatePayload(value) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !Object.hasOwn(NOTE_DRAFT_VALIDATORS, key))) return false;
  try {
    keys.forEach((key) => NOTE_DRAFT_VALIDATORS[key](value[key], `update_note.payload.${key}`));
    return true;
  } catch (error) {
    if (error instanceof BridgeContractError) return false;
    throw error;
  }
}

function hasSafeCommandIdentity(entry) {
  try {
    requireId(entry.id, "command.id");
    return true;
  } catch (error) {
    if (error instanceof BridgeContractError) return false;
    throw error;
  }
}

function hasSafeEntityId(value, label) {
  try {
    requireId(value, label);
    return true;
  } catch (error) {
    if (error instanceof BridgeContractError) return false;
    throw error;
  }
}

export function isCodexCommand(entry) {
  if (!isRecord(entry) || typeof entry.type !== "string" || !hasSafeCommandIdentity(entry)) return false;

  if (entry.type === "update_task") {
    return hasExactKeys(entry, ["id", "type", "entityId", "payload"]) &&
      hasSafeEntityId(entry.entityId, "update_task.entityId") &&
      isSafeTaskUpdatePayload(entry.payload);
  }
  if (entry.type === "update_note") {
    return hasExactKeys(entry, ["id", "type", "entityId", "payload"]) &&
      hasSafeEntityId(entry.entityId, "update_note.entityId") &&
      isSafeNoteUpdatePayload(entry.payload);
  }
  if (entry.type === "complete_task") {
    return hasExactKeys(entry, ["id", "type", "entityId"]) &&
      hasSafeEntityId(entry.entityId, "complete_task.entityId");
  }
  if (entry.type === "add_task") {
    return hasExactKeys(entry, ["id", "type", "payload"]) &&
      isSafeDraftPayload(entry.payload, TASK_UPDATE_VALIDATORS, ["title"], "add_task.payload");
  }
  if (entry.type === "add_note") {
    return hasExactKeys(entry, ["id", "type", "payload"]) &&
      isSafeDraftPayload(entry.payload, NOTE_DRAFT_VALIDATORS, ["title"], "add_note.payload");
  }
  if (entry.type === "add_reading") {
    return hasExactKeys(entry, ["id", "type", "payload"]) &&
      isSafeDraftPayload(entry.payload, READING_DRAFT_VALIDATORS, ["title"], "add_reading.payload");
  }
  return false;
}
