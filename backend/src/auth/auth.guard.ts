import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { APP_CONFIG, AppConfig } from '../config';
import { unauthorized } from '../common/errors';
import { IS_PUBLIC } from './actor';

/**
 * Global guard: every route needs a valid access token unless marked @Public().
 * The token's session must still be open and the account active, so deactivating
 * an employee or revoking a session takes effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.config.jwtSecret, algorithms: ['HS256'], issuer: 'sds-crm' });
    } catch {
      throw unauthorized('Session expired. Please sign in again.', 'TOKEN_INVALID');
    }
    const session = await this.prisma.session.findUnique({ where: { id: payload.sid }, include: { user: true } });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt < new Date()) {
      throw unauthorized('Session expired. Please sign in again.', 'SESSION_REVOKED');
    }
    if (!session.user.isActive) throw unauthorized('Your account is inactive.', 'ACCOUNT_INACTIVE');
    req.actor = { id: session.user.id, email: session.user.email, fullName: session.user.fullName, role: session.user.role, sessionId: session.id };
    return true;
  }
}
