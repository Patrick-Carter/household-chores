import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type {
  BootstrapData,
  Chore,
  ChoreFlag,
  ChoreOccurrence,
  CompletionHeart,
  HouseholdUser,
  Recurrence,
  Room,
  WorkloadShare,
} from '@chores/shared';
import { createSession, passwordMatches, requireAdmin, requireAuth } from './auth.js';
import { loadConfig, type AppConfig } from './config.js';
import { initDb, type AppDatabase } from './db.js';
import { currentAssignmentSchedule } from './recurrence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const recurrenceValues = new Set<Recurrence>(['daily', 'weekly', 'monthly', 'as_needed']);

function cleanText(value: unknown, maxLength = 120): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function recurrenceValue(value: unknown): Recurrence | null {
  return typeof value === 'string' && recurrenceValues.has(value as Recurrence)
    ? (value as Recurrence)
    : null;
}

function users(db: AppDatabase): HouseholdUser[] {
  const rows = db.prepare(`
    SELECT id, name, active, created_at AS createdAt
    FROM users ORDER BY active DESC, name COLLATE NOCASE
  `).all() as Array<Omit<HouseholdUser, 'active'> & { active: number }>;
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
}

function rooms(db: AppDatabase): Room[] {
  const rows = db.prepare(`
    SELECT id, name, active, created_at AS createdAt
    FROM rooms ORDER BY active DESC, name COLLATE NOCASE
  `).all() as Array<Omit<Room, 'active'> & { active: number }>;
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
}

function chores(db: AppDatabase): Chore[] {
  const rows = db.prepare(`
    SELECT id, room_id AS roomId, title, estimated_minutes AS estimatedMinutes,
           recurrence, active, created_at AS createdAt
    FROM chores
    ORDER BY active DESC,
      CASE recurrence WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2
        WHEN 'monthly' THEN 3 ELSE 4 END,
      title COLLATE NOCASE
  `).all() as Array<Omit<Chore, 'active'> & { active: number }>;
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
}

