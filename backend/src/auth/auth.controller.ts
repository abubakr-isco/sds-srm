import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config';
import { unauthorized } from '../common/errors';
import { validateBody } from '../common/validation';
import { Trim } from '../common/validators';
import { AuthService } from './auth.service';
import { Actor, CurrentActor, Public } from './actor';
import { assertSameSite, clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './session-cookie';

class LoginDto {
  @Trim() @IsEmail({}, { message: 'Enter a valid email.' }) @MaxLength(254) email: string;
  @IsString() @MinLength(1, { message: 'Enter your password.' }) @MaxLength(256) password: string;
}

/**
 * Sign-in returns a short-lived access token in the body; the refresh token is set only
 * as an HttpOnly cookie (never readable by page scripts). Per-IP limits: see AppModule.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Public() @Post('login') @HttpCode(200)
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    assertSameSite(req, this.config);
    const dto = validateBody(LoginDto, body);
    const { refresh_token: refreshToken, ...result } = await this.auth.login(dto.email, dto.password);
    setRefreshCookie(res, refreshToken, this.config);
    return result;
  }

  @Public() @Post('refresh') @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertSameSite(req, this.config);
    const token = readRefreshCookie(req);
    if (!token || token.length < 20 || token.length > 200) throw unauthorized('Session expired. Please sign in again.', 'REFRESH_INVALID');
    // A failed refresh leaves the cookie alone: a request that lost a race with another
    // tab must not wipe the newer cookie that the winning request just set.
    const { refresh_token: next, ...result } = await this.auth.refresh(token);
    setRefreshCookie(res, next, this.config);
    return result;
  }

  @Post('logout') @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @CurrentActor() actor: Actor) {
    assertSameSite(req, this.config);
    await this.auth.logout(actor.sessionId);
    clearRefreshCookie(res, this.config);
  }
}
