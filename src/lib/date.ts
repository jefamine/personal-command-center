export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function addMonths(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = new Date(year, month - 1 + months, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return localDateKey(target);
}

export function nextWeekday(dateKey: string): string {
  let next = addDays(dateKey, 1);
  while ([0, 6].includes(new Date(`${next}T12:00:00`).getDay())) next = addDays(next, 1);
  return next;
}

export function parseTime(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatTime(minutes: number): string {
  const normalized = Math.max(0, Math.min(minutes, 24 * 60 - 1));
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function dateTimeFromMinutes(dateKey: string, minutes: number): string {
  return `${dateKey}T${formatTime(minutes)}`;
}

export function minutesFromDateTime(value: string): number {
  return parseTime(value.slice(11, 16));
}

export function dateKeyFromDateTime(value: string): string {
  return value.slice(0, 10);
}

export function formatDateHuman(value: string | null): string {
  if (!value) return "Без срока";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: year !== new Date().getFullYear() ? "numeric" : undefined
  }).format(new Date(year, month - 1, day));
}

export function dayDifference(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T12:00:00`);
  const to = new Date(`${toKey}T12:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function greetingForTime(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 6) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

export function todayLong(date = new Date()): string {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(date);
}

export function dateHeading(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: year !== new Date().getFullYear() ? "numeric" : undefined
  }).format(new Date(year, month - 1, day));
}
