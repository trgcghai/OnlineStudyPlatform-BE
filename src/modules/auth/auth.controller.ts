import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { UserRole } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import type { AuthTokenResult } from './auth.service';
import { REFRESH_TOKEN_COOKIE_NAME } from '../../common/constants/auth.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LoginDto } from './dto/auth.dto';
import type { AuthenticatedUser } from './dto/auth.dto';
import { GetToken } from 'src/common/decorators/bearerToken.decorator';

type CookieRequest = Request & {
  cookies: Record<string, string | undefined>;
};

type AuthResponse = Omit<AuthTokenResult, 'refreshToken'>;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.login(loginDto);
    this.setRefreshCookie(response, result.refreshToken);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.refresh(
      request.cookies[REFRESH_TOKEN_COOKIE_NAME] as string,
    );
    this.setRefreshCookie(response, result.refreshToken);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: Response,
    @GetToken() accessToken?: string,
  ) {
    await this.authService.logout(
      request.cookies[REFRESH_TOKEN_COOKIE_NAME] as string,
      accessToken,
    );
    response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/auth' });

    return { loggedOut: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  admin(@CurrentUser() user: AuthenticatedUser) {
    return { role: user.role };
  }

  @Get('instructor')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  instructor(@CurrentUser() user: AuthenticatedUser) {
    return { role: user.role };
  }

  @Get('learner')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.LEARNER)
  learner(@CurrentUser() user: AuthenticatedUser) {
    return { role: user.role };
  }

  private setRefreshCookie(response: Response, refreshToken: string): void {
    response.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.authService.isProduction(),
      path: '/auth',
      maxAge: this.authService.getRefreshCookieMaxAgeMs(),
    });
  }
}
