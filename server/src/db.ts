import Database from 'better-sqlite3';

export type AppDatabase = Database.Database;

const seedRooms = [
  'Living room',
  'Kitchen',
  'Dining room',
  'Master bedroom',
  'Master bathroom',
  'Guest bathroom',
  'Outdoors',
] as const;

const seedChores = [
  ['Living room', 'Clear couches, fix pillows and blankets', 10, 'daily'],
  ['Living room', 'Clear coffee table and rug', 10, 'daily'],
  ['Living room', 'Clear chimney clutter', 5, 'daily'],
  ['Kitchen', 'Clear counter clutter', 10, 'daily'],
  ['Kitchen', 'Wipe down counters', 10, 'daily'],
  ['Dining room', 'Clear table clutter', 5, 'daily'],
  ['Dining room', 'Wipe down table', 10, 'daily'],
  ['Master bedroom', 'Clear night stands', 5, 'daily'],
  ['Master bedroom', 'Clear bed sides', 5, 'daily'],
  ['Master bedroom', 'Pick up loose clothes', 10, 'daily'],
  ['Master bathroom', 'Clear counter clutter', 5, 'daily'],
  ['Master bathroom', 'Wipe down counter', 10, 'daily'],
  ['Master bathroom', 'Pick up extra clothes', 5, 'daily'],
  ['Kitchen', 'Take out kitchen trash', 10, 'as_needed'],
  ['Master bathroom', 'Take out master bathroom trash', 5, 'as_needed'],
  ['Guest bathroom', 'Take out guest bathroom trash', 5, 'as_needed'],
  ['Kitchen', 'Clean out refrigerator', 30, 'weekly'],
  ['Kitchen', 'Clean out pantry', 20, 'weekly'],
  ['Kitchen', 'Clean out freezer', 30, 'weekly'],
  ['Outdoors', 'Take trash to curb', 15, 'weekly'],
  ['Outdoors', 'Return trash cans to house', 10, 'weekly'],
  ['Master bathroom', 'Scrub shower', 30, 'weekly'],
  ['Master bathroom', 'Clean shower', 45, 'monthly'],
  ['Master bathroom', 'Clean master toilet', 20, 'monthly'],
  ['Guest bathroom', 'Clean guest toilet', 20, 'monthly'],
  ['Outdoors', 'Spray bug spray and remove wasp nests', 45, 'monthly'],
] as const;

export function initDb(path = ':memory:'): AppDatabase {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  if (path !== ':memory:') db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      title TEXT NOT NULL,
      estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes BETWEEN 1 AND 1440),
      recurrence TEXT NOT NULL CHECK (recurrence IN ('daily', 'weekly', 'monthly', 'as_needed')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chore_id INTEGER NOT NULL REFERENCES chores(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      scheduled_for TEXT NOT NULL,
      period_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'completed')),
      claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      UNIQUE(chore_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurrence_id INTEGER NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
      reporter_user_id INTEGER NOT NULL REFERENCES users(id),
      comment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      resolution TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      UNIQUE(occurrence_id, reporter_user_id)
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('household', 'admin')),
      user_id INTEGER REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_occurrences_schedule ON occurrences(scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_occurrences_user ON occurrences(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status);
    CREATE INDEX IF NOT EXISTS idx_auth_expiry ON auth_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chore_id INTEGER NOT NULL REFERENCES chores(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      schedule_time TEXT,
      day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
      day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      released_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_assignment
      ON assignments(chore_id) WHERE active = 1;
    CREATE INDEX IF NOT EXISTS idx_assignments_user ON assignments(user_id, active);

    CREATE TABLE IF NOT EXISTS completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL REFERENCES assignments(id),
      period_key TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(assignment_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS assignment_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL REFERENCES assignments(id),
      period_key TEXT NOT NULL,
      reporter_user_id INTEGER NOT NULL REFERENCES users(id),
      comment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      resolution TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      UNIQUE(assignment_id, period_key, reporter_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_assignment_flags_status ON assignment_flags(status);
  `);

  seed(db);
  migrateOccurrences(db);
  return db;
}

function seed(db: AppDatabase): void {
  const userCount = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
  if (userCount === 0) {
    const insert = db.prepare('INSERT INTO users (name) VALUES (?)');
    const transaction = db.transaction(() => {
      for (const name of ['Patrick', 'Nelly', 'Nancy']) insert.run(name);
    });
    transaction();
  }

  const roomCount = (db.prepare('SELECT COUNT(*) AS count FROM rooms').get() as { count: number }).count;
  if (roomCount === 0) {
    const insertRoom = db.prepare('INSERT INTO rooms (name) VALUES (?)');
    const insertChore = db.prepare(
      'INSERT INTO chores (room_id, title, estimated_minutes, recurrence) VALUES (?, ?, ?, ?)',
    );
    const transaction = db.transaction(() => {
      const roomIds = new Map<string, number>();
      for (const name of seedRooms) {
        roomIds.set(name, Number(insertRoom.run(name).lastInsertRowid));
      }
      for (const [room, title, minutes, recurrence] of seedChores) {
        insertChore.run(roomIds.get(room), title, minutes, recurrence);
      }
    });
    transaction();
  }
}

function migrateOccurrences(db: AppDatabase): void {
  const assignmentCount = (db.prepare('SELECT COUNT(*) AS count FROM assignments').get() as { count: number }).count;
  if (assignmentCount > 0) return;
  const legacyCount = (db.prepare('SELECT COUNT(*) AS count FROM occurrences').get() as { count: number }).count;
  if (legacyCount === 0) return;

  db.transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO assignments (
        chore_id, user_id, schedule_time, day_of_week, day_of_month, active, claimed_at
      )
      SELECT o.chore_id, o.user_id,
        CASE WHEN c.recurrence = 'as_needed' THEN NULL ELSE substr(o.scheduled_for, 12, 5) END,
        CASE WHEN c.recurrence = 'weekly' THEN (CAST(strftime('%w', o.scheduled_for) AS INTEGER) + 6) % 7 ELSE NULL END,
        CASE WHEN c.recurrence = 'monthly' THEN CAST(strftime('%d', o.scheduled_for) AS INTEGER) ELSE NULL END,
        1, o.claimed_at
      FROM occurrences o
      JOIN chores c ON c.id = o.chore_id
      WHERE o.id = (SELECT MIN(first_o.id) FROM occurrences first_o WHERE first_o.chore_id = o.chore_id)
        AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.chore_id = o.chore_id AND a.active = 1);

      INSERT OR IGNORE INTO completions (assignment_id, period_key, completed_at)
      SELECT a.id, o.period_key, COALESCE(o.completed_at, CURRENT_TIMESTAMP)
      FROM occurrences o
      JOIN assignments a ON a.chore_id = o.chore_id AND a.active = 1
      WHERE o.status = 'completed';

      INSERT OR IGNORE INTO assignment_flags (
        assignment_id, period_key, reporter_user_id, comment, status, resolution, created_at, resolved_at
      )
      SELECT a.id, o.period_key, f.reporter_user_id, f.comment, f.status,
        f.resolution, f.created_at, f.resolved_at
      FROM flags f
      JOIN occurrences o ON o.id = f.occurrence_id
      JOIN assignments a ON a.chore_id = o.chore_id AND a.active = 1;
    `);
  })();
}
