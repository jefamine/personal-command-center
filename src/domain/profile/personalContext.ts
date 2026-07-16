import type {
  PersonalContext,
  PersonalContextSectionId,
  PersonalSystemProfile,
  ReflectionContextProjection,
  SvpLanguageMode,
  SvpVectorId
} from "../../types";

export const PERSONAL_CONTEXT_SECTION_LABELS: Record<PersonalContextSectionId, string> = {
  goals: "Что сейчас важно",
  rhythms: "Мой ритм",
  preferences: "Как мне помогать",
  boundaries: "Что нужно беречь",
  systemProfile: "Системный контекст"
};

export const SVP_VECTOR_LABELS: Record<SvpVectorId, string> = {
  skin: "Кожный",
  anal: "Анальный",
  muscular: "Мышечный",
  urethral: "Уретральный",
  visual: "Зрительный",
  sound: "Звуковой",
  oral: "Оральный",
  olfactory: "Обонятельный"
};

export const SVP_VECTOR_IDS = Object.keys(SVP_VECTOR_LABELS) as SvpVectorId[];
export const SVP_LANGUAGE_MODES: SvpLanguageMode[] = ["off", "plain", "systemic"];

export function createDefaultPersonalContext(): PersonalContext {
  return {
    goals: "",
    rhythms: "",
    preferences: "",
    boundaries: "",
    systemProfile: {
      mode: "off",
      selfDeclaredVectors: [],
      manifestations: "",
      combinationNotes: ""
    },
    updatedAt: null
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeSystemProfile(value: unknown): PersonalSystemProfile {
  const source = value && typeof value === "object"
    ? value as Partial<PersonalSystemProfile>
    : {};
  const mode = SVP_LANGUAGE_MODES.includes(source.mode as SvpLanguageMode)
    ? source.mode as SvpLanguageMode
    : "off";
  const vectors = Array.isArray(source.selfDeclaredVectors)
    ? source.selfDeclaredVectors.filter(
        (entry, index, list): entry is SvpVectorId =>
          SVP_VECTOR_IDS.includes(entry as SvpVectorId) && list.indexOf(entry) === index
      )
    : [];
  return {
    mode,
    selfDeclaredVectors: vectors,
    manifestations: text(source.manifestations),
    combinationNotes: text(source.combinationNotes)
  };
}

export function normalizePersonalContext(value: unknown): PersonalContext {
  const source = value && typeof value === "object"
    ? value as Partial<PersonalContext>
    : {};
  const updatedAt = typeof source.updatedAt === "string" && Number.isFinite(Date.parse(source.updatedAt))
    ? source.updatedAt
    : null;
  return {
    goals: text(source.goals),
    rhythms: text(source.rhythms),
    preferences: text(source.preferences),
    boundaries: text(source.boundaries),
    systemProfile: normalizeSystemProfile(source.systemProfile),
    updatedAt
  };
}

export function hasSystemProfile(profile: PersonalSystemProfile) {
  return profile.mode !== "off" && Boolean(
    profile.selfDeclaredVectors.length ||
    profile.manifestations.trim() ||
    profile.combinationNotes.trim()
  );
}

export function availablePersonalContextSections(
  context: PersonalContext
): PersonalContextSectionId[] {
  const sections: PersonalContextSectionId[] = [];
  if (context.goals.trim()) sections.push("goals");
  if (context.rhythms.trim()) sections.push("rhythms");
  if (context.preferences.trim()) sections.push("preferences");
  if (context.boundaries.trim()) sections.push("boundaries");
  if (hasSystemProfile(context.systemProfile)) sections.push("systemProfile");
  return sections;
}

export function buildReflectionContextProjection(
  context: PersonalContext,
  selectedSections: PersonalContextSectionId[]
): ReflectionContextProjection | null {
  const selected = new Set(selectedSections);
  const available = new Set(availablePersonalContextSections(context));
  const include = (section: PersonalContextSectionId) =>
    selected.has(section) && available.has(section);
  const includedSections = [...selected].filter((section) => available.has(section));
  if (!includedSections.length || !context.updatedAt) return null;

  return {
    schemaVersion: 1,
    profileUpdatedAt: context.updatedAt,
    sections: {
      goals: include("goals") ? context.goals.trim() : null,
      rhythms: include("rhythms") ? context.rhythms.trim() : null,
      preferences: include("preferences") ? context.preferences.trim() : null,
      boundaries: include("boundaries") ? context.boundaries.trim() : null,
      systemProfile: include("systemProfile")
        ? {
            mode: context.systemProfile.mode,
            selfDeclaredVectors: [...context.systemProfile.selfDeclaredVectors],
            manifestations: context.systemProfile.manifestations.trim(),
            combinationNotes: context.systemProfile.combinationNotes.trim()
          }
        : null
    }
  };
}

export function sectionsFromProjection(
  projection: ReflectionContextProjection | null
): PersonalContextSectionId[] {
  if (!projection) return [];
  const { sections } = projection;
  return (Object.keys(sections) as PersonalContextSectionId[])
    .filter((section) => sections[section] !== null);
}
