import { describe, expect, it } from "vitest";
import { parseQuickCapture } from "./quickCapture";

describe("quick capture parser", () => {
  it("разбирает срок, длительность, контекст и приоритет", () => {
    const result = parseQuickCapture("Позвонить Ивану завтра 30 мин @звонки !!");
    expect(result).toMatchObject({
      title: "Позвонить Ивану",
      estimateMinutes: 30,
      context: "звонки",
      priority: 4,
      status: "planned"
    });
    expect(result.dueDate).toBeTruthy();
  });

  it("связывает задачу с найденным проектом", () => {
    const result = parseQuickCapture("Подготовить структуру #Дашборд", [
      {
        id: "project-1",
        title: "Личный дашборд",
        description: "",
        areaId: null,
        area: "Система",
        color: "#fff",
        status: "active",
        nextReviewAt: null,
        createdAt: "",
        updatedAt: ""
      }
    ]);
    expect(result.projectId).toBe("project-1");
    expect(result.status).toBe("next");
  });

  it("понимает повторение", () => {
    expect(parseQuickCapture("Проверить почту по будням").recurrence).toBe("weekdays");
  });
});
