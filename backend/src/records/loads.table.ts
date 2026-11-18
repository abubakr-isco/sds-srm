import { Inject, Injectable } from '@nestjs/common';
import { LoadStatus, Prisma, Role } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { Actor } from '../auth/actor';
import { APP_CONFIG, AppConfig } from '../config';
import { dayToDate, todayIn } from '../common/dates';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { validateBody } from '../common/validation';
import { IsDecimalString, IsIsoDay, ToDecimalString, Trim } from '../common/validators';
import { Db, PrismaService } from '../prisma.service';
import { parseQuery, Columns } from './query';
import { LoadRow, serializeLoad } from './serialize';
import { Query, TableHandler } from './table';

class LoadDto {
  @Trim() @IsString() @MinLength(1, { message: 'Load number is required.' }) @MaxLength(50) load_number: string;
  @IsOptional() @IsBoolean() is_partial?: boolean;
  @IsOptional() @Trim(true) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(50) parent_load_number?: string | null;
  @IsOptional() @Trim(true) @ValidateIf((_, v) => v !== null) @IsUUID('all', { message: 'Invalid driver.' }) driver_id?: string | null;
  @IsOptional() @Trim(true) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) from_city?: string | null;
  @IsOptional() @Trim(true) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) to_city?: string | null;
  @IsOptional() @IsEnum(LoadStatus, { message: 'Status must be available, pickedup or delivered.' }) status?: LoadStatus;
  @IsOptional() @Trim(true) @ValidateIf((_, v) => v !== null) @IsIsoDay() pickup_date?: string | null;
  @IsOptional() @Trim(true) @ValidateIf((_, v) => v !== null) @IsIsoDay() delivery_date?: string | null;
  @IsOptional() @ToDecimalString() @IsDecimalString({ scale: 2, min: 0, max: 9_999_999_999.99 }) total?: string;
  @IsOptional() @Trim(true) @ValidateIf((_, v) => v !== null) @IsUUID('all', { message: 'Invalid dispatcher.' }) assigned_to?: string | null;
}
/** PATCH bodies use the same rules, but every field is optional. */
class LoadPatchDto extends LoadDto {}

/** Allowed status changes. Same-status updates are no-ops. */
export const STATUS_TRANSITIONS: Record<LoadStatus, LoadStatus[]> = {
  available: ['pickedup', 'delivered'],
  pickedup: ['available', 'delivered'],
  delivered: ['pickedup'],
};

const COLUMNS: Columns = {
  id: { field: 'id', type: 'uuid' },
  load_number: { field: 'loadNumber', type: 'string' },
  is_partial: { field: 'isPartial', type: 'bool' },
  parent_load_number: { field: 'parentLoadNumber', type: 'string' },
  driver_id: { field: 'driverId', type: 'uuid' },
  status: { field: 'status', type: 'enum', values: Object.values(LoadStatus) },
  assigned_to: { field: 'assignedTo', type: 'uuid' },
  pickup_date: { field: 'pickupDate', type: 'date' },
  delivery_date: { field: 'deliveryDate', type: 'date' },
  from_city: { field: 'fromCity', type: 'string' },
  to_city: { field: 'toCity', type: 'string' },
  is_test: { field: 'isTest', type: 'bool' },
  created_at: { field: 'createdAt', type: 'string' },
  total: { field: 'total', type: 'string' },
};

@Injectable()
export class LoadsTable implements TableHandler {
  readonly columns = COLUMNS;
  readonly sortable = ['created_at', 'load_number', 'pickup_date', 'delivery_date', 'status', 'total'];

