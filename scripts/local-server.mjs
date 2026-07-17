import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isCodexCommand, validateCodexSnapshot } from "./bridge-contract.mjs";

const host = "127.0.0.1";
const port = 4173;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(projectRoot, "dist");
const bridgeRoot = resolve(projectRoot, "bridge");
const reflectionRequestPath = resolve(bridgeRoot, "reflection-analysis-request.json");
const reflectionResponsePath = resolve(bridgeRoot, "reflection-analysis-response.json");
const reflectionRequestTtlMs = 24 * 60 * 60 * 1000;
const idleLimitMs = 20 * 60 * 1000;
let lastRequestAt = Date.now();
let bridgeCompatibilityChecked = false;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function sendFile(response, filePath) {
  const extension = extname(filePath);
  const fileName = basename(filePath);
  const hashedAsset = filePath.includes(`${sep}assets${sep}`) && /-[a-z0-9_-]{6,}\.[a-z0-9]+$/i.test(fileName);
  const cacheControl = fileName === "sw.js"
    ? "no-cache"
    : fileName === "index.html" || fileName === "registerSW.js" || extension === ".webmanifest"
      ? "no-store"
      : hashedAsset
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600";
  response.writeHead(200, {
    "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
    "Cache-Control": cacheControl
  });
  createReadStream(filePath).pipe(response);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function readJson(request, limit = 12 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectBody(new HttpError(413, "Слишком большой пакет данных."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        rejectBody(new HttpError(400, "Не удалось прочитать данные запроса."));
      }
    });
    request.on("error", rejectBody);
  });
}

function requireMethod(request, method) {
  if (request.method !== method) throw new HttpError(405, "Неподдерживаемый способ запроса.");
}

function requireLocalApiRequest(request, url) {
  if (!url.pathname.startsWith("/api/")) return;
  const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`]);
  const requestHost = String(request.headers.host || "").toLowerCase();
  if (!allowedHosts.has(requestHost)) {
    throw new HttpError(403, "Локальный запрос отклонён.");
  }

  const origin = request.headers.origin;
  const allowedOrigins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
  if (origin && !allowedOrigins.has(origin)) {
    throw new HttpError(403, "Запрос с другого сайта отклонён.");
  }

  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new HttpError(403, "Межсайтовый запрос отклонён.");
  }

  if (["POST", "PUT", "PATCH"].includes(request.method ?? "")) {
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      throw new HttpError(415, "Локальный API принимает JSON-запросы.");
    }
  }
}

function resolveVault(vaultPath) {
  if (typeof vaultPath !== "string" || !vaultPath.trim() || !isAbsolute(vaultPath)) {
    throw new Error("Выберите полную папку хранилища Obsidian.");
  }
  const root = resolve(vaultPath.trim());
  let stats;
  try {
    stats = statSync(root);
  } catch {
    throw new Error("Эта папка не найдена.");
  }
  if (!stats.isDirectory() || !existsSync(resolve(root, ".obsidian"))) {
    throw new Error("В папке нет каталога .obsidian — выберите корень хранилища Obsidian.");
  }
  return root;
}

function safeDestination(root, folder) {
  const destination = resolve(root, typeof folder === "string" && folder.trim() ? folder.trim() : "Личный дашборд");
  if (destination !== root && !destination.startsWith(`${root}${sep}`)) {
    throw new Error("Папка экспорта должна находиться внутри хранилища Obsidian.");
  }
  return destination;
}

function safeFileName(title, id) {
  let clean = String(title || "Без названия")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  if (!clean) clean = "Без названия";
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) clean = `_${clean}`;
  const cleanId = String(id || "item")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 8) || "item";
  return `${clean}--${cleanId}.md`;
}

function noteMarkdown(note, includeFrontmatter) {
  const body = typeof note.body === "string" ? note.body : "";
  if (!includeFrontmatter) return body;
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(String(note.title || "Без названия"))}`,
    `command_center_id: ${JSON.stringify(String(note.id))}`,
    `updated: ${JSON.stringify(String(note.updatedAt || new Date().toISOString()))}`,
    `project_id: ${note.projectId ? JSON.stringify(String(note.projectId)) : "null"}`,
    `tags: ${JSON.stringify(Array.isArray(note.tags) ? note.tags.map(String) : [])}`,
    ...(note.origin === "reflection" ? ["command_center_origin: reflection"] : []),
    "---",
    ""
  ];
  return `${frontmatter.join("\n")}${body}`;
}

