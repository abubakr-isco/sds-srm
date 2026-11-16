import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { validateBody } from '../common/validation';
import { Trim } from '../common/validators';
import { AuthService } from './auth.service';
import { Actor, CurrentActor, Public } from './actor';

class LoginDto {
  @Trim() @IsEmail({}, { message: 'Enter a valid email.' }) @MaxLength(254) email: string;
  @IsString() @MinLength(1, { message: 'Enter your password.' }) @MaxLength(256) password: string;
}
class RefreshDto {
  @IsString() @MinLength(20) @MaxLength(200) refresh_token: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @UseGuards(ThrottlerGuard) @Post('login') @HttpCode(200)
  login(@Body() body: unknown) {
    const dto = validateBody(LoginDto, body);
    return this.auth.login(dto.email, dto.password);
  }

  @Public() @UseGuards(ThrottlerGuard) @Post('refresh') @HttpCode(200)
  refresh(@Body() body: unknown) {
    return this.auth.refresh(validateBody(RefreshDto, body).refresh_token);
  }

  @Post('logout') @HttpCode(204)
  async logout(@CurrentActor() actor: Actor) {
    await this.auth.logout(actor.sessionId);
  }
}
