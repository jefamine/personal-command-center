import type {
  AppSettings,
  CalendarEvent,
  EnergyLevel,
  PlanItem,
  Task
} from "../types";
import {
  dateKeyFromDateTime,
  dayDifference,
  localDateKey,
  minutesFromDateTime,
  parseTime
} from "./date";

export interface TimeInterval {
  startMinutes: number;
  endMinutes: number;
}

const energyRank: Record<EnergyLevel, number> = {
  low: 1,
  medium: 2,
  high: 3
};

export function scoreTask(
  task: Task,
  settings: AppSettings,
  today = localDateKey()
): { score: number; reasons: string[] } {
  let score = task.priority * 20;
  const reasons: string[] = [];

  if (task.priority === 4) reasons.push("высокий приоритет");
  if (task.scheduledDate === today) {
    score += 36;
    reasons.push("запланировано на сегодня");
  }

  if (task.dueDate) {
    const days = dayDifference(today, task.dueDate);
    if (days < 0) {
      score += 70 + Math.min(Math.abs(days) * 4, 24);
      reasons.push("срок уже прошёл");
    } else if (days === 0) {
      score += 60;
      reasons.push("срок сегодня");
    } else if (days <= 2) {
      score += 42 - days * 6;
      reasons.push("близкий срок");
    } else if (days <= 7) {
      score += 16;
      reasons.push("срок на этой неделе");
    }
  }

  const energyDistance = Math.abs(
    energyRank[task.energy] - energyRank[settings.currentEnergy]
  );
  if (energyDistance === 0) {
    score += 14;
    reasons.push("подходит по энергии");
  } else if (energyDistance === 2) {
    score -= 10;
  }

  if (task.estimateMinutes <= settings.focusBlockMinutes) {
    score += 8;
    reasons.push("помещается в один фокус-блок");
  }

  if (task.status === "next") score += 10;
  if (task.status === "inbox") score -= 25;

  if (reasons.length === 0) reasons.push("лучший доступный приоритет");
  return { score, reasons };
}

export function buildDailyPlan(
  tasks: Task[],
  settings: AppSettings,
  today = localDateKey(),
  events: CalendarEvent[] = []
): PlanItem[] {
  const todayEvents = events.filter(
    (event) => dateKeyFromDateTime(event.startAt) === today
  );
  const confirmedTaskIds = new Set(
    todayEvents
      .filter((event) => event.kind === "focus" && event.taskId)
      .map((event) => event.taskId as string)
  );

  const confirmed: PlanItem[] = todayEvents
    .filter((event) => event.kind === "focus" && event.taskId)
    .flatMap((event): PlanItem[] => {
      const task = tasks.find((candidate) => candidate.id === event.taskId);
      if (!task || task.status === "done") return [];
      const score = scoreTask(task, settings, today).score;
      return [{
        task,
        score,
        reasons: ["закреплено в календаре"],
        startMinutes: minutesFromDateTime(event.startAt),
        endMinutes: minutesFromDateTime(event.endAt),
        confirmed: true
      }];
    });

  const candidates = tasks
    .filter(
      (task) =>
        task.status !== "done" &&
        task.status !== "waiting" &&
        task.status !== "someday" &&
        task.status !== "inbox" &&
        !confirmedTaskIds.has(task.id)
    )
    .map((task) => ({ task, ...scoreTask(task, settings, today) }))
    .sort((a, b) => b.score - a.score || a.task.createdAt.localeCompare(b.task.createdAt));

  const plan: PlanItem[] = [...confirmed];
  const confirmedMinutes = confirmed.reduce(
    (sum, item) => sum + (item.endMinutes - item.startMinutes),
    0
  );
  let remaining = Math.max(0, settings.dailyCapacityMinutes - confirmedMinutes);
  const free = getFreeIntervals(settings, todayEvents, today);

  for (const candidate of candidates) {
    const duration = Math.max(5, candidate.task.estimateMinutes);
    if (duration > remaining) continue;

    const interval = free.find(
      (candidateInterval) =>
        candidateInterval.endMinutes - candidateInterval.startMinutes >= duration
    );
    if (!interval) continue;

    const startMinutes = interval.startMinutes;
    const endMinutes = startMinutes + duration;

    plan.push({
      ...candidate,
      startMinutes,
      endMinutes,
      confirmed: false
    });
    remaining -= duration;
    interval.startMinutes = endMinutes + settings.bufferMinutes;
  }

  return plan.sort((a, b) => a.startMinutes - b.startMinutes);
}

export function getFreeIntervals(
  settings: AppSettings,
  events: CalendarEvent[],
  dateKey = localDateKey()
): TimeInterval[] {
  const workdayStart = parseTime(settings.workdayStart);
  const workdayEnd = parseTime(settings.workdayEnd);
  const busy = events
    .filter((event) => dateKeyFromDateTime(event.startAt) === dateKey)
    .map((event) => ({
      startMinutes: Math.max(
        workdayStart,
        minutesFromDateTime(event.startAt) - settings.bufferMinutes
      ),
      endMinutes: Math.min(
        workdayEnd,
        minutesFromDateTime(event.endAt) + settings.bufferMinutes
      )
    }))
    .filter((interval) => interval.endMinutes > interval.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const free: TimeInterval[] = [];
  let cursor = workdayStart;
  for (const interval of busy) {
    if (interval.startMinutes > cursor) {
      free.push({ startMinutes: cursor, endMinutes: interval.startMinutes });
    }
    cursor = Math.max(cursor, interval.endMinutes);
  }
  if (cursor < workdayEnd) {
    free.push({ startMinutes: cursor, endMinutes: workdayEnd });
  }
  return free;
}

export function planLoadMinutes(plan: PlanItem[]): number {
  return plan.reduce((sum, item) => sum + item.task.estimateMinutes, 0);
}
