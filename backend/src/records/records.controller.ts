import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Actor, CurrentActor } from '../auth/actor';
import { ApiError, notFound } from '../common/errors';
import { LoadsTable } from './loads.table';
import {
  ActivityLogTable, AdminNoticesTable, CalendarNotesTable, CustomCitiesTable, DriversTable, LoadHistoryTable, SettingsTable, StaffProfilesTable,
} from './other.tables';
import { TableHandler } from './table';

/**
 * Generic resource endpoint used by the frontend: /api/records/:table
 * GET → array of rows · POST → [created] (201) · PATCH ?id=eq.… → changed rows · DELETE ?id=eq.… → deleted rows
 */
@Controller('records')
export class RecordsController {
  private readonly tables: Record<string, TableHandler>;

  constructor(
    loads: LoadsTable, drivers: DriversTable, settings: SettingsTable, staff: StaffProfilesTable, notes: CalendarNotesTable,
    cities: CustomCitiesTable, activity: ActivityLogTable, history: LoadHistoryTable, notices: AdminNoticesTable,
  ) {
    this.tables = {
      loads, drivers, settings, staff_profiles: staff, calendar_notes: notes, custom_cities: cities,
      activity_log: activity, load_history: history, admin_notices: notices,
    };
  }

  private table(name: string): TableHandler {
    const t = Object.prototype.hasOwnProperty.call(this.tables, name) ? this.tables[name] : undefined;
    if (!t) throw notFound(`Unknown resource "${name}".`);
    return t;
  }

  private static notAllowed(): never {
    throw new ApiError(HttpStatus.METHOD_NOT_ALLOWED, 'This operation is not allowed on this resource.', 'METHOD_NOT_ALLOWED');
  }

  @Get(':table')
  async list(@CurrentActor() actor: Actor, @Param('table') name: string, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const { rows, total } = await this.table(name).list(actor, query);
    if (total !== undefined) res.setHeader('X-Total-Count', String(total));
    return rows;
  }

  @Post(':table') @HttpCode(201)
  async create(@CurrentActor() actor: Actor, @Param('table') name: string, @Body() body: unknown) {
    const t = this.table(name);
    if (!t.create) RecordsController.notAllowed();
    return [await t.create(actor, body)];
  }

  @Patch(':table')
  update(@CurrentActor() actor: Actor, @Param('table') name: string, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    const t = this.table(name);
    if (!t.update) RecordsController.notAllowed();
    return t.update(actor, query, body);
  }

  @Delete(':table')
  remove(@CurrentActor() actor: Actor, @Param('table') name: string, @Query() query: Record<string, unknown>) {
    const t = this.table(name);
    if (!t.remove) RecordsController.notAllowed();
    return t.remove(actor, query);
  }
}