function storedDate(value: string): Date {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

interface AssignmentRow {
  id: number;
  choreId: number;
  userId: number;
  recurrence: Recurrence;
  scheduleTime: string | null;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  claimedAt: string;
}

function assignmentRows(db: AppDatabase): AssignmentRow[] {
  return db.prepare(`
    SELECT a.id, a.chore_id AS choreId, a.user_id AS userId, c.recurrence,
           a.schedule_time AS scheduleTime, a.day_of_week AS dayOfWeek,
           a.day_of_month AS dayOfMonth, a.claimed_at AS claimedAt
    FROM assignments a
    JOIN chores c ON c.id = a.chore_id
    WHERE a.active = 1
  `).all() as AssignmentRow[];
}

function occurrences(db: AppDatabase, config: AppConfig): ChoreOccurrence[] {
  const completionFor = db.prepare(`
    SELECT id AS completionId, period_key AS periodKey, completed_at AS completedAt
    FROM completions WHERE assignment_id = ? AND period_key = ?
  `);
  const latestCompletion = db.prepare(`
    SELECT id AS completionId, period_key AS periodKey, completed_at AS completedAt
    FROM completions WHERE assignment_id = ? ORDER BY id DESC LIMIT 1
  `);
  const now = new Date();

  return assignmentRows(db).map((assignment): ChoreOccurrence => {
    if (assignment.recurrence === 'as_needed') {
      const completion = latestCompletion.get(assignment.id) as
        | { completionId: number; periodKey: string; completedAt: string }
        | undefined;
      return {
        ...assignment,
        completionId: completion?.completionId ?? null,
        scheduledFor: assignment.claimedAt,
        periodKey: completion?.periodKey ?? `A:pending:${assignment.id}`,
        status: 'claimed',
        completedAt: completion?.completedAt ?? null,
      };
    }

    const schedule = currentAssignmentSchedule(
      assignment.recurrence,
      assignment.scheduleTime,
      assignment.dayOfWeek,
      assignment.dayOfMonth,
      storedDate(assignment.claimedAt),
      now,
      config.householdTimezone,
    );
    const completion = completionFor.get(assignment.id, schedule.periodKey) as
      | { completionId: number; periodKey: string; completedAt: string }
      | undefined;
    return {
      ...assignment,
      completionId: completion?.completionId ?? null,
      scheduledFor: schedule.dueAt.toISOString(),
      periodKey: schedule.periodKey,
      status: completion ? 'completed' : 'claimed',
      completedAt: completion?.completedAt ?? null,
    };
  }).sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
}

function hearts(db: AppDatabase, completionIds: number[]): CompletionHeart[] {
  if (completionIds.length === 0) return [];
  return db.prepare(`
    SELECT completion_id AS completionId, giver_user_id AS giverUserId,
           created_at AS createdAt
    FROM completion_hearts
    WHERE completion_id IN (${completionIds.map(() => '?').join(', ')})
    ORDER BY created_at ASC, giver_user_id ASC
  `).all(...completionIds) as CompletionHeart[];
}

function flags(db: AppDatabase): ChoreFlag[] {
  return db.prepare(`
    SELECT id, assignment_id AS occurrenceId, period_key AS periodKey,
           reporter_user_id AS reporterUserId, comment, status, resolution,
           created_at AS createdAt, resolved_at AS resolvedAt
    FROM assignment_flags ORDER BY status ASC, created_at DESC
  `).all() as ChoreFlag[];
}

function workload(db: AppDatabase): WorkloadShare[] {
  const rows = db.prepare(`
    SELECT u.id AS userId, u.name,
           COALESCE(ROUND(SUM(CASE c.recurrence
             WHEN 'daily' THEN c.estimated_minutes * 30
             WHEN 'weekly' THEN c.estimated_minutes * 4.33
             ELSE c.estimated_minutes END)), 0) AS minutes,
           COUNT(a.id) AS choreCount
    FROM users u
    LEFT JOIN assignments a ON a.user_id = u.id AND a.active = 1
    LEFT JOIN chores c ON c.id = a.chore_id
    WHERE u.active = 1
    GROUP BY u.id, u.name
    ORDER BY u.name COLLATE NOCASE
  `).all() as Array<Omit<WorkloadShare, 'percentage'>>;
  const total = rows.reduce((sum, row) => sum + row.minutes, 0);
  return rows.map((row) => ({
    ...row,
    percentage: total === 0 ? 0 : Math.round((row.minutes / total) * 1000) / 10,
  }));
}

function bootstrap(db: AppDatabase, config: AppConfig, req: Request): BootstrapData {
  const occurrenceList = occurrences(db, config);
  const completionIds = occurrenceList.flatMap((item) => item.completionId === null ? [] : [item.completionId]);
  return {
    actor: req.actor!,
    householdTimezone: config.householdTimezone,
    users: users(db),
    rooms: rooms(db),
    chores: chores(db),
    occurrences: occurrenceList,
    hearts: hearts(db, completionIds),
    flags: flags(db),
    workload: workload(db),
  };
}

export interface CreateAppOptions {
  db?: AppDatabase;
  config?: AppConfig;
}

export function createApp(options: CreateAppOptions = {}) {
  const db = options.db ?? initDb();
  const config = options.config ?? loadConfig();
  const app = express();
  const authenticate = requireAuth(db);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.includes(origin));
    },
  }));
  app.use(express.json({ limit: '16kb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again shortly.' },
  });

  app.get('/api/auth/users', (_req, res) => {
    res.json(users(db).filter((user) => user.active).map(({ id, name }) => ({ id, name })));
  });

  app.post('/api/auth/login', authLimiter, (req, res) => {
    const { password, userId } = req.body as { password?: unknown; userId?: unknown };
    if (passwordMatches(password, config.adminPassword)) {
      const token = createSession(db, config, 'admin', null);
      res.json({ token, actor: { role: 'admin', userId: null, name: 'Administrator' } });
      return;
    }
    if (!passwordMatches(password, config.householdPassword)) {
      res.status(401).json({ error: 'Incorrect password' });
      return;
    }
    const id = positiveId(userId);
    const user = id
      ? db.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').get(id) as
          | { id: number; name: string }
          | undefined
      : undefined;
    if (!user) {
      res.status(400).json({ error: 'Choose an active household member' });
      return;
    }
    const token = createSession(db, config, 'household', user.id);
    res.json({ token, actor: { role: 'household', userId: user.id, name: user.name } });
  });

  app.delete('/api/auth/session', authenticate, (req, res) => {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(req.authTokenHash);
    res.status(204).end();
  });

  app.get('/api/bootstrap', authenticate, (req, res) => {
    res.json(bootstrap(db, config, req));
  });

  app.post('/api/occurrences', authenticate, (req, res) => {
    if (req.actor!.role !== 'household' || !req.actor!.userId) {
      res.status(403).json({ error: 'Choose a household member to claim chores' });
      return;
    }
    const choreId = positiveId(req.body?.choreId);
    const chore = db.prepare(
      'SELECT id, recurrence FROM chores WHERE id = ? AND active = 1',
    ).get(choreId) as { id: number; recurrence: Recurrence } | undefined;
    if (!chore) {
      res.status(404).json({ error: 'Chore not found' });
      return;
    }

    const scheduleTime = typeof req.body?.scheduleTime === 'string'
      && /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.scheduleTime)
      ? req.body.scheduleTime
      : null;
    const parsedDayOfWeek = Number(req.body?.dayOfWeek);
    const dayOfWeek = Number.isInteger(parsedDayOfWeek) && parsedDayOfWeek >= 0 && parsedDayOfWeek <= 6
      ? parsedDayOfWeek
      : null;
    const parsedDayOfMonth = Number(req.body?.dayOfMonth);
    const dayOfMonth = Number.isInteger(parsedDayOfMonth) && parsedDayOfMonth >= 1 && parsedDayOfMonth <= 31
      ? parsedDayOfMonth
      : null;
    if (chore.recurrence !== 'as_needed' && !scheduleTime) {
      res.status(400).json({ error: 'Choose a valid time for this chore' });
      return;
    }
    if (chore.recurrence === 'weekly' && dayOfWeek === null) {
      res.status(400).json({ error: 'Choose a day of the week' });
      return;
    }
    if (chore.recurrence === 'monthly' && dayOfMonth === null) {
      res.status(400).json({ error: 'Choose a day of the month' });
      return;
    }

    try {
      const result = db.prepare(`
        INSERT INTO assignments (
          chore_id, user_id, schedule_time, day_of_week, day_of_month, claimed_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        chore.id,
        req.actor!.userId,
        chore.recurrence === 'as_needed' ? null : scheduleTime,
        chore.recurrence === 'weekly' ? dayOfWeek : null,
        chore.recurrence === 'monthly' ? dayOfMonth : null,
        new Date().toISOString(),
      );
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'That chore is already assigned. It must be released before someone else can claim it.' });
        return;
      }
      throw error;
    }
  });

  app.delete('/api/occurrences/:id', authenticate, (req, res) => {
    const id = positiveId(req.params.id);
    const result = db.prepare(`
      UPDATE assignments SET active = 0, released_at = ?
      WHERE id = ? AND user_id = ? AND active = 1
    `).run(new Date().toISOString(), id, req.actor!.userId);
    if (!result.changes) {
      res.status(409).json({ error: 'Only the current assignee can release this chore' });
      return;
    }
    res.status(204).end();
  });

  app.post('/api/occurrences/:id/complete', authenticate, (req, res) => {
    const id = positiveId(req.params.id);
    const occurrence = occurrences(db, config).find((item) => item.id === id);
    const assignment = id ? db.prepare(`
      SELECT a.user_id AS userId, c.recurrence
      FROM assignments a JOIN chores c ON c.id = a.chore_id
      WHERE a.id = ? AND a.active = 1
    `).get(id) as { userId: number; recurrence: Recurrence } | undefined : undefined;
    if (!occurrence || !assignment || assignment.userId !== req.actor!.userId) {
      res.status(409).json({ error: 'Only the assignee can complete an active chore' });
      return;
    }
    if (assignment.recurrence !== 'as_needed' && occurrence.status === 'completed') {
      res.status(409).json({ error: 'This chore is already complete for the current period' });
      return;
    }
    const completionPeriod = assignment.recurrence === 'as_needed'
      ? `A:${randomUUID()}`
      : occurrence.periodKey;
    db.prepare(`
      INSERT INTO completions (assignment_id, period_key, completed_at) VALUES (?, ?, ?)
    `).run(id, completionPeriod, new Date().toISOString());
    res.status(204).end();
  });

  app.post('/api/completions/:id/hearts', authenticate, (req, res) => {
    if (req.actor!.role !== 'household' || !req.actor!.userId) {
      res.status(403).json({ error: 'Only household members can heart completed chores' });
      return;
    }
    const activeActor = db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(req.actor!.userId);
    if (!activeActor) {
      res.status(403).json({ error: 'Only active household members can heart completed chores' });
      return;
    }
    const id = positiveId(req.params.id);
    const occurrence = id
      ? occurrences(db, config).find((item) => item.completionId === id)
      : undefined;
    if (!occurrence) {
      res.status(404).json({ error: 'Completion not found' });
      return;
    }
    if (occurrence.userId === req.actor!.userId) {
      res.status(403).json({ error: 'Another household member must give the heart' });
      return;
    }
    try {
      db.prepare(`
        INSERT INTO completion_hearts (completion_id, giver_user_id) VALUES (?, ?)
      `).run(id, req.actor!.userId);
      res.status(201).json({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'You have already hearted this completion' });
        return;
      }
      throw error;
    }
  });

  app.delete('/api/completions/:id/hearts', authenticate, (req, res) => {
    if (req.actor!.role !== 'household' || !req.actor!.userId) {
      res.status(403).json({ error: 'Only household members can remove hearts' });
      return;
    }
    const activeActor = db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(req.actor!.userId);
    if (!activeActor) {
      res.status(403).json({ error: 'Only active household members can remove hearts' });
      return;
    }
    const id = positiveId(req.params.id);
    const occurrence = id
      ? occurrences(db, config).find((item) => item.completionId === id)
      : undefined;
    if (!occurrence) {
      res.status(404).json({ error: 'Completion not found' });
      return;
    }
    if (occurrence.userId === req.actor!.userId) {
      res.status(403).json({ error: 'Another household member must remove the heart' });
      return;
    }
    db.prepare(`
      DELETE FROM completion_hearts WHERE completion_id = ? AND giver_user_id = ?
    `).run(id, req.actor!.userId);
    res.status(204).end();
  });

  app.post('/api/occurrences/:id/flags', authenticate, (req, res) => {
    if (req.actor!.role !== 'household' || !req.actor!.userId) {
      res.status(403).json({ error: 'Only household members can flag chores' });
      return;
    }
    const id = positiveId(req.params.id);
    const comment = cleanText(req.body?.comment, 500);
    if (!id || !comment) {
      res.status(400).json({ error: 'A reason for the flag is required' });
      return;
    }
    const occurrence = occurrences(db, config).find((item) => item.id === id);
    if (!occurrence) {
      res.status(404).json({ error: 'Claimed chore not found' });
      return;
    }
    if (occurrence.userId === req.actor!.userId) {
      res.status(403).json({ error: 'Another household member must raise the flag' });
      return;
    }
    const recurrence = db.prepare(`
      SELECT c.recurrence FROM assignments a JOIN chores c ON c.id = a.chore_id WHERE a.id = ?
    `).get(id) as { recurrence: Recurrence } | undefined;
    const canFlagAsNeeded = recurrence?.recurrence === 'as_needed' && Boolean(occurrence.completedAt);
    if (!canFlagAsNeeded && occurrence.status !== 'completed' && Date.parse(occurrence.scheduledFor) >= Date.now()) {
      res.status(409).json({ error: 'A chore can be flagged after completion or once it is overdue' });
      return;
    }
    try {
      db.prepare(`
        INSERT INTO assignment_flags (assignment_id, period_key, reporter_user_id, comment)
        VALUES (?, ?, ?, ?)
      `).run(id, occurrence.periodKey, req.actor!.userId, comment);
      res.status(201).json({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'You have already flagged this chore' });
        return;
      }
      throw error;
    }
  });

  app.post('/api/admin/users', authenticate, requireAdmin, (req, res) => {
    const name = cleanText(req.body?.name, 40);
    if (!name) {
      res.status(400).json({ error: 'Enter a name up to 40 characters' });
      return;
    }
    try {
      const result = db.prepare('INSERT INTO users (name) VALUES (?)').run(name);
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'A user with that name already exists' });
    }
  });

  app.delete('/api/admin/assignments/:id', authenticate, requireAdmin, (req, res) => {
    const id = positiveId(req.params.id);
    const result = db.prepare(`
      UPDATE assignments SET active = 0, released_at = ? WHERE id = ? AND active = 1
    `).run(new Date().toISOString(), id);
    if (!result.changes) return void res.status(404).json({ error: 'Active assignment not found' });
    res.status(204).end();
  });

  app.patch('/api/admin/users/:id', authenticate, requireAdmin, (req, res) => {
    const id = positiveId(req.params.id);
    const active = booleanValue(req.body?.active);
    const name = req.body?.name === undefined ? undefined : cleanText(req.body.name, 40);
    if (!id || (active === null && name === undefined) || name === null) {
      res.status(400).json({ error: 'Provide a valid name or active state' });
      return;
    }
    try {
      const result = name !== undefined && active !== null
        ? db.prepare('UPDATE users SET name = ?, active = ? WHERE id = ?').run(name, Number(active), id)
        : name !== undefined
          ? db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id)
          : db.prepare('UPDATE users SET active = ? WHERE id = ?').run(Number(active), id);
      if (!result.changes) return void res.status(404).json({ error: 'User not found' });
      res.status(204).end();
    } catch {
      res.status(409).json({ error: 'A user with that name already exists' });
    }
  });

  app.post('/api/admin/rooms', authenticate, requireAdmin, (req, res) => {
    const name = cleanText(req.body?.name, 60);
    if (!name) return void res.status(400).json({ error: 'Enter a room name' });
    try {
      const result = db.prepare('INSERT INTO rooms (name) VALUES (?)').run(name);
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch {
      res.status(409).json({ error: 'A room with that name already exists' });
    }
  });

  app.patch('/api/admin/rooms/:id', authenticate, requireAdmin, (req, res) => {
    const id = positiveId(req.params.id);
    const active = booleanValue(req.body?.active);
    const name = req.body?.name === undefined ? undefined : cleanText(req.body.name, 60);
    if (!id || (active === null && name === undefined) || name === null) {
      return void res.status(400).json({ error: 'Provide a valid room name or active state' });
    }
    try {
      const result = name !== undefined && active !== null
        ? db.prepare('UPDATE rooms SET name = ?, active = ? WHERE id = ?').run(name, Number(active), id)
        : name !== undefined
          ? db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(name, id)
          : db.prepare('UPDATE rooms SET active = ? WHERE id = ?').run(Number(active), id);
      if (!result.changes) return void res.status(404).json({ error: 'Room not found' });
      res.status(204).end();
    } catch {
      res.status(409).json({ error: 'A room with that name already exists' });
    }
  });

  app.post('/api/admin/chores', authenticate, requireAdmin, (req, res) => {
    const roomId = positiveId(req.body?.roomId);
    const title = cleanText(req.body?.title, 120);
    const minutes = positiveId(req.body?.estimatedMinutes);
    const recurrence = recurrenceValue(req.body?.recurrence);
    if (!roomId || !title || !minutes || minutes > 1440 || !recurrence) {
      return void res.status(400).json({ error: 'Room, title, recurrence, and valid minutes are required' });
    }
    const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
    if (!room) return void res.status(404).json({ error: 'Room not found' });
    const result = db.prepare(`
      INSERT INTO chores (room_id, title, estimated_minutes, recurrence) VALUES (?, ?, ?, ?)
    `).run(roomId, title, minutes, recurrence);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  app.patch('/api/admin/chores/:id', authenticate, requireAdmin, (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return void res.status(400).json({ error: 'Invalid chore' });
    const existing = db.prepare('SELECT * FROM chores WHERE id = ?').get(id) as
      | { room_id: number; title: string; estimated_minutes: number; recurrence: Recurrence; active: number }
      | undefined;
    if (!existing) return void res.status(404).json({ error: 'Chore not found' });

    const roomId = req.body?.roomId === undefined ? existing.room_id : positiveId(req.body.roomId);
    const title = req.body?.title === undefined ? existing.title : cleanText(req.body.title, 120);
    const minutes = req.body?.estimatedMinutes === undefined
      ? existing.estimated_minutes
      : positiveId(req.body.estimatedMinutes);
    const recurrence = req.body?.recurrence === undefined
      ? existing.recurrence
      : recurrenceValue(req.body.recurrence);
    const active = req.body?.active === undefined ? Boolean(existing.active) : booleanValue(req.body.active);
    if (!roomId || !title || !minutes || minutes > 1440 || !recurrence || active === null) {
      return void res.status(400).json({ error: 'Invalid chore details' });
    }
    if (!db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId)) {
      return void res.status(404).json({ error: 'Room not found' });
    }
    db.prepare(`
      UPDATE chores SET room_id = ?, title = ?, estimated_minutes = ?, recurrence = ?, active = ?
      WHERE id = ?
    `).run(roomId, title, minutes, recurrence, Number(active), id);
    res.status(204).end();
  });

  app.patch('/api/admin/flags/:id', authenticate, requireAdmin, (req, res) => {
    const id = positiveId(req.params.id);
    const resolution = cleanText(req.body?.resolution, 500);
    const reopen = req.body?.reopen === true;
    if (!id || !resolution) {
      return void res.status(400).json({ error: 'A resolution note is required' });
    }
    const flag = db.prepare(`
      SELECT assignment_id AS assignmentId, period_key AS periodKey
      FROM assignment_flags WHERE id = ? AND status = 'open'
    `).get(id) as { assignmentId: number; periodKey: string } | undefined;
    if (!flag) return void res.status(404).json({ error: 'Open flag not found' });

    db.transaction(() => {
      db.prepare(`
        UPDATE assignment_flags SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?
      `).run(resolution, new Date().toISOString(), id);
      if (reopen) {
        db.prepare(`
          DELETE FROM completions WHERE assignment_id = ? AND period_key = ?
        `).run(flag.assignmentId, flag.periodKey);
      }
    })();
    res.status(204).end();
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/healthz).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  // Express recognizes this signature as the final error boundary.
  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({ error: 'Unexpected server error' });
  });

  return app;
}
