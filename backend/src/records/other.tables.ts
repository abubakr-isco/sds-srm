import { Injectable } from '@nestjs/common';
import { DriverType, NoticeKind, Prisma, Role, Theme } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { Actor } from '../auth/actor';
import { dayToDate } from '../common/dates';
import { badRequest, forbidden, notFound, unprocessable } from '../common/errors';
import { validateBody } from '../common/validation';
import { IsDecimalString, IsImageDataUrl, IsIsoDay, ToDecimalString, Trim } from '../common/validators';
import { Db, PrismaService } from '../prisma.service';
import { LoadsTable } from './loads.table';
import { Columns, parseQuery } from './query';
import {
  serializeActivity, serializeCity, serializeDriver, serializeLoad, serializeLoadHistory, serializeNote, serializeNotice,
  serializeSettings, serializeUser,
} from './serialize';
import { Query, TableHandler } from './table';

const isAdmin = (a: Actor) => a.role === Role.admin;
const and = <T>(...parts: (T | T[])[]) => ({ AND: parts.flat() as T[] });
const requireIdFilter = (hasIdFilter: boolean) => {
  if (!hasIdFilter) throw badRequest('This operation must target rows with id=eq.… or id=in.(…).');
};

async function activeDispatcher(db: Db, id: string | null | undefined) {
  if (!id) return;
  const u = await db.user.findUnique({ where: { id } });
  if (!u || u.role !== Role.dispatcher || !u.isActive) throw unprocessable('Invalid dispatcher.');
}

// ---------------------------------------------------------------------------- drivers
class DriverDto {
  @Trim() @IsString() @MinLength(1, { message: 'First name is required.' }) @MaxLength(80) first_name: string;
  @Trim() @IsString() @MinLength(1, { message: 'Last name is required.' }) @MaxLength(80) last_name: string;
  @Trim() @IsString() @MinLength(1, { message: 'Truck number is required.' }) @MaxLength(30) truck_number: string;
  @IsEnum(DriverType, { message: 'Type must be company or owner.' }) type: DriverType;
  @IsOptional() @Trim(true) @ValidateIf((_, v) => v !== null) @IsUUID('all', { message: 'Invalid dispatcher.' }) dispatcher_id?: string | null;
}

@Injectable()
export class DriversTable implements TableHandler {
  readonly columns: Columns = {
    id: { field: 'id', type: 'uuid' }, dispatcher_id: { field: 'dispatcherId', type: 'uuid' },
    truck_number: { field: 'truckNumber', type: 'string' }, type: { field: 'type', type: 'enum', values: Object.values(DriverType) },
    created_at: { field: 'createdAt', type: 'string' }, is_test: { field: 'isTest', type: 'bool' },
  };
  readonly sortable = ['created_at', 'truck_number'];
  constructor(private readonly prisma: PrismaService, private readonly loads: LoadsTable) {}

  /** Dispatchers only see their own drivers. */
  private scope(a: Actor): Prisma.DriverWhereInput { return isAdmin(a) ? {} : { dispatcherId: a.id }; }

  async list(actor: Actor, query: Query) {
    const q = parseQuery(query, this.columns, this.sortable);
    const rows = await this.prisma.driver.findMany({
      where: and(this.scope(actor), q.where as Prisma.DriverWhereInput[]),
      orderBy: q.orderBy.length ? q.orderBy : [{ createdAt: 'asc' }], take: q.take, skip: q.skip,
    });
    return { rows: rows.map(serializeDriver) };
  }

  async create(actor: Actor, body: unknown) {
    const dto = validateBody(DriverDto, body);
    const dispatcherId = dto.dispatcher_id ?? null;
    if (!isAdmin(actor) && dispatcherId !== actor.id) throw forbidden('Dispatchers can only add drivers to themselves.');
    await activeDispatcher(this.prisma, dispatcherId);
    const d = await this.prisma.driver.create({
      data: { firstName: dto.first_name, lastName: dto.last_name, truckNumber: dto.truck_number, type: dto.type, dispatcherId },
    });
    return serializeDriver(d);
  }

