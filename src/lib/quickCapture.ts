import { addDays, localDateKey } from "./date";
import type { Project, RecurrenceRule, TaskDraft } from "../types";

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru").replace(/ё/g, "е").trim();
}

export function parseQuickCapture(input: string, projects: Project[] = []): TaskDraft {
  let title = input.trim();
  let estimateMinutes = 25;
  let priority: 1 | 2 | 3 | 4 = 2;
  let dueDate: string | null = null;
  let scheduledDate: string | null = null;
  let context = "Везде";
  let projectId: string | null = null;
  let recurrence: RecurrenceRule = "none";

  const hoursMatch = title.match(/(\d+(?:[.,]\d+)?)\s*(?:ч|час(?:а|ов)?)(?=\s|$|[,.])/i);
  const minutesMatch = title.match(/(\d+)\s*(?:м|мин(?:ут[аы]?)?)(?=\s|$|[,.])/i);
  if (hoursMatch) {
    estimateMinutes = Math.round(Number(hoursMatch[1].replace(",", ".")) * 60);
    title = title.replace(hoursMatch[0], " ");
  } else if (minutesMatch) {
    estimateMinutes = Number(minutesMatch[1]);
    title = title.replace(minutesMatch[0], " ");
  }

  const priorityMatch = title.match(/!{1,3}/);
  if (priorityMatch) {
    priority = priorityMatch[0].length >= 2 ? 4 : 3;
    title = title.replace(priorityMatch[0], " ");
  }

  const normalizedTitle = normalize(title);
  const today = localDateKey();
  if (normalizedTitle.includes("послезавтра")) {
    dueDate = scheduledDate = addDays(today, 2);
    title = title.replace(/послезавтра/iu, " ");
  } else if (normalizedTitle.includes("завтра")) {
    dueDate = scheduledDate = addDays(today, 1);
    title = title.replace(/завтра/iu, " ");
  } else if (normalizedTitle.includes("сегодня")) {
    dueDate = scheduledDate = today;
    title = title.replace(/сегодня/iu, " ");
  }

  const contextMatch = title.match(/@([\p{L}\d_-]+)/u);
  if (contextMatch) {
    context = contextMatch[1];
    title = title.replace(contextMatch[0], " ");
  }

  const projectMatch = title.match(/#([\p{L}\d_-]+)/u);
  if (projectMatch) {
    const needle = normalize(projectMatch[1].replace(/_/g, " "));
    projectId = projects.find((project) => normalize(project.title).includes(needle))?.id ?? null;
    title = title.replace(projectMatch[0], " ");
  }

  const recurrencePatterns: Array<[RegExp, RecurrenceRule]> = [
    [/каждый день/iu, "daily"],
    [/по будням/iu, "weekdays"],
    [/каждую неделю/iu, "weekly"],
    [/каждый месяц/iu, "monthly"]
  ];
  for (const [pattern, rule] of recurrencePatterns) {
    if (pattern.test(title)) {
      recurrence = rule;
      title = title.replace(pattern, " ");
      break;
    }
  }

  title = title.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();

  return {
    title: title || input.trim(),
    status: scheduledDate ? "planned" : projectId ? "next" : "inbox",
    projectId,
    priority,
    estimateMinutes: Math.max(5, estimateMinutes),
    context,
    dueDate,
    scheduledDate,
    recurrence
  };
}