function ensureBridge() {
  mkdirSync(bridgeRoot, { recursive: true });
  if (bridgeCompatibilityChecked) return;
  bridgeCompatibilityChecked = true;
  try {
    const requestVersion = existsSync(reflectionRequestPath)
      ? JSON.parse(readFileSync(reflectionRequestPath, "utf8"))?.schemaVersion
      : null;
    const responseVersion = existsSync(reflectionResponsePath)
      ? JSON.parse(readFileSync(reflectionResponsePath, "utf8"))?.schemaVersion
      : null;
    if ((requestVersion !== null && requestVersion !== 3) || (responseVersion !== null && responseVersion !== 3)) {
      removeIfExists(reflectionRequestPath);
      removeIfExists(reflectionResponsePath);
    }
  } catch {
    removeIfExists(reflectionRequestPath);
    removeIfExists(reflectionResponsePath);
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireExactKeys(value, keys, label) {
  if (!isRecord(value)) throw new HttpError(400, `${label}: ожидался объект.`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new HttpError(400, `${label}: обнаружены неизвестные или отсутствующие поля.`);
  }
  return value;
}

function requireString(value, label, maximum, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new HttpError(400, `${label}: некорректная строка.`);
  }
  return value;
}

function requireId(value, label) {
  const id = requireString(value, label, 128);
  if (!/^[a-zA-Z0-9._:-]+$/.test(id)) throw new HttpError(400, `${label}: некорректный идентификатор.`);
  return id;
}

function requireIsoDate(value, label) {
  const date = requireString(value, label, 64);
  if (!Number.isFinite(Date.parse(date))) throw new HttpError(400, `${label}: некорректная дата.`);
  return date;
}

function requireIsoTimestamp(value, label) {
  const timestamp = requireIsoDate(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) {
    throw new HttpError(400, `${label}: ожидается дата и время в формате ISO 8601.`);
  }
  return timestamp;
}

function requireStringArray(value, label, maximumItems, maximumLength) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new HttpError(400, `${label}: слишком много элементов или неверный формат.`);
  }
  return value.map((entry, index) => requireString(entry, `${label}[${index}]`, maximumLength));
}

const svpVectorIds = new Set([
  "skin", "anal", "muscular", "urethral", "visual", "sound", "oral", "olfactory"
]);

function validatePersonalSystemProfile(value) {
  const profile = requireExactKeys(
    value,
    ["mode", "selfDeclaredVectors", "manifestations", "combinationNotes"],
    "Запрос анализа.context.sections.systemProfile"
  );
  if (profile.mode !== "plain" && profile.mode !== "systemic") {
    throw new HttpError(400, "Системный контекст имеет неизвестный режим языка.");
  }
  const vectors = requireStringArray(
    profile.selfDeclaredVectors,
    "Запрос анализа.context.sections.systemProfile.selfDeclaredVectors",
    8,
    32
  );
  if (new Set(vectors).size !== vectors.length || vectors.some((entry) => !svpVectorIds.has(entry))) {
    throw new HttpError(400, "Системный контекст содержит неизвестный или повторяющийся вектор.");
  }
  return {
    mode: profile.mode,
    selfDeclaredVectors: vectors,
    manifestations: requireString(
      profile.manifestations,
      "Запрос анализа.context.sections.systemProfile.manifestations",
      8_000,
      true
    ),
    combinationNotes: requireString(
      profile.combinationNotes,
      "Запрос анализа.context.sections.systemProfile.combinationNotes",
      4_000,
      true
    )
  };
}

