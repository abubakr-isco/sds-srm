import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { NoticeKind, Role } from '@prisma/client';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Actor, CurrentActor } from '../auth/actor';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from '../auth/password';
import { conflict, unauthorized } from '../common/errors';
import { validateBody } from '../common/validation';
import { IsImageDataUrl, Trim } from '../common/validators';
import { PrismaService } from '../prisma.service';
import { serializeUser } from '../records/serialize';

class AccountDto {
  @IsOptional() @IsImageDataUrl() avatar_url?: string;
  @IsOptional() @Trim() @IsEmail({}, { message: 'Enter a valid email.' }) @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MinLength(PASSWORD_MIN, { message: `Password must be at least ${PASSWORD_MIN} characters.` }) @MaxLength(PASSWORD_MAX) new_password?: string;
  @IsOptional() @IsString() @MaxLength(256) current_password?: string;
}

/** POST /api/account/update — any signed-in employee changes only their own avatar, login email and password. */
@Controller('account')
export class AccountController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('update') @HttpCode(200)
  async update(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const dto = validateBody(AccountDto, body);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    const email = dto.email === undefined ? user.email : dto.email.toLowerCase();
    const emailChanged = email !== user.email;
    const newPassword = dto.new_password || '';
    if (emailChanged || newPassword) {
      if (!dto.current_password || !(await verifyPassword(dto.current_password, user.passwordHash))) {
        throw unauthorized('Current password is incorrect.', 'INVALID_CURRENT_PASSWORD');
      }
    }
    if (emailChanged && (await this.prisma.user.findUnique({ where: { email } }))) throw conflict('This email is already in use.');
    const passwordHash = newPassword ? await hashPassword(newPassword) : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: user.id },
        data: {
          ...(dto.avatar_url !== undefined ? { avatarUrl: dto.avatar_url || null } : {}),
          ...(emailChanged ? { email } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      if (emailChanged) {
        await tx.adminNotice.create({ data: { kind: NoticeKind.email_changed, userId: user.id, fullName: user.fullName, oldEmail: user.email, newEmail: email } });
      }
      if (passwordHash) {
        // Administrators are told that a dispatcher changed the password — never the password itself.
        if (user.role !== Role.admin) {
          await tx.adminNotice.create({ data: { kind: NoticeKind.password_changed, userId: user.id, fullName: user.fullName, newEmail: email } });
        }
        // Sign out the employee's other sessions; the current one stays.
        await tx.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: actor.sessionId } }, data: { revokedAt: new Date() } });
      }
      return u;
    });
    return { profile: serializeUser(updated) };
  }
}