  async update(actor: Actor, query: Query, body: unknown) {
    const q = parseQuery(query, this.columns, []);
    requireIdFilter(q.hasIdFilter);
    const dto = validateBody(DriverDto, body, { partial: true });
    for (const k of ['first_name', 'last_name', 'truck_number', 'type'] as const) if (dto[k] === null) throw badRequest(`${k} cannot be null.`);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.driver.findMany({ where: and(this.scope(actor), q.where as Prisma.DriverWhereInput[]) });
      if (!rows.length) throw notFound('Driver not found or no longer available.');
      const out = [];
      for (const row of rows) {
        const nextDispatcher = dto.dispatcher_id === undefined ? row.dispatcherId : dto.dispatcher_id;
        // Only admins may set or change a driver's dispatcher.
        if (!isAdmin(actor) && nextDispatcher !== actor.id) throw forbidden('Only an administrator can move a driver to another dispatcher.');
        if (nextDispatcher !== row.dispatcherId) await activeDispatcher(tx, nextDispatcher);
        const d = await tx.driver.update({
          where: { id: row.id },
          data: { firstName: dto.first_name, lastName: dto.last_name, truckNumber: dto.truck_number, type: dto.type, dispatcherId: nextDispatcher },
        });
        out.push(serializeDriver(d));
      }
      return out;
    });
  }

  /** Deleting a driver takes it off its loads (with load history) in one transaction. */
  async remove(actor: Actor, query: Query) {
    const q = parseQuery(query, this.columns, []);
    requireIdFilter(q.hasIdFilter);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.driver.findMany({ where: and(this.scope(actor), q.where as Prisma.DriverWhereInput[]) });
      if (!rows.length) throw notFound('Driver not found or no longer available.');
      const ids = rows.map((r) => r.id);
      const affected = await tx.load.findMany({ where: { driverId: { in: ids } } });
      for (const load of affected) {
        const updated = await tx.load.update({ where: { id: load.id }, data: { driverId: null } });
        await this.loads.audit(tx, actor, serializeLoad(load), serializeLoad(updated), 'UPDATE');
      }
      await tx.driver.deleteMany({ where: { id: { in: ids } } });
      return rows.map(serializeDriver);
    });
  }
}

// ---------------------------------------------------------------------------- settings
class SettingsDto {
  @IsOptional() @ToDecimalString() @IsDecimalString({ scale: 2, min: 0, max: 100 }) full_pct?: string;
  @IsOptional() @ToDecimalString() @IsDecimalString({ scale: 2, min: 0, max: 100 }) partial_pct?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(120) dispatcher_name?: string;
  @IsOptional() @IsImageDataUrl() avatar_url?: string;
  @IsOptional() @IsEnum(Theme, { message: 'Theme must be dark or light.' }) theme?: Theme;
}

@Injectable()
export class SettingsTable implements TableHandler {
  readonly columns: Columns = { id: { field: 'id', type: 'int' } };
  readonly sortable = ['id'];
  constructor(private readonly prisma: PrismaService) {}

  async list(_actor: Actor, query: Query) {
    const q = parseQuery(query, this.columns, this.sortable);
    const rows = await this.prisma.settings.findMany({ where: and(q.where as Prisma.SettingsWhereInput[]) });
    return { rows: rows.map(serializeSettings) };
  }

  async update(actor: Actor, query: Query, body: unknown) {
    if (!isAdmin(actor)) throw forbidden('Only an administrator can change company settings.');
    const q = parseQuery(query, this.columns, []);
    requireIdFilter(q.hasIdFilter);
    const dto = validateBody(SettingsDto, body, { partial: true });
    const existing = await this.prisma.settings.findMany({ where: and(q.where as Prisma.SettingsWhereInput[]) });
    if (!existing.length) throw notFound('Settings not found.');
    const s = await this.prisma.settings.update({
      where: { id: 1 },
      data: {
        fullPct: dto.full_pct ?? undefined, partialPct: dto.partial_pct ?? undefined,
        dispatcherName: dto.dispatcher_name ?? undefined, theme: dto.theme ?? undefined,
        avatarUrl: dto.avatar_url === undefined ? undefined : dto.avatar_url || null,
      },
    });
    return [serializeSettings(s)];
  }
}

// ---------------------------------------------------------------------------- staff_profiles (read-only here; changes go through /staff/manage and /account/update)
@Injectable()
export class StaffProfilesTable implements TableHandler {
  readonly columns: Columns = {
    user_id: { field: 'id', type: 'uuid' }, role: { field: 'role', type: 'enum', values: Object.values(Role) },
    is_active: { field: 'isActive', type: 'bool' }, email: { field: 'email', type: 'string' },
    created_at: { field: 'createdAt', type: 'string' }, full_name: { field: 'fullName', type: 'string' },
  };
  readonly sortable = ['created_at', 'full_name', 'email'];
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: Actor, query: Query) {
    const q = parseQuery(query, this.columns, this.sortable);
    // Dispatchers see active colleagues (names for hand-offs) but only their own fee %.
    const scope: Prisma.UserWhereInput = isAdmin(actor) ? {} : { OR: [{ isActive: true }, { id: actor.id }] };
    const rows = await this.prisma.user.findMany({
      where: and(scope, q.where as Prisma.UserWhereInput[]),
      orderBy: q.orderBy.length ? q.orderBy : [{ createdAt: 'asc' }], take: q.take, skip: q.skip,
    });
    return { rows: rows.map((u) => serializeUser(u, { includePct: isAdmin(actor) || u.id === actor.id })) };
  }
}