function validateReflectionContext(value) {
  if (value === null) return null;
  const context = requireExactKeys(
    value,
    ["schemaVersion", "profileUpdatedAt", "sections"],
    "Запрос анализа.context"
  );
  if (context.schemaVersion !== 1) throw new HttpError(400, "Личный контекст имеет неизвестную версию.");
  const profileUpdatedAt = requireIsoDate(
    context.profileUpdatedAt,
    "Запрос анализа.context.profileUpdatedAt"
  );
  const sections = requireExactKeys(
    context.sections,
    ["goals", "rhythms", "preferences", "boundaries", "systemProfile"],
    "Запрос анализа.context.sections"
  );
  const optionalText = (key, maximum = 4_000) => sections[key] === null
    ? null
    : requireString(sections[key], `Запрос анализа.context.sections.${key}`, maximum);
  const normalized = {
    goals: optionalText("goals"),
    rhythms: optionalText("rhythms"),
    preferences: optionalText("preferences"),
    boundaries: optionalText("boundaries"),
    systemProfile: sections.systemProfile === null
      ? null
      : validatePersonalSystemProfile(sections.systemProfile)
  };
  if (Object.values(normalized).every((entry) => entry === null)) {
    throw new HttpError(400, "Личный контекст не содержит выбранных разделов.");
  }
  return { schemaVersion: 1, profileUpdatedAt, sections: normalized };
}

function validateReflectionMemory(value) {
  if (value === null) return null;
  const memory = requireExactKeys(
    value,
    ["schemaVersion", "items"],
    "Запрос анализа.memory"
  );
  if (memory.schemaVersion !== 1) {
    throw new HttpError(400, "Память помощника имеет неизвестную версию.");
  }
  if (!Array.isArray(memory.items) || memory.items.length < 1 || memory.items.length > 6) {
    throw new HttpError(400, "Память помощника должна содержать от 1 до 6 явно выбранных элементов.");
  }

  const seenIds = new Set();
  let totalTextLength = 0;
  const items = memory.items.map((value, index) => {
    const item = requireExactKeys(
      value,
      ["id", "text", "updatedAt"],
      `Запрос анализа.memory.items[${index}]`
    );
    const id = requireId(item.id, `Запрос анализа.memory.items[${index}].id`);
    if (seenIds.has(id)) {
      throw new HttpError(400, "Память помощника содержит повторяющийся идентификатор.");
    }
    seenIds.add(id);

    const text = requireString(item.text, `Запрос анализа.memory.items[${index}].text`, 2_500);
    totalTextLength += text.length;
    if (totalTextLength > 12_000) {
      throw new HttpError(400, "Суммарный текст выбранной памяти превышает 12000 символов.");
    }

    return {
      id,
      text,
      updatedAt: requireIsoTimestamp(
        item.updatedAt,
        `Запрос анализа.memory.items[${index}].updatedAt`
      )
    };
  });

  return { schemaVersion: 1, items };
}

function validateReflectionRequest(value) {
  const request = requireExactKeys(
    value,
    ["entryId", "requestId", "sourceUpdatedAt", "originalText", "context", "memory"],
    "Запрос анализа"
  );
  return {
    entryId: requireId(request.entryId, "Запрос анализа.entryId"),
    requestId: requireId(request.requestId, "Запрос анализа.requestId"),
    sourceUpdatedAt: requireIsoDate(request.sourceUpdatedAt, "Запрос анализа.sourceUpdatedAt"),
    originalText: requireString(request.originalText, "Запрос анализа.originalText", 20_000),
    context: validateReflectionContext(request.context),
    memory: validateReflectionMemory(request.memory)
  };
}

function digestReflectionRequest(request) {
  return createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
}

function requireDigest(value, label) {
  const digest = requireString(value, label, 64);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new HttpError(400, `${label}: некорректный хеш.`);
  return digest;
}

