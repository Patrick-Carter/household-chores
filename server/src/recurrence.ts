import { randomUUID } from 'node:crypto';
import type { Recurrence } from '@chores/shared';

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface AssignmentSchedule {
  periodKey: string;
  dueAt: Date;
}

function partsFor(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function ymd(parts: Pick<DateParts, 'year' | 'month' | 'day'>): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function localToUtc(parts: DateParts, timeZone: string): Date {
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let guess = wanted;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsFor(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    guess += wanted - actualAsUtc;
  }
  return new Date(guess);
}

function utcDateParts(date: Date): DateParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
  };
}

function addLocalDays(parts: DateParts, days: number): DateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { ...utcDateParts(date), hour: parts.hour, minute: parts.minute };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function scheduleForPeriod(
  recurrence: Recurrence,
  scheduleTime: string | null,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  now: Date,
  timeZone: string,
  periodOffset = 0,
): AssignmentSchedule {
  const nowParts = partsFor(now, timeZone);
  const [hour, minute] = (scheduleTime ?? '00:00').split(':').map(Number);

  if (recurrence === 'daily') {
    const dueParts = addLocalDays({ ...nowParts, hour, minute }, periodOffset);
    return { periodKey: `D:${ymd(dueParts)}`, dueAt: localToUtc(dueParts, timeZone) };
  }

  if (recurrence === 'weekly') {
    const localAsUtc = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
    const daysSinceMonday = (localAsUtc.getUTCDay() + 6) % 7;
    const target = addLocalDays(
      { ...nowParts, hour, minute },
      -daysSinceMonday + (dayOfWeek ?? 0) + periodOffset * 7,
    );
    const monday = addLocalDays(target, -(dayOfWeek ?? 0));
    return { periodKey: `W:${ymd(monday)}`, dueAt: localToUtc(target, timeZone) };
  }

  if (recurrence === 'monthly') {
    const base = new Date(Date.UTC(nowParts.year, nowParts.month - 1 + periodOffset, 1));
    const year = base.getUTCFullYear();
    const month = base.getUTCMonth() + 1;
    const day = Math.min(dayOfMonth ?? 1, daysInMonth(year, month));
    const dueParts = { year, month, day, hour, minute };
    return {
      periodKey: `M:${year}-${String(month).padStart(2, '0')}`,
      dueAt: localToUtc(dueParts, timeZone),
    };
  }

  return { periodKey: `A:${randomUUID()}`, dueAt: now };
}

export function currentAssignmentSchedule(
  recurrence: Recurrence,
  scheduleTime: string | null,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  claimedAt: Date,
  now: Date,
  timeZone: string,
): AssignmentSchedule {
  const current = scheduleForPeriod(
    recurrence,
    scheduleTime,
    dayOfWeek,
    dayOfMonth,
    now,
    timeZone,
  );
  if (recurrence !== 'as_needed' && current.dueAt.getTime() < claimedAt.getTime()) {
    return scheduleForPeriod(
      recurrence,
      scheduleTime,
      dayOfWeek,
      dayOfMonth,
      now,
      timeZone,
      1,
    );
  }
  return current;
}