  constructor(private readonly prisma: PrismaService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Dispatchers see loads assigned to them plus the unassigned pool. */
  private scope(actor: Actor): Prisma.LoadWhereInput {
    return actor.role === Role.admin ? {} : { OR: [{ assignedTo: null }, { assignedTo: actor.id }] };
  }

  async list(actor: Actor, query: Query) {
    const q = parseQuery(query, COLUMNS, this.sortable);
    const where: Prisma.LoadWhereInput = { AND: [this.scope(actor), ...(q.where as Prisma.LoadWhereInput[])] };
    const [rows, total] = await Promise.all([
      this.prisma.load.findMany({ where, orderBy: q.orderBy.length ? q.orderBy : [{ createdAt: 'desc' }], take: q.take, skip: q.skip }),
      q.take !== undefined ? this.prisma.load.count({ where }) : Promise.resolve(undefined),
    ]);
    return { rows: rows.map(serializeLoad), total };
  }

  async create(actor: Actor, body: unknown) {
    const dto = validateBody(LoadDto, body);
    const next = this.normalize(dto, null);
    if (actor.role !== Role.admin && next.assigned_to !== actor.id) throw forbidden('Dispatchers can only add loads assigned to themselves.');
    return this.prisma.$transaction(async (tx) => {
      await this.validate(tx, actor, null, next);
      const created = await tx.load.create({ data: this.toData(next) });
      const row = serializeLoad(created);
      await this.audit(tx, actor, null, row, 'INSERT');
      return row;
    });
  }

  async update(actor: Actor, query: Query, body: unknown) {
    const q = parseQuery(query, COLUMNS, []);
    if (!q.hasIdFilter) throw badRequest('Updates must target rows with id=eq.… or id=in.(…).');
    const patch = validateBody(LoadPatchDto, body, { partial: true });
    if (Object.keys(patch).length === 0) throw badRequest('Nothing to update.');
    return this.prisma.$transaction(async (tx) => {
      const ids = await this.lockRows(tx, actor, q.where as Prisma.LoadWhereInput[]);
      const out: LoadRow[] = [];
      for (const id of ids) {
        const current = await tx.load.findUniqueOrThrow({ where: { id } });
        const before = serializeLoad(current);
        const next = this.normalize(patch, before);
        this.checkDispatcherWrite(actor, before, next);
        await this.validate(tx, actor, before, next);
        const updated = await tx.load.update({ where: { id }, data: this.toData(next) });
        const row = serializeLoad(updated);
        await this.audit(tx, actor, before, row, 'UPDATE');
        out.push(row);
      }
      return out;
    });
  }

  async remove(actor: Actor, query: Query) {
    const q = parseQuery(query, COLUMNS, []);
    if (!q.hasIdFilter) throw badRequest('Deletes must target rows with id=eq.… or id=in.(…).');
    return this.prisma.$transaction(async (tx) => {
      const ids = await this.lockRows(tx, actor, q.where as Prisma.LoadWhereInput[]);
      const out: LoadRow[] = [];
      for (const id of ids) {
        const current = await tx.load.findUniqueOrThrow({ where: { id } });
        const row = serializeLoad(current);
        if (actor.role !== Role.admin && row.assigned_to !== actor.id) throw forbidden('You can only delete your own loads.');
        const partials = await tx.load.count({ where: { parentLoadNumber: row.load_number, id: { notIn: ids } } });
        if (partials > 0) throw conflict(`Load ${row.load_number} has partial loads. Delete them first.`, 'HAS_PARTIALS');
        await this.audit(tx, actor, row, null, 'DELETE');
        out.push(row);
      }
      // Delete partials before their parents (FK is RESTRICT).
      const partialIds = out.filter((r) => r.is_partial).map((r) => r.id);
      const fullIds = out.filter((r) => !r.is_partial).map((r) => r.id);
      if (partialIds.length) await tx.load.deleteMany({ where: { id: { in: partialIds } } });
      if (fullIds.length) await tx.load.deleteMany({ where: { id: { in: fullIds } } });
      return out;
    });
  }

  /** Locks the visible target rows (SELECT … FOR UPDATE) and returns their ids; 404 when none match. */
  private async lockRows(tx: Db, actor: Actor, filters: Prisma.LoadWhereInput[]): Promise<string[]> {
    const visible = await tx.load.findMany({ where: { AND: [this.scope(actor), ...filters] }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    if (visible.length === 0) throw notFound('Load not found or no longer available. Refresh and try again.');
    const ids = visible.map((v) => v.id);
    await tx.$queryRaw`SELECT id FROM loads WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`;
    return ids;
  }

  private normalize(dto: Partial<LoadDto>, before: LoadRow | null): LoadRow {
    const base: LoadRow = before ?? {
      id: '', load_number: '', is_partial: false, parent_load_number: null, driver_id: null, from_city: null, to_city: null,
      status: LoadStatus.available, pickup_date: null, delivery_date: null, total: '0.00', assigned_to: null,
      is_test: false, created_at: '', updated_at: '',
    };
    for (const key of ['load_number', 'is_partial', 'status', 'total'] as const) {
      if (dto[key] === null) throw badRequest(`${key} cannot be null.`);
    }
    const next = { ...base } as LoadRow;
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) (next as Record<string, unknown>)[k] = v;
    if (dto.total !== undefined && dto.total !== null) next.total = Number(dto.total).toFixed(2);
    if (!next.is_partial) next.parent_load_number = null;
    return next;
  }

  /**
   * Dispatcher write rules: edit/claim a load that is theirs or in the pool (it stays theirs),
   * or hand their own load to another dispatcher, changing only assigned_to and clearing the truck.
   */
  private checkDispatcherWrite(actor: Actor, before: LoadRow, next: LoadRow) {
    if (actor.role === Role.admin) return;
    const ownOrPool = !before.assigned_to || before.assigned_to === actor.id;
    if (ownOrPool && next.assigned_to === actor.id) return;
    const changed = (Object.keys(next) as (keyof LoadRow)[]).filter((k) => next[k] !== before[k]);
    const isTransfer = before.assigned_to === actor.id && !!next.assigned_to && next.assigned_to !== actor.id &&
      !next.driver_id && changed.every((k) => k === 'assigned_to' || k === 'driver_id');
    if (!isTransfer) throw forbidden('You can only change your own loads or claim loads from the pool. A transfer may only change the dispatcher and must clear the truck.');
  }

  private async validate(tx: Db, actor: Actor, before: LoadRow | null, next: LoadRow) {
    // Dispatcher being assigned must be an active dispatcher.
    if (next.assigned_to && next.assigned_to !== before?.assigned_to) {
      const target = await tx.user.findUnique({ where: { id: next.assigned_to } });
      if (!target || target.role !== Role.dispatcher || !target.isActive) throw unprocessable('Invalid dispatcher.');
    }
    // Status transitions.
    if (before && before.status !== next.status && !STATUS_TRANSITIONS[before.status].includes(next.status)) {
      throw unprocessable(`Status cannot change from ${before.status} to ${next.status}.`, 'INVALID_STATUS_TRANSITION');
    }
    // Partial loads must point at an existing full load the actor can see.
    if (next.is_partial && (!before || before.parent_load_number !== next.parent_load_number || !before.is_partial)) {
      if (!next.parent_load_number) throw unprocessable('A partial load needs a parent load number.');
      const parent = await tx.load.findUnique({ where: { loadNumber: next.parent_load_number } });
      const visible = parent && (actor.role === Role.admin || !parent.assignedTo || parent.assignedTo === actor.id);
      if (!parent || !visible) throw unprocessable(`Parent load ${next.parent_load_number} was not found.`);
      if (parent.isPartial) throw unprocessable('A partial load cannot be the parent of another partial load.');
    }
    if (before && before.is_partial === false && next.is_partial) {
      const children = await tx.load.count({ where: { parentLoadNumber: before.load_number } });
      if (children) throw unprocessable('This load has partial loads and cannot become a partial itself.');
    }
    await this.checkDriver(tx, actor, before, next);
    this.checkDates(actor, before, next);
  }

  /** A load's truck must belong to the load's dispatcher. */
  private async checkDriver(tx: Db, actor: Actor, before: LoadRow | null, next: LoadRow) {
    if (!next.driver_id) return;
    // An unchanged truck is safe only while the load stays with the same dispatcher.
    // Claiming a pool load must check the truck's owner again.
    if (before && before.driver_id === next.driver_id && before.assigned_to === next.assigned_to) return;
    const driver = await tx.driver.findUnique({ where: { id: next.driver_id } });
    if (!driver) throw unprocessable('Driver not found.');
    if (actor.role !== Role.admin) {
      if (driver.dispatcherId !== actor.id) throw forbidden('You can only use your own drivers.');
      return;
    }
    if (next.assigned_to && driver.dispatcherId && driver.dispatcherId !== next.assigned_to) {
      throw unprocessable('This driver belongs to another dispatcher.');
    }
  }

  private checkDates(actor: Actor, before: LoadRow | null, next: LoadRow) {
    const deliveryChanged = !before || before.delivery_date !== next.delivery_date;
    const pickupChanged = !before || before.pickup_date !== next.pickup_date;
    if (!next.delivery_date || (!deliveryChanged && !pickupChanged)) return;
    if (next.pickup_date && next.delivery_date < next.pickup_date) throw unprocessable('Delivery date cannot be earlier than pickup date.');
    if (actor.role !== Role.admin && deliveryChanged && next.delivery_date < todayIn(this.config.companyTimezone)) {
      throw unprocessable('Delivery date cannot be in the past.');
    }
  }

  private toData(r: LoadRow): Prisma.LoadUncheckedCreateInput {
    return {
      loadNumber: r.load_number, isPartial: r.is_partial, parentLoadNumber: r.parent_load_number, driverId: r.driver_id,
      fromCity: r.from_city, toCity: r.to_city, status: r.status, pickupDate: dayToDate(r.pickup_date),
      deliveryDate: dayToDate(r.delivery_date), total: new Prisma.Decimal(r.total), assignedTo: r.assigned_to,
    };
  }

  /** Written in the same transaction as the change it describes. */
  async audit(tx: Db, actor: Actor | null, oldRow: LoadRow | null, newRow: LoadRow | null, action: 'INSERT' | 'UPDATE' | 'DELETE') {
    await tx.loadHistory.create({
      data: {
        loadId: (newRow ?? oldRow)!.id, action, actorId: actor?.id ?? null,
        oldRow: (oldRow as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        newRow: (newRow as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
  }
}