function validateReflectionRequestEnvelope(value) {
  const envelope = requireExactKeys(
    value,
    ["schemaVersion", "createdAt", "expiresAt", "policy", "binding", "request"],
    "Файл запроса анализа"
  );
  if (envelope.schemaVersion !== 3) throw new HttpError(400, "Файл запроса анализа имеет неизвестную версию.");
  const createdAt = requireIsoDate(envelope.createdAt, "Файл запроса анализа.createdAt");
  const expiresAt = requireIsoDate(envelope.expiresAt, "Файл запроса анализа.expiresAt");
  const policy = requireExactKeys(
    envelope.policy,
    [
      "language", "frameworkDocument", "noAutomaticChanges", "maxQuestions", "contextSelection",
      "memorySelection", "memoryRole", "currentEntryPrecedence"
    ],
    "Файл запроса анализа.policy"
  );
  if (
    policy.language !== "ru" ||
    policy.frameworkDocument !== "docs/SVP_FOUNDATION.md" ||
    policy.noAutomaticChanges !== true ||
    policy.maxQuestions !== 1 ||
    policy.contextSelection !== "explicit" ||
    policy.memorySelection !== "explicit" ||
    policy.memoryRole !== "user_context" ||
    policy.currentEntryPrecedence !== true
  ) {
    throw new HttpError(400, "Файл запроса анализа содержит неизвестную политику.");
  }
  const binding = requireExactKeys(envelope.binding, ["requestDigest"], "Файл запроса анализа.binding");
  const requestDigest = requireDigest(binding.requestDigest, "Файл запроса анализа.binding.requestDigest");
  const normalizedRequest = validateReflectionRequest(envelope.request);
  if (digestReflectionRequest(normalizedRequest) !== requestDigest) {
    throw new HttpError(400, "Файл запроса анализа не совпадает со своей контрольной суммой.");
  }
  return { createdAt, expiresAt, requestDigest, request: normalizedRequest };
}

function validateReflectionResponse(value) {
  const envelope = requireExactKeys(value, ["schemaVersion", "response"], "Ответ анализа");
  if (envelope.schemaVersion !== 3) throw new HttpError(400, "Ответ анализа имеет неизвестную версию.");
  const response = requireExactKeys(
    envelope.response,
    ["entryId", "requestId", "requestDigest", "sourceUpdatedAt", "analysis"],
    "Ответ анализа.response"
  );
  requireId(response.entryId, "Ответ анализа.entryId");
  requireId(response.requestId, "Ответ анализа.requestId");
  requireDigest(response.requestDigest, "Ответ анализа.requestDigest");
  requireIsoDate(response.sourceUpdatedAt, "Ответ анализа.sourceUpdatedAt");

  const analysis = requireExactKeys(response.analysis, [
    "responseId", "requestId", "understanding", "observations", "possibleExplanation", "alternatives",
    "question", "proposedAction", "source", "generatedAt"
  ], "Ответ анализа.analysis");
  requireId(analysis.responseId, "Ответ анализа.analysis.responseId");
  requireId(analysis.requestId, "Ответ анализа.analysis.requestId");
  requireString(analysis.understanding, "Ответ анализа.analysis.understanding", 4_000);
  requireStringArray(analysis.observations, "Ответ анализа.analysis.observations", 5, 1_200);
  requireString(analysis.possibleExplanation, "Ответ анализа.analysis.possibleExplanation", 4_000, true);
  requireStringArray(analysis.alternatives, "Ответ анализа.analysis.alternatives", 3, 2_000);
  requireString(analysis.question, "Ответ анализа.analysis.question", 1_500, true);
  requireString(analysis.proposedAction, "Ответ анализа.analysis.proposedAction", 2_000, true);
  if (analysis.source !== "codex") throw new HttpError(400, "Ответ анализа имеет неизвестный источник.");
  requireIsoDate(analysis.generatedAt, "Ответ анализа.analysis.generatedAt");
  if (analysis.requestId !== response.requestId) throw new HttpError(400, "Ответ анализа относится к другому запросу.");
  return response;
}

