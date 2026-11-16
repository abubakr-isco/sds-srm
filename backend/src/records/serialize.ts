import type { ActivityLog, AdminNotice, CalendarNote, CustomCity, Driver, Load, LoadHistory, Prisma, Settings, User } from '@prisma/client';
import { isoDay } from '../common/dates';

const pct = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const money = (d: Prisma.Decimal) => d.toFixed(2);

export const serializeUser = (u: User, opts: { includePct?: boolean } = { includePct: true }) => ({
  user_id: u.id, email: u.email, full_name: u.fullName, role: u.role, is_active: u.isActive,
  avatar_url: u.avatarUrl ?? '',
  ...(opts.includePct ? { full_pct: pct(u.fullPct), partial_pct: pct(u.partialPct) } : {}),
  is_test: u.isTest, created_at: u.createdAt.toISOString(),
});

export const serializeSettings = (s: Settings) => ({
  id: s.id, full_pct: s.fullPct.toNumber(), partial_pct: s.partialPct.toNumber(),
  dispatcher_name: s.dispatcherName, avatar_url: s.avatarUrl ?? '', theme: s.theme,
});

export const serializeDriver = (d: Driver) => ({
  id: d.id, first_name: d.firstName, last_name: d.lastName, truck_number: d.truckNumber, type: d.type,
  dispatcher_id: d.dispatcherId, is_test: d.isTest, created_at: d.createdAt.toISOString(),
});

export const serializeLoad = (l: Load) => ({
  id: l.id, load_number: l.loadNumber, is_partial: l.isPartial, parent_load_number: l.parentLoadNumber,
  driver_id: l.driverId, from_city: l.fromCity, to_city: l.toCity, status: l.status,
  pickup_date: isoDay(l.pickupDate), delivery_date: isoDay(l.deliveryDate), total: money(l.total),
  assigned_to: l.assignedTo, is_test: l.isTest, created_at: l.createdAt.toISOString(), updated_at: l.updatedAt.toISOString(),
});
export type LoadRow = ReturnType<typeof serializeLoad>;

export const serializeLoadHistory = (h: LoadHistory) => ({
  id: h.id.toString(), load_id: h.loadId, action: h.action, actor_id: h.actorId,
  old_row: h.oldRow, new_row: h.newRow, created_at: h.createdAt.toISOString(),
});

export const serializeNote = (n: CalendarNote) => ({
  id: n.id, note_date: isoDay(n.noteDate), note_text: n.noteText, created_by: n.createdBy, is_test: n.isTest, created_at: n.createdAt.toISOString(),
});

export const serializeCity = (c: CustomCity) => ({ id: c.id, city: c.city, state: c.state, zip: c.zip, created_at: c.createdAt.toISOString() });

export const serializeActivity = (a: ActivityLog) => ({
  id: a.id, action_text: a.actionText, user_email: a.userEmail, user_id: a.userId, created_at: a.createdAt.toISOString(),
});

export const serializeNotice = (n: AdminNotice) => ({
  id: n.id, kind: n.kind, user_id: n.userId, full_name: n.fullName, old_email: n.oldEmail, new_email: n.newEmail,
  created_at: n.createdAt.toISOString(),
});
