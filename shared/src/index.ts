export type Recurrence = 'daily' | 'weekly' | 'monthly' | 'as_needed';
export type OccurrenceStatus = 'claimed' | 'completed';
export type FlagStatus = 'open' | 'resolved';

export interface HouseholdUser {
  id: number;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface Room {
  id: number;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface Chore {
  id: number;
  roomId: number;
  title: string;
  estimatedMinutes: number;
  recurrence: Recurrence;
  active: boolean;
  createdAt: string;
}

export interface ChoreOccurrence {
  id: number;
  completionId: number | null;
  choreId: number;
  userId: number;
  scheduledFor: string;
  periodKey: string;
  scheduleTime: string | null;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  status: OccurrenceStatus;
  claimedAt: string;
  completedAt: string | null;
}

export interface CompletionHeart {
  completionId: number;
  giverUserId: number;
  createdAt: string;
}

export interface ChoreFlag {
  id: number;
  occurrenceId: number;
  periodKey: string;
  reporterUserId: number;
  comment: string;
  status: FlagStatus;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Actor {
  role: 'household' | 'admin';
  userId: number | null;
  name: string;
}

export interface WorkloadShare {
  userId: number;
  name: string;
  minutes: number;
  percentage: number;
  choreCount: number;
}

export interface BootstrapData {
  actor: Actor;
  householdTimezone: string;
  users: HouseholdUser[];
  rooms: Room[];
  chores: Chore[];
  occurrences: ChoreOccurrence[];
  hearts: CompletionHeart[];
  flags: ChoreFlag[];
  workload: WorkloadShare[];
}

export interface LoginResponse {
  token: string;
  actor: Actor;
}

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  as_needed: 'As needed',
};
