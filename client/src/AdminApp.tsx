import { useState, type FormEvent } from 'react';
import { RECURRENCE_LABELS, type BootstrapData, type Chore, type ChoreFlag, type Recurrence } from '@chores/shared';
import { Header } from './components/Header';
import { Modal } from './components/Modal';
import { mutate } from './lib/api';
import { formatDateTime, formatMinutes, initials } from './lib/format';

interface AdminAppProps {
  data: BootstrapData;
  refresh: () => Promise<void>;
  logout: () => void;
}

type AdminView = 'overview' | 'people' | 'rooms' | 'chores';

export function AdminApp({ data, refresh, logout }: AdminAppProps) {
  const [view, setView] = useState<AdminView>('overview');
  const [name, setName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [choreTitle, setChoreTitle] = useState('');
  const [choreRoomId, setChoreRoomId] = useState(data.rooms.find((room) => room.active)?.id ?? 0);
  const [minutes, setMinutes] = useState(15);
  const [recurrence, setRecurrence] = useState<Recurrence>('daily');
  const [editingChore, setEditingChore] = useState<Chore | null>(null);
  const [resolvingFlag, setResolvingFlag] = useState<ChoreFlag | null>(null);
  const [resolution, setResolution] = useState('');
  const [reopen, setReopen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const roomById = new Map(data.rooms.map((room) => [room.id, room]));
  const userById = new Map(data.users.map((user) => [user.id, user]));
  const choreById = new Map(data.chores.map((chore) => [chore.id, chore]));
  const occurrenceById = new Map(data.occurrences.map((item) => [item.id, item]));
  const openFlags = data.flags.filter((flag) => flag.status === 'open');
  const totalMinutes = data.workload.reduce((sum, item) => sum + item.minutes, 0);

  async function run(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, after?: () => void) {
    setBusy(true);
    setError('');
    try {
      await mutate(path, method, body);
      after?.();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save changes');
    } finally {
      setBusy(false);
    }
  }

  function addUser(event: FormEvent) {
    event.preventDefault();
    void run('/api/admin/users', 'POST', { name }, () => setName(''));
  }

  function addRoom(event: FormEvent) {
    event.preventDefault();
    void run('/api/admin/rooms', 'POST', { name: roomName }, () => setRoomName(''));
  }

  function addChore(event: FormEvent) {
    event.preventDefault();
    void run('/api/admin/chores', 'POST', {
      roomId: choreRoomId,
      title: choreTitle,
      estimatedMinutes: minutes,
      recurrence,
    }, () => {
      setChoreTitle('');
      setMinutes(15);
    });
  }

  function updateChore(event: FormEvent) {
    event.preventDefault();
    if (!editingChore) return;
    void run(`/api/admin/chores/${editingChore.id}`, 'PATCH', {
      title: editingChore.title,
      estimatedMinutes: editingChore.estimatedMinutes,
    }, () => setEditingChore(null));
  }

  function submitResolution(event: FormEvent) {
    event.preventDefault();
    if (!resolvingFlag) return;
    void run(`/api/admin/flags/${resolvingFlag.id}`, 'PATCH', { resolution, reopen }, () => {
      setResolvingFlag(null);
      setResolution('');
      setReopen(false);
    });
  }

  return (
    <div className="app-shell admin-shell">
      <Header name="Administrator" admin onLogout={logout} />
      <main className="page-wrap">
        <section className="welcome-row admin-welcome">
          <div><p className="eyebrow">Admin desk</p><h2>Household overview</h2><p className="muted">Keep the work fair, the rooms organized, and issues resolved.</p></div>
          <div className="admin-seal">ADMIN<br /><span>CARTER HOUSE</span></div>
        </section>

        {error && !editingChore && !resolvingFlag && <div className="notice error-notice" role="alert">{error}</div>}

        <nav className="section-nav admin-nav" aria-label="Admin views">
          <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>Overview</button>
          <button className={view === 'people' ? 'active' : ''} onClick={() => setView('people')}>People <span>{data.users.filter((user) => user.active).length}</span></button>
          <button className={view === 'rooms' ? 'active' : ''} onClick={() => setView('rooms')}>Rooms <span>{data.rooms.filter((room) => room.active).length}</span></button>
          <button className={view === 'chores' ? 'active' : ''} onClick={() => setView('chores')}>Chore library <span>{data.chores.filter((chore) => chore.active).length}</span></button>
        </nav>

        {view === 'overview' && (
          <>
            <section className="admin-panel">
              <div className="section-heading compact">
                <div><p className="eyebrow">Current claims</p><h2>Workload balance</h2></div>
                <p>{formatMinutes(totalMinutes)} of estimated work per month</p>
              </div>
              <div className="workload-list">
                {data.workload.map((item, index) => (
                  <article className="workload-row" key={item.userId}>
                    <span className={`avatar tone-${index % 3}`}>{initials(item.name)}</span>
                    <div className="workload-main">
                      <div><strong>{item.name}</strong><span>{item.choreCount} {item.choreCount === 1 ? 'chore' : 'chores'} · {formatMinutes(item.minutes)}</span></div>
                      <div className="workload-track"><span style={{ width: `${item.percentage}%` }} /></div>
                    </div>
                    <strong className="percentage">{item.percentage}%</strong>
                  </article>
                ))}
                {totalMinutes === 0 && <p className="quiet-note">Percentages will appear as household members claim chores.</p>}
              </div>
              {data.occurrences.length > 0 && (
                <div className="assignment-admin-list">
                  <h3>Active assignments</h3>
                  {data.occurrences.map((item) => {
                    const chore = choreById.get(item.choreId);
                    return (
                      <article key={item.id}>
                        <div>
                          <strong>{chore?.title}</strong>
                          <span>{userById.get(item.userId)?.name} · {chore ? adminScheduleLabel(chore.recurrence, item.scheduleTime, item.dayOfWeek, item.dayOfMonth) : 'Assigned'}</span>
                        </div>
                        <button className="small-button" disabled={busy} onClick={() => run(`/api/admin/assignments/${item.id}`, 'DELETE')}>Remove assignment</button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="admin-panel flags-panel">
              <div className="section-heading compact">
                <div><p className="eyebrow rust-text">Review queue</p><h2>Open flags</h2></div>
                <span className="count-badge">{openFlags.length}</span>
              </div>
              {openFlags.length === 0 ? <div className="empty-inline"><span>✓</span><p>No household issues need review.</p></div> : (
                <div className="flag-list">
                  {openFlags.map((flag) => {
                    const occurrence = occurrenceById.get(flag.occurrenceId);
                    const chore = occurrence ? choreById.get(occurrence.choreId) : undefined;
                    return (
                      <article className="flag-card" key={flag.id}>
                        <div className="flag-rule" />
                        <div>
                          <p className="flag-meta">{userById.get(flag.reporterUserId)?.name} flagged {userById.get(occurrence?.userId ?? 0)?.name}</p>
                          <h3>{chore?.title ?? 'Archived chore'}</h3>
                          <blockquote>“{flag.comment}”</blockquote>
                          {occurrence && <p className="muted small-text">Scheduled {formatDateTime(occurrence.scheduledFor, data.householdTimezone)}</p>}
                        </div>
                        <button className="outline-button" onClick={() => { setResolvingFlag(flag); setError(''); }}>Review</button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {view === 'people' && (
          <ManagementSection eyebrow="Household access" title="People" description="People use the shared household password and select their name when signing in.">
            <form className="inline-create" onSubmit={addUser}>
              <label>New household member<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="First name" required /></label>
              <button className="primary-button" disabled={busy}>Add person</button>
            </form>
            <div className="management-list">
              {data.users.map((user) => (
                <article key={user.id} className={!user.active ? 'inactive' : ''}>
                  <span className="avatar">{initials(user.name)}</span>
                  <div><strong>{user.name}</strong><small>{user.active ? 'Can sign in and claim chores' : 'Access disabled'}</small></div>
                  <button className="small-button" disabled={busy} onClick={() => run(`/api/admin/users/${user.id}`, 'PATCH', { active: !user.active })}>{user.active ? 'Disable' : 'Enable'}</button>
                </article>
              ))}
            </div>
          </ManagementSection>
        )}

        {view === 'rooms' && (
          <ManagementSection eyebrow="House layout" title="Rooms" description="Every chore belongs to one room or household area.">
            <form className="inline-create" onSubmit={addRoom}>
              <label>New room or area<input value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={60} placeholder="Laundry room" required /></label>
              <button className="primary-button" disabled={busy}>Add room</button>
            </form>
            <div className="management-list room-management">
              {data.rooms.map((room) => (
                <article key={room.id} className={!room.active ? 'inactive' : ''}>
                  <span className="room-icon" aria-hidden="true">⌂</span>
                  <div><strong>{room.name}</strong><small>{data.chores.filter((chore) => chore.roomId === room.id && chore.active).length} active chores</small></div>
                  <button className="small-button" disabled={busy} onClick={() => run(`/api/admin/rooms/${room.id}`, 'PATCH', { active: !room.active })}>{room.active ? 'Disable' : 'Enable'}</button>
                </article>
              ))}
            </div>
          </ManagementSection>
        )}

        {view === 'chores' && (
          <ManagementSection eyebrow="Recurring work" title="Chore library" description="Create a reusable chore with a cadence and an honest time estimate.">
            <form className="chore-create" onSubmit={addChore}>
              <label className="wide">Chore name<input value={choreTitle} onChange={(event) => setChoreTitle(event.target.value)} maxLength={120} placeholder="Fold clean towels" required /></label>
              <label>Room<select value={choreRoomId} onChange={(event) => setChoreRoomId(Number(event.target.value))}>{data.rooms.filter((room) => room.active).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
              <label>Frequency<select value={recurrence} onChange={(event) => setRecurrence(event.target.value as Recurrence)}>{(Object.keys(RECURRENCE_LABELS) as Recurrence[]).map((item) => <option key={item} value={item}>{RECURRENCE_LABELS[item]}</option>)}</select></label>
              <label>Minutes<input type="number" min={1} max={1440} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} required /></label>
              <button className="primary-button" disabled={busy}>Add chore</button>
            </form>
            <div className="chore-table-wrap">
              <table className="chore-table">
                <thead><tr><th>Chore</th><th>Room</th><th>Cadence</th><th>Estimate</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {data.chores.map((chore) => (
                    <tr key={chore.id} className={!chore.active ? 'inactive' : ''}>
                      <td><strong>{chore.title}</strong></td>
                      <td>{roomById.get(chore.roomId)?.name}</td>
                      <td>{RECURRENCE_LABELS[chore.recurrence]}</td>
                      <td>{formatMinutes(chore.estimatedMinutes)}</td>
                      <td><span className={`status ${chore.active ? 'completed' : 'disabled'}`}>{chore.active ? 'Active' : 'Disabled'}</span></td>
                      <td>
                        <div className="table-actions">
                          <button className="small-button" disabled={busy} onClick={() => { setEditingChore({ ...chore }); setError(''); }}>Edit</button>
                          <button className="small-button" disabled={busy} onClick={() => run(`/api/admin/chores/${chore.id}`, 'PATCH', { active: !chore.active })}>{chore.active ? 'Disable' : 'Enable'}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ManagementSection>
        )}
      </main>

      {editingChore && (
        <Modal title="Edit chore" eyebrow="Chore library" onClose={() => setEditingChore(null)}>
          <p className="modal-intro">Update the name and time estimate shown to everyone in the household.</p>
          <form className="stack-form" onSubmit={updateChore}>
            <label>Chore name<input value={editingChore.title} onChange={(event) => setEditingChore({ ...editingChore, title: event.target.value })} maxLength={120} required autoFocus /></label>
            <label>Minutes<input type="number" min={1} max={1440} value={editingChore.estimatedMinutes} onChange={(event) => setEditingChore({ ...editingChore, estimatedMinutes: Number(event.target.value) })} required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button full" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          </form>
        </Modal>
      )}

      {resolvingFlag && (
        <Modal title="Resolve household flag" eyebrow="Admin review" onClose={() => setResolvingFlag(null)}>
          <p className="modal-intro">Record how this was handled. Reopening puts the chore back into the assignee’s active commitments.</p>
          <blockquote className="modal-quote">“{resolvingFlag.comment}”</blockquote>
          <form className="stack-form" onSubmit={submitResolution}>
            <label>Resolution note<textarea rows={4} maxLength={500} value={resolution} onChange={(event) => setResolution(event.target.value)} required autoFocus /></label>
            <label className="check-label"><input type="checkbox" checked={reopen} onChange={(event) => setReopen(event.target.checked)} /> Reopen this chore for the assignee</label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button full" disabled={busy}>{busy ? 'Resolving…' : 'Resolve flag'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

const ADMIN_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function adminScheduleLabel(
  recurrence: Recurrence,
  scheduleTime: string | null,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
): string {
  if (recurrence === 'as_needed') return 'As needed';
  const [hour, minute] = (scheduleTime ?? '00:00').split(':').map(Number);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
    .format(new Date(2000, 0, 1, hour, minute));
  if (recurrence === 'daily') return `Daily at ${time}`;
  if (recurrence === 'weekly') return `${ADMIN_WEEKDAYS[dayOfWeek ?? 0]} at ${time}`;
  return `Day ${dayOfMonth ?? 1} at ${time}`;
}

function ManagementSection({ eyebrow, title, description, children }: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="admin-panel management-panel">
      <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><p>{description}</p></div>
      {children}
    </section>
  );
}
