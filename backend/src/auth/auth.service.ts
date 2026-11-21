import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { APP_CONFIG, AppConfig } from '../config';
import { ApiError, unauthorized } from '../common/errors';
import { DUMMY_HASH, verifyPassword } from './password';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newRefreshToken = () => randomBytes(48).toString('base64url');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private accessToken(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId }, {
      secret: this.config.jwtSecret, algorithm: 'HS256', issuer: 'sds-crm', expiresIn: this.config.accessTokenTtlSeconds,
    });
  }

  async login(emailRaw: string, password: string) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const now = new Date();
    if (user?.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000);
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, `Too many failed sign-in attempts. Try again in ${minutes} minute(s).`, 'ACCOUNT_LOCKED');
    }
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      if (user) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= this.config.loginMaxFailedAttempts;
        await this.prisma.user.update({
          where: { id: user.id },
          data: lock
            ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + this.config.loginLockMinutes * 60000) }
            : { failedLoginCount: failed },
        });
      }
      throw unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');
    }
    if (!user.isActive) throw unauthorized('Invalid credentials or account inactive.', 'INVALID_CREDENTIALS');
    if (user.failedLoginCount || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }
    const refreshToken = newRefreshToken();
    const session = await this.prisma.session.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt: this.refreshExpiry() },
    });
    return {
      access_token: await this.accessToken(user.id, session.id),
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtlSeconds,
      user: { id: user.id, email: user.email },
    };
  }

  /** Rotates the refresh token: the old one stops working as soon as the new one is issued. */
  async refresh(refreshToken: string) {
    const oldHash = sha256(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { tokenHash: oldHash }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      throw unauthorized('Session expired. Please sign in again.', 'REFRESH_INVALID');
    }
    const next = newRefreshToken();
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, tokenHash: oldHash, revokedAt: null },
      data: { tokenHash: sha256(next), lastUsedAt: new Date(), expiresAt: this.refreshExpiry() },
    });
    if (rotated.count !== 1) throw unauthorized('Session expired. Please sign in again.', 'REFRESH_INVALID');
    return {
      access_token: await this.accessToken(session.userId, session.id),
      refresh_token: next,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtlSeconds,
      user: { id: session.user.id, email: session.user.email },
    };
  }

  async logout(sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private refreshExpiry() {
    return new Date(Date.now() + this.config.refreshTokenTtlDays * 86400000);
  }
}