// ---------------------------------------------------------------------------- calendar_notes
class NoteDto {
  @IsIsoDay() note_date: string;
  @Trim() @IsString() @MinLength(1, { message: 'Note text is required.' }) @MaxLength(1000) note_text: string;
  /** Accepted for compatibility; the server always records the signed-in user. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() created_by?: string | null;
}

@Injectable()
export class CalendarNotesTable implements TableHandler {
  readonly columns: Columns = {
    id: { field: 'id', type: 'uuid' }, note_date: { field: 'noteDate', type: 'date' },
    created_by: { field: 'createdBy', type: 'uuid' }, created_at: { field: 'createdAt', type: 'string' },
  };
  readonly sortable = ['created_at', 'note_date'];
  constructor(private readonly prisma: PrismaService) {}

  async list(_actor: Actor, query: Query) {
    const q = parseQuery(query, this.columns, this.sortable);
    const rows = await this.prisma.calendarNote.findMany({
      where: and(q.where as Prisma.CalendarNoteWhereInput[]),
      orderBy: q.orderBy.length ? q.orderBy : [{ createdAt: 'asc' }], take: q.take, skip: q.skip,
    });
    return { rows: rows.map(serializeNote) };
  }

  async create(actor: Actor, body: unknown) {
    const dto = validateBody(NoteDto, body);
    if (dto.created_by && dto.created_by !== actor.id) throw forbidden('Notes are always created by the signed-in user.');
    const n = await this.prisma.calendarNote.create({ data: { noteDate: dayToDate(dto.note_date)!, noteText: dto.note_text, createdBy: actor.id } });
    return serializeNote(n);
  }

  async remove(actor: Actor, query: Query) {
    const q = parseQuery(query, this.columns, []);
    requireIdFilter(q.hasIdFilter);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.calendarNote.findMany({ where: and(q.where as Prisma.CalendarNoteWhereInput[]) });
      if (!rows.length) throw notFound('Note not found.');
      if (!isAdmin(actor) && rows.some((r) => r.createdBy !== actor.id)) throw forbidden('You can only delete your own notes.');
      await tx.calendarNote.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      return rows.map(serializeNote);
    });
  }
}

// ---------------------------------------------------------------------------- custom_cities
class CityDto {
  @Trim() @IsString() @MinLength(1, { message: 'City is required.' }) @MaxLength(80) city: string;
  @Trim() @IsString() @MinLength(2, { message: 'State is required.' }) @MaxLength(40) state: string;
  @IsOptional() @Trim() @ValidateIf((_, v) => v !== null && v !== '') @Matches(/^[0-9A-Za-z -]{3,10}$/, { message: 'Invalid ZIP code.' }) zip?: string | null;
}

@Injectable()
export class CustomCitiesTable implements TableHandler {
  readonly columns: Columns = { id: { field: 'id', type: 'uuid' }, state: { field: 'state', type: 'string' }, created_at: { field: 'createdAt', type: 'string' } };
  readonly sortable = ['created_at', 'city'];
  constructor(private readonly prisma: PrismaService) {}

  async list(_actor: Actor, query: Query) {
    const q = parseQuery(query, { ...this.columns, city: { field: 'city', type: 'string' } }, this.sortable);
    const rows = await this.prisma.customCity.findMany({
      where: and(q.where as Prisma.CustomCityWhereInput[]),
      orderBy: q.orderBy.length ? q.orderBy : [{ createdAt: 'asc' }], take: q.take, skip: q.skip,
    });
    return { rows: rows.map(serializeCity) };
  }

  async create(actor: Actor, body: unknown) {
    const dto = validateBody(CityDto, body);
    const c = await this.prisma.customCity.create({ data: { city: dto.city, state: dto.state, zip: dto.zip || '', createdBy: actor.id } });
    return serializeCity(c);
  }

  async remove(actor: Actor, query: Query) {
    if (!isAdmin(actor)) throw forbidden('Only an administrator can delete cities.');
    const q = parseQuery(query, this.columns, []);
    requireIdFilter(q.hasIdFilter);
    const rows = await this.prisma.customCity.findMany({ where: and(q.where as Prisma.CustomCityWhereInput[]) });
    if (!rows.length) throw notFound('City not found.');
    await this.prisma.customCity.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return rows.map(serializeCity);
  }
}

// ---------------------------------------------------------------------------- activity_log (append-only)
class ActivityDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(500) action_text: string;
  /** Accepted for compatibility; the server records the signed-in user. */
  @IsOptional() @IsString() @MaxLength(254) user_email?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() user_id?: string | null;
}

