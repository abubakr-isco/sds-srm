import type { Actor } from '../auth/actor';
import type { Columns } from './query';

export type Row = Record<string, unknown>;
export type Query = Record<string, unknown>;

/** One resource behind /api/records/:table. Missing methods answer 405. */
export interface TableHandler {
  readonly columns: Columns;
  readonly sortable: string[];
  list(actor: Actor, query: Query): Promise<{ rows: Row[]; total?: number }>;
  create?(actor: Actor, body: unknown): Promise<Row>;
  update?(actor: Actor, query: Query, body: unknown): Promise<Row[]>;
  remove?(actor: Actor, query: Query): Promise<Row[]>;
}
