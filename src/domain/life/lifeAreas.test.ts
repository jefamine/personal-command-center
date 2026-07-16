import { describe, expect, it } from "vitest";
import type { LifeArea, Project } from "../../types";
import {
  lifeAreaTitleKey,
  normalizeLifeModel,
  projectLifeAreaTitle
} from "./lifeAreas";

const project = (id: string, area: string, areaId?: string | null): Omit<Project, "areaId"> & { areaId?: string | null } => ({
  id,
  title: `Проект ${id}`,
  description: "",
  area,
  areaId,
  color: "#7c5cff",
  status: "active",
  nextReviewAt: null,
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:00:00.000Z"
});

describe("life areas", () => {
  it("объединяет одинаковые старые области и не создаёт сферу для заглушки", () => {
    const migrated = normalizeLifeModel([
      project("one", " Работа "),
      project("two", "работа"),
      project("three", "Без области"),
      project("four", "")
    ]);

    expect(migrated.lifeAreas).toHaveLength(1);
    expect(migrated.lifeAreas[0].title).toBe("Работа");
    expect(migrated.projects[0].areaId).toBe(migrated.lifeAreas[0].id);
    expect(migrated.projects[1].areaId).toBe(migrated.lifeAreas[0].id);
    expect(migrated.projects[2]).toMatchObject({ areaId: null, area: "Без области" });
    expect(migrated.projects[3]).toMatchObject({ areaId: null, area: "Без области" });
  });

  it("сохраняет устойчивую ссылку после переименования сферы", () => {
    const existing: LifeArea[] = [{
      id: "area-work",
      title: "Дело",
      description: "",
      color: "#2f80ed",
      archived: false,
      order: 0,
      createdAt: "2026-07-15T09:00:00.000Z",
      updatedAt: "2026-07-15T09:00:00.000Z"
    }];
    const migrated = normalizeLifeModel([project("one", "Старое название", "area-work")], existing);

    expect(migrated.projects[0]).toMatchObject({ areaId: "area-work", area: "Дело" });
    expect(projectLifeAreaTitle(migrated.projects[0], migrated.lifeAreas)).toBe("Дело");
  });

  it("нормализует названия предсказуемо", () => {
    expect(lifeAreaTitleKey("  Личная   жизнь ")).toBe("личная жизнь");
  });
});