@Injectable()
export class ActivityLogTable implements TableHandler {
  readonly columns: Columns = { id: { field: 'id', type: 'uuid' }, user_id: { field: 'userId', type: 'uuid' }, created_at: { field: 'createdAt', type: 'string' } };
  readonly sortable = ['created_at'];
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: Actor, query: Query) {
    const q = parseQuery(query, this.columns, this.sortable);
    const scope: Prisma.ActivityLogWhereInput = isAdmin(actor) ? {} : { userId: actor.id };
    const rows = await this.prisma.activityLog.findMany({
      where: and(scope, q.where as Prisma.ActivityLogWhereInput[]),
      orderBy: q.orderBy.length ? q.orderBy : [{ createdAt: 'desc' }], take: q.take ?? 50, skip: q.skip,
    });
    return { rows: rows.map(serializeActivity) };
  }

  async create(actor: Actor, body: unknown) {
    const dto = validateBody(ActivityDto, body);
    if (dto.user_id && dto.user_id !== actor.id) throw forbidden('Activity is always recorded for the signed-in user.');
    const a = await this.prisma.activityLog.create({ data: { actionText: dto.action_text, userEmail: actor.email, userId: actor.id } });
    return serializeActivity(a);
  }
}

// ---------------------------------------------------------------------------- load_history (read-only)
@Injectable()
export class LoadHistoryTable implements TableHandler {
  readonly columns: Columns = { id: { field: 'id', type: 'bigint' }, load_id: { field: 'loadId', type: 'uuid' }, created_at: { field: 'createdAt', type: 'string' } };
  readonly sortable = ['created_at', 'id'];
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: Actor, query: Query) {
    const q = parseQuery(query, this.columns, this.sortable);
    let scope: Prisma.LoadHistoryWhereInput = {};
    if (!isAdmin(actor)) {
      // Dispatchers see history only for loads they can currently see.
      const visible = await this.prisma.load.findMany({ where: { OR: [{ assignedTo: null }, { assignedTo: actor.id }] }, select: { id: true } });
      scope = { loadId: { in: visible.map((v) => v.id) } };
    }
    const rows = await this.prisma.loadHistory.findMany({
      where: and(scope, q.where as Prisma.LoadHistoryWhereInput[]),
      orderBy: q.orderBy.length ? q.orderBy : [{ createdAt: 'desc' }], take: q.take ?? 100, skip: q.skip,
    });
    return { rows: rows.map(serializeLoadHistory) };
  }
}

// ---------------------------------------------------------------------------- admin_notices (admin read + dismiss)
@Injectable()
export class AdminNoticesTable implements TableHandler {
  readonly columns: Columns = {
    id: { field: 'id', type: 'uuid' }, kind: { field: 'kind', type: 'enum', values: Object.values(NoticeKind) },
    created_at: { field: 'createdAt', type: 'string' },
  };
  readonly sortable = ['created_at'];
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: Actor, query: Query) {
    if (!isAdmin(actor)) return { rows: [] };
    const q = parseQuery(query, this.columns, this.sortable);
    const rows = await this.prisma.adminNotice.findMany({
      where: and(q.where as Prisma.AdminNoticeWhereInput[]),
      orderBy: q.orderBy.length ? q.orderBy : [{ createdAt: 'desc' }], take: q.take, skip: q.skip,
    });
    return { rows: rows.map(serializeNotice) };
  }

  async remove(actor: Actor, query: Query) {
    if (!isAdmin(actor)) throw forbidden('Administrator access required.');
    const q = parseQuery(query, this.columns, []);
    requireIdFilter(q.hasIdFilter);
    const rows = await this.prisma.adminNotice.findMany({ where: and(q.where as Prisma.AdminNoticeWhereInput[]) });
    if (!rows.length) throw notFound('Notice not found.');
    await this.prisma.adminNotice.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return rows.map(serializeNotice);
  }
}
