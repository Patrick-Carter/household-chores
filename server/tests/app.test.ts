import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { initDb, type AppDatabase } from '../src/db.js';

const config: AppConfig = {
  householdPassword: 'carterhub',
  adminPassword: 'adminhub',
  householdTimezone: 'America/Chicago',
  sessionDays: 30,
};

describe('chores API', () => {
  let db: AppDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = initDb();
    app = createApp({ db, config });
  });

  afterEach(() => db.close());

  async function login(password: string, userId?: number): Promise<string> {
    const response = await request(app).post('/api/auth/login').send({ password, userId });
    expect(response.status).toBe(200);
    return response.body.token as string;
  }

  it('authenticates household members and administrators separately', async () => {
    const household = await request(app)
      .post('/api/auth/login')
      .send({ password: 'carterhub', userId: 1 });
    expect(household.body.actor).toMatchObject({ role: 'household', name: 'Patrick' });

    const admin = await request(app).post('/api/auth/login').send({ password: 'adminhub' });
    expect(admin.body.actor).toMatchObject({ role: 'admin', userId: null });

    const denied = await request(app).post('/api/auth/login').send({ password: 'wrong', userId: 1 });
    expect(denied.status).toBe(401);
  });

  it('keeps a chore assigned until it is explicitly released', async () => {
    const patrick = await login('carterhub', 1);
    const first = await request(app)
      .post('/api/occurrences')
      .set('Authorization', `Bearer ${patrick}`)
      .send({ choreId: 1, scheduleTime: '18:00' });
    expect(first.status).toBe(201);

    const nelly = await login('carterhub', 2);
    const duplicate = await request(app)
      .post('/api/occurrences')
      .set('Authorization', `Bearer ${nelly}`)
      .send({ choreId: 1, scheduleTime: '19:00' });
    expect(duplicate.status).toBe(409);

    await request(app)
      .post(`/api/occurrences/${first.body.id}/complete`)
      .set('Authorization', `Bearer ${patrick}`)
      .expect(204);
    const afterCompletion = await request(app)
      .get('/api/bootstrap')
      .set('Authorization', `Bearer ${patrick}`);
    expect(afterCompletion.body.occurrences).toHaveLength(1);
    expect(afterCompletion.body.occurrences[0]).toMatchObject({
      choreId: 1,
      userId: 1,
      status: 'completed',
      scheduleTime: '18:00',
    });

    await request(app)
      .delete(`/api/occurrences/${first.body.id}`)
      .set('Authorization', `Bearer ${patrick}`)
      .expect(204);
    await request(app)
      .post('/api/occurrences')
      .set('Authorization', `Bearer ${nelly}`)
      .send({ choreId: 1, scheduleTime: '19:00' })
      .expect(201);
  });

  it('allows another user to flag completed work and an admin to resolve it', async () => {
    const patrick = await login('carterhub', 1);
    const claim = await request(app)
      .post('/api/occurrences')
      .set('Authorization', `Bearer ${patrick}`)
      .send({ choreId: 14 });
    await request(app)
      .post(`/api/occurrences/${claim.body.id}/complete`)
      .set('Authorization', `Bearer ${patrick}`)
      .expect(204);

    const ownFlag = await request(app)
      .post(`/api/occurrences/${claim.body.id}/flags`)
      .set('Authorization', `Bearer ${patrick}`)
      .send({ comment: 'Not done' });
    expect(ownFlag.status).toBe(403);

    const nelly = await login('carterhub', 2);
    await request(app)
      .post(`/api/occurrences/${claim.body.id}/flags`)
      .set('Authorization', `Bearer ${nelly}`)
      .send({ comment: 'The trash bag was left by the door.' })
      .expect(201);

    const admin = await login('adminhub');
    await request(app)
      .patch('/api/admin/flags/1')
      .set('Authorization', `Bearer ${admin}`)
      .send({ resolution: 'Patrick will finish it.', reopen: true })
      .expect(204);

    const completionCount = db.prepare(
      'SELECT COUNT(*) AS count FROM completions WHERE assignment_id = ?',
    ).get(claim.body.id) as { count: number };
    expect(completionCount.count).toBe(0);
  });

  it('requires cadence-specific schedules and lets an admin remove an assignment', async () => {
    const patrick = await login('carterhub', 1);
    await request(app)
      .post('/api/occurrences')
      .set('Authorization', `Bearer ${patrick}`)
      .send({ choreId: 17, scheduleTime: '10:30', dayOfWeek: 5 })
      .expect(201);

    const invalidMonthly = await request(app)
      .post('/api/occurrences')
      .set('Authorization', `Bearer ${patrick}`)
      .send({ choreId: 23, scheduleTime: '09:00' });
    expect(invalidMonthly.status).toBe(400);

    const admin = await login('adminhub');
    await request(app)
      .delete('/api/admin/assignments/1')
      .set('Authorization', `Bearer ${admin}`)
      .expect(204);
    const active = db.prepare('SELECT active FROM assignments WHERE id = 1').get() as { active: number };
    expect(active.active).toBe(0);
  });
});
