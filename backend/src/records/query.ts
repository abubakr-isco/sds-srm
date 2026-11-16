import { badRequest } from '../common/errors';
import { dayToDate, isIsoDay } from '../common/dates';

export type ColumnType = 'uuid' | 'string' | 'bool' | 'date' | 'int' | 'bigint' | 'enum';
export interface Column { field: string; type: ColumnType; values?: readonly string[] }
export type Columns = Record<string, Column>;

export interface ParsedQuery {
  where: Record<string, unknown>[];
  orderBy: Record<string, 'asc' | 'desc'>[];
  take?: number;
  skip?: number;
  hasIdFilter: boolean;
}

export const MAX_LIMIT = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESERVED = new Set(['select', 'order', 'limit', 'offset']);

function convert(name: string, col: Column, raw: string): unknown {
  switch (col.type) {
    case 'uuid': if (!UUID.test(raw)) throw badRequest(`Invalid value for ${name}.`); return raw.toLowerCase();
    case 'bool': if (raw !== 'true' && raw !== 'false') throw badRequest(`${name} must be true or false.`); return raw === 'true';
    case 'date': if (!isIsoDay(raw)) throw badRequest(`${name} must be YYYY-MM-DD.`); return dayToDate(raw);
    case 'int': if (!/^-?\d+$/.test(raw)) throw badRequest(`${name} must be an integer.`); return Number(raw);
    case 'bigint': if (!/^\d+$/.test(raw)) throw badRequest(`${name} must be an integer.`); return BigInt(raw);
    case 'enum': if (!col.values!.includes(raw)) throw badRequest(`Invalid value for ${name}.`); return raw;
    default: if (raw.length > 200) throw badRequest(`${name} filter is too long.`); return raw;
  }
}

/**
 * Parses PostgREST-style query parameters used by the frontend:
 *   col=eq.VALUE · col=neq.VALUE · col=in.(a,b) · col=is.null · col=gte.V / lte.V (dates, numbers)
 *   col=ilike.*text* (string columns) · order=col.asc|desc[,col2.desc] · limit=N · offset=N · select=*
 * Only whitelisted columns can be filtered or sorted.
 */
export function parseQuery(query: Record<string, unknown>, columns: Columns, sortable: string[]): ParsedQuery {
  const where: Record<string, unknown>[] = [];
  const orderBy: Record<string, 'asc' | 'desc'>[] = [];
  let take: number | undefined;
  let skip: number | undefined;
  let hasIdFilter = false;

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) throw badRequest(`Parameter ${key} is repeated.`);
    const raw = String(value ?? '');
    if (key === 'select') { if (raw && raw !== '*') throw badRequest('Only select=* is supported.'); continue; }
    if (key === 'limit' || key === 'offset') {
      if (!/^\d+$/.test(raw)) throw badRequest(`${key} must be a non-negative integer.`);
      const n = Number(raw);
      if (key === 'limit') { if (n < 1 || n > MAX_LIMIT) throw badRequest(`limit must be between 1 and ${MAX_LIMIT}.`); take = n; }
      else skip = n;
      continue;
    }
    if (key === 'order') {
      for (const part of raw.split(',')) {
        const [column, dir = 'asc'] = part.split('.');
        if (!sortable.includes(column) || !['asc', 'desc'].includes(dir)) throw badRequest(`Cannot sort by "${part}".`);
        orderBy.push({ [columns[column].field]: dir as 'asc' | 'desc' });
      }
      continue;
    }
    if (RESERVED.has(key)) continue;
    const col = columns[key];
    if (!col) throw badRequest(`Unknown filter column "${key}".`);
    const dot = raw.indexOf('.');
    const op = dot === -1 ? '' : raw.slice(0, dot);
    const arg = dot === -1 ? '' : raw.slice(dot + 1);
    if (key === 'id' && (op === 'eq' || op === 'in')) hasIdFilter = true;
    switch (op) {
      case 'eq': where.push({ [col.field]: convert(key, col, arg) }); break;
      case 'neq': where.push({ NOT: { [col.field]: convert(key, col, arg) } }); break;
      case 'is':
        if (arg !== 'null') throw badRequest('Only is.null is supported.');
        where.push({ [col.field]: null }); break;
      case 'in': {
        if (!arg.startsWith('(') || !arg.endsWith(')')) throw badRequest(`${key}=in.(…) is malformed.`);
        const items = arg.slice(1, -1).split(',').filter(Boolean);
        if (items.length === 0 || items.length > MAX_LIMIT) throw badRequest(`${key}=in.(…) needs 1–${MAX_LIMIT} values.`);
        where.push({ [col.field]: { in: items.map((v) => convert(key, col, v)) } }); break;
      }
      case 'gte': case 'lte': case 'gt': case 'lt':
        if (!['date', 'int', 'bigint'].includes(col.type)) throw badRequest(`${op} is not supported for ${key}.`);
        where.push({ [col.field]: { [op]: convert(key, col, arg) } }); break;
      case 'ilike':
        if (col.type !== 'string') throw badRequest(`ilike is only supported for text columns.`);
        where.push({ [col.field]: { contains: arg.replace(/^\*|\*$/g, ''), mode: 'insensitive' } }); break;
      default: throw badRequest(`Unsupported filter "${raw}" for ${key}.`);
    }
  }
  return { where, orderBy, take, skip, hasIdFilter };
}
