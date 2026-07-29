import { describe, expect, it } from 'vitest';
import { currentAssignmentSchedule } from '../src/recurrence.js';

describe('persistent assignment schedules', () => {
  it('creates a daily due time in the household timezone', () => {
    const schedule = currentAssignmentSchedule(
      'daily',
      '18:00',
      null,
      null,
      new Date('2026-07-01T12:00:00Z'),
      new Date('2026-07-29T12:00:00Z'),
      'America/Chicago',
    );
    expect(schedule.periodKey).toBe('D:2026-07-29');
    expect(schedule.dueAt.toISOString()).toBe('2026-07-29T23:00:00.000Z');
  });

  it('uses Monday-based weekday values for weekly schedules', () => {
    const schedule = currentAssignmentSchedule(
      'weekly',
      '10:00',
      5,
      null,
      new Date('2026-07-01T12:00:00Z'),
      new Date('2026-07-29T12:00:00Z'),
      'America/Chicago',
    );
    expect(schedule.periodKey).toBe('W:2026-07-27');
    expect(schedule.dueAt.toISOString()).toBe('2026-08-01T15:00:00.000Z');
  });

  it('moves the first due period forward when its date predates the claim', () => {
    const schedule = currentAssignmentSchedule(
      'monthly',
      '09:00',
      null,
      1,
      new Date('2026-07-15T12:00:00Z'),
      new Date('2026-07-20T12:00:00Z'),
      'America/Chicago',
    );
    expect(schedule.periodKey).toBe('M:2026-08');
    expect(schedule.dueAt.toISOString()).toBe('2026-08-01T14:00:00.000Z');
  });
});
