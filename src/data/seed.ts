import type { DashboardState, LifeArea, Project, Task } from "../types";
import { addDays, localDateKey } from "../lib/date";
import { createDefaultIntegrations } from "./integrations";
import { createDefaultSettings } from "./settings";
import { createDefaultWidgets } from "./widgets";
import { createDefaultPersonalContext } from "../domain/profile/personalContext";
import { createEmptyObjectGraph } from "../domain/objects/objectGraph";
import { createLifeAreaTemplates } from "../domain/life/lifeAreas";

export function createInitialState(): DashboardState {
  const now = new Date().toISOString();
  const today = localDateKey();
  const lifeArea: LifeArea = {
    id: crypto.randomUUID(),
    title: "Личная эффективность",
    description: "Как устроены внимание, обязательства и устойчивый рабочий ритм.",
    color: "#7c5cff",
    archived: false,
    showInTopNavigation: true,
    order: 0,
    createdAt: now,
    updatedAt: now
  };
  const project: Project = {
    id: crypto.randomUUID(),
    title: "Настройка личной системы",
    description: "Собрать рабочую версию командного центра под свой ритм.",
    areaId: lifeArea.id,
    area: "Личная эффективность",
    color: "#7c5cff",
    status: "active",
    nextReviewAt: addDays(today, 7),
    createdAt: now,
    updatedAt: now
  };

  const tasks: Task[] = [
    {
      id: crypto.randomUUID(),
      title: "Определить три главных результата на эту неделю",
      notes: "Не список дел, а измеримые результаты.",
      status: "next",
      projectId: project.id,
      priority: 4,
      estimateMinutes: 25,
      energy: "high",
      context: "Фокус",
      dueDate: addDays(today, 2),
      scheduledDate: today,
      completedAt: null,
      recurrence: "none",
      generatedFromTaskId: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: crypto.randomUUID(),
      title: "Записать рабочие часы и комфортную нагрузку",
      notes: "Эти параметры будут использоваться оптимизатором.",
      status: "planned",
      projectId: project.id,
      priority: 3,
      estimateMinutes: 15,
      energy: "low",
      context: "Компьютер",
      dueDate: null,
      scheduledDate: today,
      completedAt: null,
      recurrence: "none",
      generatedFromTaskId: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: crypto.randomUUID(),
      title: "Собрать все текущие обязательства во входящие",
      notes: "Пока без сортировки — только освободить голову.",
      status: "inbox",
      projectId: null,
      priority: 2,
      estimateMinutes: 20,
      energy: "medium",
      context: "Везде",
      dueDate: null,
      scheduledDate: null,
      completedAt: null,
      recurrence: "none",
      generatedFromTaskId: null,
      createdAt: now,
      updatedAt: now
    }
  ];

  return {
    version: 13,
    tasks,
    projects: [project],
    lifeAreas: [lifeArea, ...createLifeAreaTemplates(now, 1)],
    events: [],
    notes: [],
    reflections: [],
    assistantMemory: [],
    personalContext: createDefaultPersonalContext(),
    settings: createDefaultSettings(),
    integrations: createDefaultIntegrations(),
    widgets: createDefaultWidgets(),
    readingItems: [],
    activityLog: [],
    objectGraph: createEmptyObjectGraph(),
    updatedAt: now
  };
}
