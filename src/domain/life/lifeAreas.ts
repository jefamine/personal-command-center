import type { LifeArea, Project } from "../../types";

export const UNASSIGNED_LIFE_AREA = "Без сферы";

const FALLBACK_DATE = "1970-01-01T00:00:00.000Z";
const areaPalette = ["#7c5cff", "#2f80ed", "#2eb67d", "#e28a38", "#d96aa7", "#7a8b3a"];

export const LIFE_AREA_TEMPLATES = [
  {
    id: "life-area-template-family",
    title: "Семья",
    description: "Близкие, общая жизнь, отношения, воспоминания и то, что хочется создавать вместе.",
    color: "#d96aa7"
  },
  {
    id: "life-area-template-work",
    title: "Работа",
    description: "То, чем вы зарабатываете на жизнь: обязательства, проекты, материалы и профессиональное развитие.",
    color: "#2f80ed"
  },
  {
    id: "life-area-template-self-knowledge",
    title: "Познание себя",
    description: "Наблюдения, осмысление, реализация, важные вопросы и материалы о человеке.",
    color: "#7c5cff"
  },
  {
    id: "life-area-template-health",
    title: "Здоровье",
    description: "Самочувствие, медицинские данные, движение, питание и бережная забота о себе.",
    color: "#2eb67d"
  },
  {
    id: "life-area-template-leisure",
    title: "Досуг",
    description: "Отдых, впечатления, игры, поездки, творчество и всё, что наполняет жизнь.",
    color: "#e28a38"
  }
] as const;

export type LegacyProjectWithOptionalAreaId = Omit<Project, "areaId"> & {
  areaId?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("ru")
    .replace(/[^a-zа-яё0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

export function lifeAreaTitleKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

export function isUnassignedAreaLabel(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return true;
  const key = lifeAreaTitleKey(value);
  return key === "без области" || key === lifeAreaTitleKey(UNASSIGNED_LIFE_AREA);
}

function deterministicAreaId(title: string, occupied: Set<string>): string {
  const key = lifeAreaTitleKey(title);
  const base = `life-area-${slug(title) || "area"}-${stableHash(key)}`;
  if (!occupied.has(base)) return base;
  let suffix = 2;
  while (occupied.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function createLifeAreaTemplates(now: string, startOrder = 0): LifeArea[] {
  return LIFE_AREA_TEMPLATES.map((template, index) => ({
    ...template,
    archived: false,
    showInTopNavigation: true,
    order: startOrder + index,
    createdAt: now,
    updatedAt: now
  }));
}

/**
 * Installs the agreed starter map once for an untouched prototype state.
 * A custom set is never expanded automatically.
 */
export function installLifeAreaTemplates(lifeAreas: LifeArea[], now: string): LifeArea[] {
  const activeTitles = lifeAreas.filter((area) => !area.archived).map((area) => lifeAreaTitleKey(area.title));
  const untouchedPrototype = activeTitles.length === 0 || (
    activeTitles.length === 1 && activeTitles[0] === lifeAreaTitleKey("Личная эффективность")
  );
  if (!untouchedPrototype) return lifeAreas;

  const ids = new Set(lifeAreas.map((area) => area.id));
  const titles = new Set(lifeAreas.map((area) => lifeAreaTitleKey(area.title)));
  const templates = createLifeAreaTemplates(now, lifeAreas.length)
    .filter((area) => !ids.has(area.id) && !titles.has(lifeAreaTitleKey(area.title)));
  return [...lifeAreas, ...templates].map((area, order) => ({ ...area, order }));
}

function normalizeExistingLifeAreas(value: unknown): LifeArea[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const result: LifeArea[] = [];

  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const title = typeof candidate.title === "string"
      ? candidate.title.trim().replace(/\s+/g, " ")
      : "";
    const titleKey = lifeAreaTitleKey(title);
    if (!id || !title || seenIds.has(id) || seenTitles.has(titleKey)) continue;
    const createdAt = validDate(candidate.createdAt) ? candidate.createdAt : FALLBACK_DATE;
    const updatedAt = validDate(candidate.updatedAt) ? candidate.updatedAt : createdAt;
    result.push({
      id,
      title,
      description: typeof candidate.description === "string" ? candidate.description : "",
      color: validColor(candidate.color) ? candidate.color : areaPalette[result.length % areaPalette.length],
      archived: candidate.archived === true,
      showInTopNavigation: candidate.showInTopNavigation !== false,
      order: Number.isInteger(candidate.order) && Number(candidate.order) >= 0
        ? Number(candidate.order)
        : result.length,
      createdAt,
      updatedAt
    });
    seenIds.add(id);
    seenTitles.add(titleKey);
  }

  return result
    .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt))
    .map((area, order) => ({ ...area, order }));
}

export function normalizeLifeModel(
  projectsValue: LegacyProjectWithOptionalAreaId[],
  lifeAreasValue?: unknown
): { projects: Project[]; lifeAreas: LifeArea[] } {
  const lifeAreas = normalizeExistingLifeAreas(lifeAreasValue);
  const occupiedIds = new Set(lifeAreas.map((area) => area.id));
  const byId = new Map(lifeAreas.map((area) => [area.id, area]));
  const byTitle = new Map(lifeAreas.map((area) => [lifeAreaTitleKey(area.title), area]));

  const projects = projectsValue.map((project) => {
    let area = typeof project.areaId === "string" ? byId.get(project.areaId) : undefined;
    const legacyTitle = typeof project.area === "string" ? project.area.trim().replace(/\s+/g, " ") : "";

    if (!area && !isUnassignedAreaLabel(legacyTitle)) {
      const titleKey = lifeAreaTitleKey(legacyTitle);
      area = byTitle.get(titleKey);
      if (!area) {
        const createdAt = validDate(project.createdAt) ? project.createdAt : FALLBACK_DATE;
        const updatedAt = validDate(project.updatedAt) ? project.updatedAt : createdAt;
        area = {
          id: deterministicAreaId(legacyTitle, occupiedIds),
          title: legacyTitle,
          description: "",
          color: validColor(project.color) ? project.color : areaPalette[lifeAreas.length % areaPalette.length],
          archived: false,
          showInTopNavigation: true,
          order: lifeAreas.length,
          createdAt,
          updatedAt
        };
        lifeAreas.push(area);
        occupiedIds.add(area.id);
        byId.set(area.id, area);
        byTitle.set(titleKey, area);
      }
    }

    return {
      ...project,
      areaId: area?.id ?? null,
      area: area?.title ?? "Без области"
    };
  });

  return {
    projects,
    lifeAreas: lifeAreas.map((area, order) => ({ ...area, order }))
  };
}

export function projectLifeArea(project: Project, lifeAreas: LifeArea[]): LifeArea | null {
  return project.areaId ? lifeAreas.find((area) => area.id === project.areaId) ?? null : null;
}

export function projectLifeAreaTitle(project: Project, lifeAreas: LifeArea[]): string {
  return projectLifeArea(project, lifeAreas)?.title ?? UNASSIGNED_LIFE_AREA;
}
