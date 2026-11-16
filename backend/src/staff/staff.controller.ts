import { Body, Controller, HttpCode, Injectable, Post } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Equals, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Actor, CurrentActor } from '../auth/actor';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from '../auth/password';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { validateBody } from '../common/validation';
import { IsDecimalString, ToDecimalString, Trim } from '../common/validators';
import { PrismaService } from '../prisma.service';
import { serializeUser } from '../records/serialize';

class ActionDto {
  @IsIn(['invite', 'update'], { message: 'Unknown staff action.' }) action: 'invite' | 'update';
}
class InviteDto {
  @Equals('invite') action: 'invite';
  @Trim() @IsEmail({}, { message: 'Enter a valid email.' }) @MaxLength(254) email: string;
  @Trim() @IsString() @MinLength(1, { message: 'Enter a full name.' }) @MaxLength(120) full_name: string;
  @IsEnum(Role, { message: 'Invalid role.' }) role: Role;
  @IsString() @MinLength(PASSWORD_MIN, { message: `Temporary password must be at least ${PASSWORD_MIN} characters.` }) @MaxLength(PASSWORD_MAX) password: string;
}
class UpdateDto {
  @Equals('update') action: 'update';
  @IsUUID('all', { message: 'Employee not found.' }) user_id: string;
  @Trim() @IsString() @MinLength(1, { message: 'Enter a full name.' }) @MaxLength(120) full_name: string;
  @IsEnum(Role, { message: 'Invalid role.' }) role: Role;
  @IsBoolean({ message: 'is_active must be true or false.' }) is_active: boolean;
  /** Per-dispatcher fee %; null or "" = use the company-wide %. */
  @IsOptional() @ToDecimalString() @ValidateIf((_, v) => v !== null) @IsDecimalString({ scale: 2, min: 0, max: 100 }, { message: 'Percent must be between 0 and 100.' }) full_pct?: string | null;
  @IsOptional() @ToDecimalString() @ValidateIf((_, v) => v !== null) @IsDecimalString({ scale: 2, min: 0, max: 100 }, { message: 'Percent must be between 0 and 100.' }) partial_pct?: string | null;
  /** Optional: administrator sets a new temporary password for the employee. */
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @MinLength(PASSWORD_MIN, { message: `New password must be at least ${PASSWORD_MIN} characters.` }) @MaxLength(PASSWORD_MAX) new_password?: string | null;
}

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async invite(dto: InviteDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw conflict('This email is already in use.');
    const user = await this.prisma.user.create({
      data: { email, fullName: dto.full_name, role: dto.role, passwordHash: await hashPassword(dto.password) },
    });
    return { invited: true, user_id: user.id, profile: serializeUser(user) };
  }

  async update(actor: Actor, dto: UpdateDto) {
    const passwordHash = dto.new_password ? await hashPassword(dto.new_password) : undefined;
    return this.prisma.$transaction(async (tx) => {
      // Serialise admin-count checks so two concurrent demotions cannot remove the last admin.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242001)`;
      const target = await tx.user.findUnique({ where: { id: dto.user_id } });
      if (!target) throw notFound('Employee not found.');
      const losesAdmin = target.role === Role.admin && target.isActive && (dto.role !== Role.admin || !dto.is_active);
      if (losesAdmin && (await tx.user.count({ where: { role: Role.admin, isActive: true } })) === 1) {
        throw unprocessable('Cannot remove the last active administrator.', 'LAST_ADMIN');
      }
      const dispatcherNow = dto.role === Role.dispatcher;
      const data: Prisma.UserUpdateInput = {
        fullName: dto.full_name, role: dto.role, isActive: dto.is_active,
        fullPct: dispatcherNow ? (dto.full_pct === undefined ? undefined : dto.full_pct) : null,
        partialPct: dispatcherNow ? (dto.partial_pct === undefined ? undefined : dto.partial_pct) : null,
        ...(passwordHash ? { passwordHash, failedLoginCount: 0, lockedUntil: null } : {}),
      };
      const user = await tx.user.update({ where: { id: target.id }, data });
      // A deactivated employee is signed out everywhere; a password reset also ends their sessions.
      if (!dto.is_active || passwordHash) {
        await tx.session.updateMany({ where: { userId: target.id, revokedAt: null, ...(target.id === actor.id ? { id: { not: actor.sessionId } } : {}) }, data: { revokedAt: new Date() } });
      }
      return { updated: true, profile: serializeUser(user) };
    });
  }
}

/** POST /api/staff/manage — administrators only. */
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post('manage') @HttpCode(200)
  manage(@CurrentActor() actor: Actor, @Body() body: unknown) {
    if (actor.role !== Role.admin) throw forbidden('Administrator access required.');
    if (body === null || typeof body !== 'object') throw badRequest('Request body must be a JSON object.');
    const { action } = validateBody(ActionDto, { action: (body as { action?: unknown }).action });
    if (action === 'invite') return this.staff.invite(validateBody(InviteDto, body));
    return this.staff.update(actor, validateBody(UpdateDto, body));
  }
}
