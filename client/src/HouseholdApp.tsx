import { useState, type FormEvent } from 'react';
import {
  RECURRENCE_LABELS,
  type BootstrapData,
  type Chore,
  type ChoreOccurrence,
  type Recurrence,
} from '@chores/shared';
import { Header } from './components/Header';
import { Modal } from './components/Modal';
import { mutate } from './lib/api';
import { formatDateTime, formatMinutes, initials } from './lib/format';

interface HouseholdAppProps {
  data: BootstrapData;
  refresh: () => Promise<void>;
  logout: () => void;
}

type View = 'board' | 'mine' | 'household';
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function HouseholdApp({ data, refresh, logout }: HouseholdAppProps) {
  const [view, setView] = useState<View>('board');
  const [recurrence, setRecurrence] = useState<Recurrence>('daily');
  const [claimChore, setClaimChore] = useState<Chore | null>(null);
  const [flagOccurrence, setFlagOccurrence] = useState<ChoreOccurrence | null>(null);
  const [scheduleTime, setScheduleTime] = useState('18:00');
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [flagComment, setFlagComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [completedAsNeeded, setCompletedAsNeeded] = useState<Set<number>>(() => new Set());

  const actorId = data.actor.userId!;
  const userById = new Map(data.users.map((user) => [user.id, user]));
  const roomById = new Map(data.rooms.map((room) => [room.id, room]));
  const choreById = new Map(data.chores.map((chore) => [chore.id, chore]));
  const occurrences = data.occurrences.map((item): ChoreOccurrence => completedAsNeeded.has(item.id)
    ? { ...item, status: 'completed' }
    : item);
  const openFlags = data.flags.filter((flag) => flag.status === 'open');
  const myOpen = occurrences.filter((item) => item.userId === actorId);
  const myMinutes = data.workload.find((item) => item.userId === actorId)?.minutes ?? 0;
  const completedThisWeek = occurrences.filter((item) =>
    item.userId === actorId && item.completedAt && Date.parse(item.completedAt) > Date.now() - 7 * 86_400_000,
  ).length;

  function changeView(nextView: View) {
    if (nextView !== view) setCompletedAsNeeded(new Set());
    setView(nextView);
  }

  function openClaim(chore: Chore) {
    const now = new Date();
    setScheduleTime('18:00');
    setDayOfWeek((now.getDay() + 6) % 7);
    setDayOfMonth(now.getDate());
    setError('');
    setClaimChore(chore);
  }

  async function submitClaim(event: FormEvent) {
    event.preventDefault();
    if (!claimChore) return;
    setBusy(true);
    setError('');
    try {
      await mutate('/api/occurrences', 'POST', {
        choreId: claimChore.id,
        scheduleTime: claimChore.recurrence === 'as_needed' ? undefined : scheduleTime,
        dayOfWeek: claimChore.recurrence === 'weekly' ? dayOfWeek : undefined,
        dayOfMonth: claimChore.recurrence === 'monthly' ? dayOfMonth : undefined,
      });
      setClaimChore(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to claim chore');
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string, method: 'POST' | 'DELETE', body?: unknown) {
    setBusy(true);
    setError('');
    try {
      await mutate(path, method, body);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update chore');
    } finally {
      setBusy(false);
    }
  }

  async function complete(item: ChoreOccurrence) {
    setBusy(true);
    setError('');
    try {
      await mutate(`/api/occurrences/${item.id}/complete`, 'POST');
      await refresh();
      if (choreById.get(item.choreId)?.recurrence === 'as_needed') {
        setCompletedAsNeeded((current) => new Set(current).add(item.id));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update chore');
    } finally {
      setBusy(false);
    }
  }

  function heartsFor(item: ChoreOccurrence) {
    return item.completionId === null
      ? []
      : data.hearts.filter((heart) => heart.completionId === item.completionId);
  }

  function heartNames(item: ChoreOccurrence): string[] {
    return heartsFor(item).map((heart) => userById.get(heart.giverUserId)?.name ?? 'Unknown');
  }

  function hasMyHeart(item: ChoreOccurrence): boolean {
    return heartsFor(item).some((heart) => heart.giverUserId === actorId);
  }

  async function submitFlag(event: FormEvent) {
    event.preventDefault();
    if (!flagOccurrence) return;
    setBusy(true);
    setError('');
    try {
      await mutate(`/api/occurrences/${flagOccurrence.id}/flags`, 'POST', { comment: flagComment });
      setFlagOccurrence(null);
      setFlagComment('');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to flag chore');
    } finally {
      setBusy(false);
    }
  }

  function canFlag(item: ChoreOccurrence): boolean {
    return item.userId !== actorId
      && (item.status === 'completed' || Date.parse(item.scheduledFor) < Date.now())
      && !data.flags.some((flag) =>
        flag.occurrenceId === item.id
        && flag.periodKey === item.periodKey
        && flag.reporterUserId === actorId,
      );
  }

  const filteredChores = data.chores.filter((chore) => chore.active && chore.recurrence === recurrence);
  const activeRooms = data.rooms.filter((room) => room.active && filteredChores.some((chore) => chore.roomId === room.id));
  const mySchedule = occurrences
    .filter((item) => item.userId === actorId)
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
  const householdSchedule = [...occurrences]
    .sort((a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor));

  return (
    <div className="app-shell">
      <Header name={data.actor.name} onLogout={logout} />
      <main className="page-wrap">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">Today’s household</p>
            <h2>Welcome back, {data.actor.name}.</h2>
            <p className="muted">Choose a task and put a real time against it.</p>
          </div>
          <div className="date-stamp">
            <span>{new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: data.householdTimezone }).format(new Date())}</span>
            <strong>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: data.householdTimezone }).format(new Date())}</strong>
          </div>
        </section>

        <section className="summary-grid" aria-label="Your summary">
          <article className="summary-card ink">
            <p>Estimated monthly load</p>
            <strong>{formatMinutes(myMinutes)}</strong>
            <span>{myOpen.length} persistent {myOpen.length === 1 ? 'assignment' : 'assignments'}</span>
          </article>
          <article className="summary-card green">
            <p>Finished this week</p>
            <strong>{completedThisWeek}</strong>
            <span>completed by you</span>
          </article>
          <article className="summary-card rust">
            <p>Needs attention</p>
            <strong>{openFlags.length}</strong>
            <span>open household {openFlags.length === 1 ? 'flag' : 'flags'}</span>
          </article>
        </section>

        {error && !claimChore && !flagOccurrence && <div className="notice error-notice" role="alert">{error}</div>}

        <nav className="section-nav" aria-label="Chore views">
          <button className={view === 'board' ? 'active' : ''} onClick={() => changeView('board')}>Chore board</button>
          <button className={view === 'mine' ? 'active' : ''} onClick={() => changeView('mine')}>My commitments <span>{myOpen.length}</span></button>
          <button className={view === 'household' ? 'active' : ''} onClick={() => changeView('household')}>Household log</button>
        </nav>

        {view === 'board' && (
          <section>
            <div className="section-heading">
              <div><p className="eyebrow">Available work</p><h2>Choose your part</h2></div>
              <p>Each task stays with one person until they or an administrator releases it.</p>
            </div>
            <div className="filter-pills">
              {(Object.keys(RECURRENCE_LABELS) as Recurrence[]).map((item) => (
                <button key={item} className={recurrence === item ? 'active' : ''} onClick={() => setRecurrence(item)}>
                  {RECURRENCE_LABELS[item]}
                  <span>{data.chores.filter((chore) => chore.active && chore.recurrence === item).length}</span>
                </button>
              ))}
            </div>
            <div className="room-sections">
              {activeRooms.map((room) => (
                <section className="room-section" key={room.id}>
                  <header><h3>{room.name}</h3><span>{filteredChores.filter((chore) => chore.roomId === room.id).length} tasks</span></header>
                  <div className="chore-grid">
                    {filteredChores.filter((chore) => chore.roomId === room.id).map((chore) => {
                      const claims = occurrences
                        .filter((item) => item.choreId === chore.id)
                        .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
                      const nextClaim = claims[0];
                      return (
                        <article className="chore-card" key={chore.id}>
                          <div className="chore-card-top">
                            <span className="time-chip">{formatMinutes(chore.estimatedMinutes)}</span>
                            {nextClaim && <span className={nextClaim.status === 'completed'
                              ? 'status completed'
                              : chore.recurrence !== 'as_needed' && Date.parse(nextClaim.scheduledFor) < Date.now()
                                ? 'status overdue'
                                : 'status claimed'}>
                              {nextClaim.status === 'completed'
                                ? 'Complete'
                                : chore.recurrence !== 'as_needed' && Date.parse(nextClaim.scheduledFor) < Date.now()
                                  ? 'Overdue'
                                  : 'Assigned'}
                            </span>}
                          </div>
                          <h4>{chore.title}</h4>
                          {nextClaim ? (
                            <div className="claim-line">
                              <span className="avatar small">{initials(userById.get(nextClaim.userId)?.name ?? '?')}</span>
                              <p><strong>{userById.get(nextClaim.userId)?.name}</strong><br />{scheduleLabel(chore, nextClaim)}</p>
                            </div>
                          ) : <p className="unclaimed">No current claim</p>}
                          <button className="outline-button full" disabled={Boolean(nextClaim)} onClick={() => openClaim(chore)}>
                            {nextClaim ? 'Assigned until released' : 'Claim this chore'}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>
        )}

        {view === 'mine' && (
          <section>
            <div className="section-heading">
              <div><p className="eyebrow">Personal schedule</p><h2>Your commitments</h2></div>
              <p>Completion resets each period. Releasing gives up the assignment entirely.</p>
            </div>
            {mySchedule.length === 0 ? <EmptyState text="You have not claimed a chore yet." /> : (
              <div className="schedule-list">
                {mySchedule.map((item) => (
                  <ScheduleRow
                    key={item.id}
                    item={item}
                    chore={choreById.get(item.choreId)}
                    roomName={roomById.get(choreById.get(item.choreId)?.roomId ?? 0)?.name}
                    userName={data.actor.name}
                    timezone={data.householdTimezone}
                    flags={data.flags.filter((flag) => flag.occurrenceId === item.id).length}
                    heartNames={heartNames(item)}
                    actions={(
                      <div className="row-actions">
                        {item.status === 'claimed' && (
                          <button className="small-button primary" disabled={busy} onClick={() => complete(item)}>Mark complete</button>
                        )}
                        <button className="small-button" disabled={busy} onClick={() => action(`/api/occurrences/${item.id}`, 'DELETE')}>Release</button>
                      </div>
                    )}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {view === 'household' && (
          <section>
            <div className="section-heading">
              <div><p className="eyebrow">Shared record</p><h2>Household log</h2></div>
              <p>Heart completed work to show appreciation, or flag work that needs attention.</p>
            </div>
            {householdSchedule.length === 0 ? <EmptyState text="No one has claimed a chore yet." /> : (
              <div className="schedule-list">
                {householdSchedule.map((item) => {
                  const hearted = hasMyHeart(item);
                  const canHeart = item.completionId !== null && item.userId !== actorId;
                  const flaggable = canFlag(item);
                  return (
                    <ScheduleRow
                      key={item.id}
                      item={item}
                      chore={choreById.get(item.choreId)}
                      roomName={roomById.get(choreById.get(item.choreId)?.roomId ?? 0)?.name}
                      userName={userById.get(item.userId)?.name ?? 'Unknown'}
                      timezone={data.householdTimezone}
                      flags={data.flags.filter((flag) => flag.occurrenceId === item.id).length}
                      heartNames={heartNames(item)}
                      actions={canHeart || flaggable ? (
                        <div className="row-actions">
                          {canHeart && (
                            <button
                              className={`small-button heart${hearted ? ' active' : ''}`}
                              disabled={busy}
                              aria-pressed={hearted}
                              onClick={() => action(`/api/completions/${item.completionId}/hearts`, hearted ? 'DELETE' : 'POST')}
                            >
                              {hearted ? '♥ Hearted' : '♡ Heart'}
                            </button>
                          )}
                          {flaggable && (
                            <button className="small-button flag" onClick={() => { setFlagOccurrence(item); setError(''); }}>Flag chore</button>
                          )}
                        </div>
                      ) : undefined}
                    />
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {claimChore && (
        <Modal title={claimChore.title} eyebrow={`${roomById.get(claimChore.roomId)?.name} · ${formatMinutes(claimChore.estimatedMinutes)}`} onClose={() => setClaimChore(null)}>
          <p className="modal-intro">This chore will remain yours every period until you or an administrator releases it.</p>
          <form className="stack-form" onSubmit={submitClaim}>
            {claimChore.recurrence === 'weekly' && (
              <label>Day of week<select value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))} autoFocus>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
            )}
            {claimChore.recurrence === 'monthly' && (
              <label>Day of month<input type="number" min={1} max={31} value={dayOfMonth} onChange={(event) => setDayOfMonth(Number(event.target.value))} required autoFocus /></label>
            )}
            {claimChore.recurrence !== 'as_needed' && (
              <label>Time<input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} required autoFocus={claimChore.recurrence === 'daily'} /></label>
            )}
            {claimChore.recurrence === 'as_needed' && <p className="quiet-note">As-needed chores have no fixed due time and can be marked complete repeatedly.</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button full" disabled={busy}>{busy ? 'Claiming…' : 'Claim until released'}</button>
          </form>
        </Modal>
      )}

      {flagOccurrence && (
        <Modal title="Flag this chore" eyebrow="Needs attention" onClose={() => setFlagOccurrence(null)}>
          <p className="modal-intro"><strong>{choreById.get(flagOccurrence.choreId)?.title}</strong> was assigned to {userById.get(flagOccurrence.userId)?.name}. Explain what was late or incomplete.</p>
          <form className="stack-form" onSubmit={submitFlag}>
            <label>Reason<textarea rows={4} maxLength={500} value={flagComment} onChange={(event) => setFlagComment(event.target.value)} required autoFocus /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="danger-button full" disabled={busy}>{busy ? 'Sending…' : 'Submit flag for review'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

interface ScheduleRowProps {
  item: ChoreOccurrence;
  chore?: Chore;
  roomName?: string;
  userName: string;
  timezone: string;
  flags: number;
  heartNames: string[];
  actions?: React.ReactNode;
}

function ScheduleRow({ item, chore, roomName, userName, timezone, flags, heartNames, actions }: ScheduleRowProps) {
  const asNeeded = chore?.recurrence === 'as_needed';
  const overdue = !asNeeded && item.status === 'claimed' && Date.parse(item.scheduledFor) < Date.now();
  return (
    <article className="schedule-row">
      <div className="schedule-date">
        {asNeeded ? <><strong>AS</strong><span>needed</span></> : <>
          <strong>{new Intl.DateTimeFormat('en-US', { timeZone: timezone, day: '2-digit' }).format(new Date(item.scheduledFor))}</strong>
          <span>{new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short' }).format(new Date(item.scheduledFor))}</span>
        </>}
      </div>
      <div className="schedule-main">
        <div className="schedule-title"><h3>{chore?.title ?? 'Archived chore'}</h3><span className={overdue ? 'status overdue' : `status ${item.status}`}>{overdue ? 'Overdue' : item.status === 'completed' ? 'Complete' : 'Assigned'}</span></div>
        <p>{roomName} · {chore ? scheduleLabel(chore, item) : formatDateTime(item.scheduledFor, timezone)} · {chore ? formatMinutes(chore.estimatedMinutes) : ''}</p>
        <div className="assignee">
          <span className="avatar small">{initials(userName)}</span>{userName}
          {heartNames.length > 0 && <span className="heart-count">♥ {heartNames.length} · {heartNames.join(', ')}</span>}
          {flags > 0 && <span className="flag-count">{flags} {flags === 1 ? 'flag' : 'flags'}</span>}
        </div>
      </div>
      {actions && <div className="schedule-actions">{actions}</div>}
    </article>
  );
}

function scheduleLabel(chore: Chore, item: ChoreOccurrence): string {
  if (chore.recurrence === 'as_needed') {
    return item.completedAt ? 'As needed · last completed' : 'As needed';
  }
  const time = formatScheduleTime(item.scheduleTime ?? '00:00');
  if (chore.recurrence === 'daily') return `Daily at ${time}`;
  if (chore.recurrence === 'weekly') return `${WEEKDAYS[item.dayOfWeek ?? 0]} at ${time}`;
  return `Day ${item.dayOfMonth ?? 1} at ${time}`;
}

function formatScheduleTime(value: string): string {
  const [hour, minute] = value.split(':').map(Number);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
    .format(new Date(2000, 0, 1, hour, minute));
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span>✓</span><h3>All clear</h3><p>{text}</p></div>;
}
