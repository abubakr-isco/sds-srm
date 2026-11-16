import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

/** The authenticated employee making the request (always re-read from the database). */
export interface Actor {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  sessionId: string;
}

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor);

export const IS_PUBLIC = 'isPublic';
/** Marks a route as not requiring a bearer token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