function readValidatedFile(filePath, validator, invalidMessage) {
  if (!existsSync(filePath)) return null;
  try {
    return validator(JSON.parse(readFileSync(filePath, "utf8")));
  } catch (error) {
    if (error instanceof HttpError) throw new HttpError(400, `${invalidMessage} ${error.message}`);
    throw new HttpError(400, invalidMessage);
  }
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    renameSync(temporaryPath, filePath);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}

function removeIfExists(filePath) {
  if (existsSync(filePath)) unlinkSync(filePath);
}

function readCommands() {
  const filePath = resolve(bridgeRoot, "codex-commands.json");
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isCodexCommand).slice(0, 100) : [];
  } catch {
    throw new Error("Файл команд повреждён. Проверьте bridge/codex-commands.json.");
  }
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/system/select-folder") {
    requireMethod(request, "POST");
    const script = [
      "$shell = New-Object -ComObject Shell.Application",
      "$folder = $shell.BrowseForFolder(0, 'Выберите хранилище Obsidian', 0, 0)",
      "if ($folder) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Write($folder.Self.Path) }"
    ].join("; ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script], {
      encoding: "utf8",
      timeout: 300_000,
      windowsHide: false
    });
    if (result.error && result.error.code !== "ETIMEDOUT") throw new Error("Не удалось открыть выбор папки.");
    sendJson(response, 200, { path: result.stdout?.replace(/^\uFEFF/, "").trim() || null });
    return true;
  }

  if (url.pathname === "/api/obsidian/test") {
    requireMethod(request, "POST");
    const body = await readJson(request);
    const vault = resolveVault(body.vaultPath);
    sendJson(response, 200, { valid: true, vaultName: basename(vault) });
    return true;
  }

  if (url.pathname === "/api/obsidian/export") {
    requireMethod(request, "POST");
    const body = await readJson(request);
    const vault = resolveVault(body.vaultPath);
    const destination = safeDestination(vault, body.folder);
    const notes = Array.isArray(body.notes) ? body.notes : [];
    mkdirSync(destination, { recursive: true });
    let exported = 0;
    for (const note of notes) {
      if (!note || typeof note.id !== "string") continue;
      const filePath = resolve(destination, safeFileName(note.title, note.id));
      writeFileSync(filePath, noteMarkdown(note, Boolean(body.includeFrontmatter)), "utf8");
      exported += 1;
    }
    sendJson(response, 200, { exported, destination });
    return true;
  }

  if (url.pathname === "/api/bridge/snapshot") {
    requireMethod(request, "POST");
    const body = await readJson(request);
    const snapshot = validateCodexSnapshot(body);
    ensureBridge();
    const fileName = "dashboard-snapshot.json";
    writeJsonAtomic(resolve(bridgeRoot, fileName), snapshot);
    sendJson(response, 200, { writtenAt: snapshot.writtenAt, fileName });
    return true;
  }

  if (url.pathname === "/api/bridge/snapshot/delete") {
    requireMethod(request, "POST");
    ensureBridge();
    removeIfExists(resolve(bridgeRoot, "dashboard-snapshot.json"));
    sendJson(response, 200, { deleted: true });
    return true;
  }

  if (url.pathname === "/api/bridge/reflection/request") {
    requireMethod(request, "POST");
    const analysisRequest = validateReflectionRequest(await readJson(request, 256 * 1024));
    ensureBridge();
    const activeEnvelope = readValidatedFile(
      reflectionRequestPath,
      validateReflectionRequestEnvelope,
      "Файл запроса анализа повреждён."
    );
    const activeExpired = activeEnvelope && Date.parse(activeEnvelope.expiresAt) <= Date.now();
    if (activeExpired) {
      removeIfExists(reflectionRequestPath);
      removeIfExists(reflectionResponsePath);
    }
    const requestDigest = digestReflectionRequest(analysisRequest);
    if (activeEnvelope && !activeExpired) {
      if (activeEnvelope.request.requestId === analysisRequest.requestId) {
        if (activeEnvelope.requestDigest !== requestDigest) {
          throw new HttpError(409, "Этот идентификатор уже относится к другому тексту или контексту.");
        }
        sendJson(response, 200, {
          queuedAt: activeEnvelope.createdAt,
          fileName: "reflection-analysis-request.json",
          requestDigest
        });
        return true;
      }
      throw new HttpError(409, "Сначала дождитесь или завершите текущий разбор.");
    }
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + reflectionRequestTtlMs).toISOString();
    const envelope = {
      schemaVersion: 3,
      createdAt,
      expiresAt,
      policy: {
        language: "ru",
        frameworkDocument: "docs/SVP_FOUNDATION.md",
        noAutomaticChanges: true,
        maxQuestions: 1,
        contextSelection: "explicit",
        memorySelection: "explicit",
        memoryRole: "user_context",
        currentEntryPrecedence: true
      },
      binding: { requestDigest },
      request: analysisRequest
    };
    removeIfExists(reflectionResponsePath);
    writeJsonAtomic(reflectionRequestPath, envelope);
    sendJson(response, 200, {
      queuedAt: createdAt,
      fileName: "reflection-analysis-request.json",
      requestDigest
    });
    return true;
  }

  if (url.pathname === "/api/bridge/reflection/response") {
    requireMethod(request, "GET");
    ensureBridge();
    const activeRequest = readValidatedFile(
      reflectionRequestPath,
      validateReflectionRequestEnvelope,
      "Файл запроса анализа повреждён."
    );
    if (activeRequest && Date.parse(activeRequest.expiresAt) <= Date.now()) {
      removeIfExists(reflectionRequestPath);
      removeIfExists(reflectionResponsePath);
      sendJson(response, 200, { response: null });
      return true;
    }
    const analysisResponse = readValidatedFile(
      reflectionResponsePath,
      validateReflectionResponse,
      "Файл ответа анализа повреждён."
    );
    if (!activeRequest && analysisResponse) {
      removeIfExists(reflectionResponsePath);
      sendJson(response, 200, { response: null });
      return true;
    }
    const matchesActiveRequest = Boolean(
      activeRequest &&
      analysisResponse &&
      activeRequest.requestDigest === analysisResponse.requestDigest &&
      activeRequest.request.requestId === analysisResponse.requestId &&
      activeRequest.request.entryId === analysisResponse.entryId &&
      activeRequest.request.sourceUpdatedAt === analysisResponse.sourceUpdatedAt
    );
    sendJson(response, 200, { response: matchesActiveRequest ? analysisResponse : null });
    return true;
  }

  if (url.pathname === "/api/bridge/reflection/cancel") {
    requireMethod(request, "POST");
    const body = requireExactKeys(
      await readJson(request, 8 * 1024),
      ["requestId", "requestDigest"],
      "Отмена анализа"
    );
    const requestId = requireId(body.requestId, "Отмена анализа.requestId");
    const requestDigest = requireDigest(body.requestDigest, "Отмена анализа.requestDigest");
    ensureBridge();
    const activeRequest = readValidatedFile(
      reflectionRequestPath,
      validateReflectionRequestEnvelope,
      "Файл запроса анализа повреждён."
    );
    if (
      activeRequest &&
      (activeRequest.request.requestId !== requestId || activeRequest.requestDigest !== requestDigest)
    ) {
      throw new HttpError(409, "Активен другой запрос анализа.");
    }
    removeIfExists(reflectionRequestPath);
    removeIfExists(reflectionResponsePath);
    sendJson(response, 200, { cancelled: true });
    return true;
  }

  if (url.pathname === "/api/bridge/reflection/ack") {
    requireMethod(request, "POST");
    const body = requireExactKeys(
      await readJson(request, 8 * 1024),
      ["requestId", "responseId", "requestDigest", "entryId", "sourceUpdatedAt"],
      "Подтверждение анализа"
    );
    const requestId = requireId(body.requestId, "Подтверждение анализа.requestId");
    const responseId = requireId(body.responseId, "Подтверждение анализа.responseId");
    const requestDigest = requireDigest(body.requestDigest, "Подтверждение анализа.requestDigest");
    const entryId = requireId(body.entryId, "Подтверждение анализа.entryId");
    const sourceUpdatedAt = requireIsoDate(body.sourceUpdatedAt, "Подтверждение анализа.sourceUpdatedAt");
    ensureBridge();
    const activeRequest = readValidatedFile(
      reflectionRequestPath,
      validateReflectionRequestEnvelope,
      "Файл запроса анализа повреждён."
    );
    const analysisResponse = readValidatedFile(
      reflectionResponsePath,
      validateReflectionResponse,
      "Файл ответа анализа повреждён."
    );
    const responseMatches = Boolean(
      analysisResponse &&
      analysisResponse.requestId === requestId &&
      analysisResponse.requestDigest === requestDigest &&
      analysisResponse.entryId === entryId &&
      analysisResponse.sourceUpdatedAt === sourceUpdatedAt &&
      analysisResponse.analysis.responseId === responseId
    );
    const requestMatches = Boolean(
      activeRequest &&
      activeRequest.request.requestId === requestId &&
      activeRequest.requestDigest === requestDigest &&
      activeRequest.request.entryId === entryId &&
      activeRequest.request.sourceUpdatedAt === sourceUpdatedAt
    );
    if (responseMatches && requestMatches) {
      removeIfExists(reflectionResponsePath);
      removeIfExists(reflectionRequestPath);
    }
    sendJson(response, 200, { acknowledged: responseMatches && requestMatches });
    return true;
  }

  if (url.pathname === "/api/bridge/commands") {
    requireMethod(request, "GET");
    ensureBridge();
    sendJson(response, 200, { commands: readCommands() });
    return true;
  }

  if (url.pathname === "/api/bridge/ack") {
    requireMethod(request, "POST");
    const body = await readJson(request);
    const ids = new Set(Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : []);
    ensureBridge();
    const commands = readCommands();
    const applied = commands.filter((command) => ids.has(command.id));
    const remaining = commands.filter((command) => !ids.has(command.id));
    if (applied.length) {
      const archive = resolve(bridgeRoot, "archive");
      mkdirSync(archive, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writeFileSync(resolve(archive, `codex-commands-${stamp}.json`), JSON.stringify(applied, null, 2), "utf8");
    }
    writeFileSync(resolve(bridgeRoot, "codex-commands.json"), JSON.stringify(remaining, null, 2), "utf8");
    sendJson(response, 200, { acknowledged: applied.length, remaining: remaining.length });
    return true;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { message: "Локальная функция не найдена." });
    return true;
  }
  return false;
}

const server = createServer(async (request, response) => {
  lastRequestAt = Date.now();
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    requireLocalApiRequest(request, url);
    if (await handleApi(request, response, url)) return;

    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const requestedPath = resolve(publicRoot, relativePath);
    if (requestedPath !== publicRoot && !requestedPath.startsWith(`${publicRoot}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    try {
      const stats = statSync(requestedPath);
      if (stats.isFile()) {
        sendFile(response, requestedPath);
        return;
      }
    } catch {
      // Маршруты интерфейса обслуживаются через index.html.
    }
    sendFile(response, resolve(publicRoot, "index.html"));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    sendJson(response, status, { message: error instanceof Error ? error.message : "Локальная операция завершилась с ошибкой." });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") process.exit(0);
  throw error;
});

server.listen(port, host);

setInterval(() => {
  if (Date.now() - lastRequestAt >= idleLimitMs) server.close(() => process.exit(0));
}, 60_000).unref();
