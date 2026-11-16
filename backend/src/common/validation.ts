import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { badRequest } from './errors';

type Ctor<T> = new () => T;

function flatten(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((e) => {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    const own = e.constraints ? Object.values(e.constraints) : [];
    if (e.constraints?.whitelistValidation) return [`Unknown field: ${path}.`];
    return [...own, ...flatten(e.children || [], path)];
  });
}

/** Validates an untrusted body against a DTO class (unknown fields are rejected). */
export function validateBody<T extends object>(cls: Ctor<T>, body: unknown, opts: { partial?: boolean } = {}): T {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be a JSON object.');
  const instance = plainToInstance(cls, body, { exposeDefaultValues: false });
  const errors = validateSync(instance as object, {
    whitelist: true, forbidNonWhitelisted: true, skipMissingProperties: !!opts.partial,
  });
  if (errors.length) throw badRequest(flatten(errors).join(' '));
  return instance;
}
