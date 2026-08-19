# T0-06 Login / Logout + JWT + RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build backend login, logout, refresh-token sessions, Passport JWT authentication, and RBAC guards for `Admin`, `Instructor`, and `Learner`.

**Architecture:** Add an `AuthModule` that owns authentication endpoints, Passport JWT strategy, guards, decorators, and Redis-backed refresh sessions. Reuse the existing `UsersModule` and global `RedisModule`; access tokens are stateless JWTs returned in JSON, while refresh tokens are HttpOnly cookies backed by Redis keys.

**Tech Stack:** NestJS 11, TypeScript, TypeORM, PostgreSQL, ioredis, bcryptjs, `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `cookie-parser`, Jest, Supertest.

---

## Scope And Constraints

- Backend only. Frontend login page, FE token storage, and FE interceptor wiring are outside this plan.
- Do not add a SQL session table. Refresh sessions use Redis.
- Do not make auth global. Routes opt in with guards.
- Do not expose password hashes in controller responses.
- Do not use absolute `src/...` imports in backend code because e2e Jest cannot resolve them in this repo.
- Do not commit during execution unless the user explicitly asks for commits.

## File Structure

Create:

- `src/modules/auth/auth.module.ts`: auth module imports and provider wiring.
- `src/modules/auth/auth.controller.ts`: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, and sample RBAC routes.
- `src/modules/auth/auth.service.ts`: credential validation, token issuance, Redis refresh-session storage, refresh rotation, logout revocation.
- `src/modules/auth/auth.service.spec.ts`: unit tests for login, refresh, logout, and session behavior.
- `src/modules/auth/constants/auth.constant.ts`: cookie name, Redis key prefix, and strategy names.
- `src/modules/auth/decorators/current-user.decorator.ts`: extracts `request.user`.
- `src/modules/auth/decorators/roles.decorator.ts`: stores role metadata.
- `src/modules/auth/dto/login.dto.ts`: validates and normalizes login input.
- `src/modules/auth/guards/jwt-auth.guard.ts`: Passport JWT guard wrapper.
- `src/modules/auth/guards/roles.guard.ts`: role authorization guard.
- `src/modules/auth/guards/roles.guard.spec.ts`: unit tests for RBAC behavior.
- `src/modules/auth/strategies/jwt.strategy.ts`: Passport JWT strategy for access tokens.
- `src/modules/auth/strategies/jwt.strategy.spec.ts`: unit tests for payload validation.
- `src/modules/auth/types/authenticated-user.type.ts`: shared request user and token payload types.
- `test/auth.e2e-spec.ts`: end-to-end login, refresh, logout, and RBAC scenarios.

Modify:

- `package.json`: add auth dependencies.
- `pnpm-lock.yaml`: updated by `pnpm add`.
- `.env.example`: add JWT auth variables.
- `src/main.ts`: register `cookieParser()` before routes.
- `src/app.module.ts`: import `AuthModule`.
- `src/modules/users/users.module.ts`: export `UsersService`.
- `src/modules/users/users.service.ts`: add auth lookup helpers.
- `src/modules/users/users.service.spec.ts`: cover lookup helpers if existing tests require updates.
- `src/modules/users/dto/user.dto.ts`: replace absolute entity import with relative import.

---

### Task 1: Install Auth Dependencies And Configure Env

**Related skills:** `nestjs-patterns`, `test-driven-development`, `verification-before-completion`

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Modify: `src/main.ts`

- [ ] **Step 1: Install runtime dependencies**

Run from `F:\Cntt\KLTN\online-study-platform-be`:

```powershell
pnpm add @nestjs/jwt @nestjs/passport passport passport-jwt cookie-parser
```

Expected: `package.json` contains the five runtime dependencies and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Install type dependencies**

Run:

```powershell
pnpm add -D @types/passport-jwt @types/cookie-parser
```

Expected: `package.json` contains `@types/passport-jwt` and `@types/cookie-parser` under `devDependencies`.

- [ ] **Step 3: Add auth env variables**

Modify `.env.example` by appending:

```env

# JWT authentication. Use long random secrets for local/dev/prod environments.
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TTL=
JWT_REFRESH_TTL=
```

Use example local values in the developer’s uncommitted `.env` when running locally:

```env
JWT_ACCESS_SECRET=local-access-secret-change-me
JWT_REFRESH_SECRET=local-refresh-secret-change-me
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
```

- [ ] **Step 4: Register cookie parser**

Modify `src/main.ts`:

```ts
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<string>('PORT');

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({ origin: true, credentials: true });

  await app.listen(port);
}
void bootstrap();
```

- [ ] **Step 5: Verify dependency and compile health**

Run:

```powershell
pnpm build
```

Expected: build passes. If it fails because env variables are missing at runtime, confirm the command is only compiling and does not start the app.

---

### Task 2: Add UsersService Auth Lookup Helpers

**Related skills:** `nestjs-patterns`, `test-driven-development`, `verification-before-completion`

**Files:**
- Modify: `src/modules/users/users.service.ts`
- Modify: `src/modules/users/users.module.ts`
- Modify: `src/modules/users/dto/user.dto.ts`
- Modify: `src/modules/users/users.service.spec.ts`

- [ ] **Step 1: Write failing unit tests for lookup helpers**

Add tests to `src/modules/users/users.service.spec.ts` that verify normalized lookup behavior:

```ts
it('findByEmail normalizes email before lookup', async () => {
  repository.findOneBy.mockResolvedValue(user);

  await service.findByEmail('  USER@Example.COM  ');

  expect(repository.findOneBy).toHaveBeenCalledWith({
    email: 'user@example.com',
  });
});

it('findById looks up the user by id', async () => {
  repository.findOneBy.mockResolvedValue(user);

  await service.findById('user-id');

  expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'user-id' });
});
```

If the existing spec uses different mock variable names, keep the existing names and assert the same calls.

- [ ] **Step 2: Run the targeted unit test and confirm failure**

Run:

```powershell
pnpm test users.service
```

Expected: fails because `findByEmail` and `findById` do not exist.

- [ ] **Step 3: Implement lookup helpers and export UsersService**

Modify `src/modules/users/users.service.ts` by adding methods inside `UsersService`:

```ts
async findByEmail(email: string): Promise<User | null> {
  return this.usersRepository.findOneBy({
    email: email.trim().toLowerCase(),
  });
}

async findById(id: string): Promise<User | null> {
  return this.usersRepository.findOneBy({ id });
}
```

Modify `src/modules/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

Modify `src/modules/users/dto/user.dto.ts` to use a relative import:

```ts
import { UserRole, UserStatus } from '../entities/user.entity';
```

- [ ] **Step 4: Run targeted unit tests**

Run:

```powershell
pnpm test users.service
```

Expected: users service tests pass.

---

### Task 3: Create Auth Types, Constants, Decorators, And DTO

**Related skills:** `nestjs-patterns`, `test-driven-development`

**Files:**
- Create: `src/modules/auth/constants/auth.constant.ts`
- Create: `src/modules/auth/types/authenticated-user.type.ts`
- Create: `src/modules/auth/decorators/current-user.decorator.ts`
- Create: `src/modules/auth/decorators/roles.decorator.ts`
- Create: `src/modules/auth/dto/login.dto.ts`

- [ ] **Step 1: Create constants**

Create `src/modules/auth/constants/auth.constant.ts`:

```ts
export const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';
export const REFRESH_SESSION_KEY_PREFIX = 'auth:refresh';
export const JWT_STRATEGY_NAME = 'jwt';
export const ROLES_KEY = 'roles';
```

- [ ] **Step 2: Create auth types**

Create `src/modules/auth/types/authenticated-user.type.ts`:

```ts
import { Request } from 'express';
import { UserRole, UserStatus } from '../../users/entities/user.entity';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  cookies: Record<string, string | undefined>;
}
```

- [ ] **Step 3: Create decorators**

Create `src/modules/auth/decorators/roles.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/entities/user.entity';
import { ROLES_KEY } from '../constants/auth.constant';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

Create `src/modules/auth/decorators/current-user.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../types/authenticated-user.type';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
```

- [ ] **Step 4: Create login DTO**

Create `src/modules/auth/dto/login.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
```

- [ ] **Step 5: Run build to verify type imports**

Run:

```powershell
pnpm build
```

Expected: build passes or fails only because later auth files are not present if referenced early. Do not import these files from `AppModule` yet.

---

### Task 4: Implement AuthService With TDD

**Related skills:** `nestjs-patterns`, `test-driven-development`, `systematic-debugging`

**Files:**
- Create: `src/modules/auth/auth.service.ts`
- Create: `src/modules/auth/auth.service.spec.ts`

- [ ] **Step 1: Write failing AuthService tests**

Create `src/modules/auth/auth.service.spec.ts` with mocks for `UsersService`, `JwtService`, `ConfigService`, and Redis:

```ts
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UserRole, UserStatus } from '../users/entities/user.entity';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

describe('AuthService', () => {
  const user = {
    id: 'user-id',
    name: 'Nguyen Van A',
    email: 'learner@example.com',
    password: 'hashed-password',
    role: UserRole.LEARNER,
    status: UserStatus.ACTIVE,
    avatar: null,
  };

  const usersService = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
        NODE_ENV: 'test',
      };
      return values[key];
    }),
  } as unknown as ConfigService;
  const redis = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      usersService as any,
      jwtService as unknown as JwtService,
      configService,
      redis as any,
    );
  });

  it('logs in an active user and stores a refresh session', async () => {
    usersService.findByEmail.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    jwtService.signAsync
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');

    const result = await service.login({
      email: 'learner@example.com',
      password: 'Password1!',
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.user).toMatchObject({
      id: user.id,
      email: user.email,
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
    });
    expect(result.user).not.toHaveProperty('password');
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:refresh:user-id:/),
      expect.any(String),
      'EX',
      604800,
    );
  });

  it('rejects missing users with generic credentials message', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.login({ email: 'missing@example.com', password: 'Password1!' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
  });

  it('rejects wrong passwords with generic credentials message', async () => {
    usersService.findByEmail.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.login({ email: user.email, password: 'wrong' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
  });

  it('rejects inactive users with Account disabled', async () => {
    usersService.findByEmail.mockResolvedValue({
      ...user,
      status: UserStatus.INACTIVE,
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(
      service.login({ email: user.email, password: 'Password1!' }),
    ).rejects.toThrow(new ForbiddenException('Account disabled'));
  });

  it('refreshes and rotates a valid refresh session', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      sessionId: 'old-session',
    });
    redis.get.mockResolvedValue(JSON.stringify({ userId: user.id }));
    usersService.findById.mockResolvedValue(user);
    jwtService.signAsync
      .mockResolvedValueOnce('new-access-token')
      .mockResolvedValueOnce('new-refresh-token');

    const result = await service.refresh('old-refresh-token');

    expect(result.accessToken).toBe('new-access-token');
    expect(result.refreshToken).toBe('new-refresh-token');
    expect(redis.del).toHaveBeenCalledWith('auth:refresh:user-id:old-session');
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:refresh:user-id:/),
      expect.any(String),
      'EX',
      604800,
    );
  });

  it('rejects refresh when Redis session is missing', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      sessionId: 'missing-session',
    });
    redis.get.mockResolvedValue(null);

    await expect(service.refresh('refresh-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('logs out by deleting the refresh session', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: user.id,
      sessionId: 'session-id',
    });

    await service.logout('refresh-token');

    expect(redis.del).toHaveBeenCalledWith('auth:refresh:user-id:session-id');
  });

  it('ignores invalid logout tokens', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

    await expect(service.logout('bad-token')).resolves.toBeUndefined();
    expect(redis.del).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run AuthService test and confirm failure**

Run:

```powershell
pnpm test auth.service
```

Expected: fails because `auth.service.ts` does not exist.

- [ ] **Step 3: Implement AuthService**

Create `src/modules/auth/auth.service.ts`:

```ts
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { User, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  REFRESH_SESSION_KEY_PREFIX,
} from './constants/auth.constant';
import { LoginDto } from './dto/login.dto';
import {
  AccessTokenPayload,
  RefreshTokenPayload,
} from './types/authenticated-user.type';

interface AuthUserResponse {
  id: string;
  name: string;
  email: string;
  role: User['role'];
  status: User['status'];
  avatar: string | null;
}

export interface AuthTokenResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUserResponse;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async login(loginDto: LoginDto): Promise<AuthTokenResult> {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      user.password,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    this.assertActiveUser(user);
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string | undefined): Promise<AuthTokenResult> {
    if (!refreshToken) {
      throw new UnauthorizedException();
    }

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        { secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET') },
      );
    } catch {
      throw new UnauthorizedException();
    }

    const sessionKey = this.getRefreshSessionKey(
      payload.sub,
      payload.sessionId,
    );
    const session = await this.redis.get(sessionKey);
    if (!session) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      await this.redis.del(sessionKey);
      throw new UnauthorizedException();
    }

    try {
      this.assertActiveUser(user);
    } catch (error) {
      await this.redis.del(sessionKey);
      throw error;
    }

    await this.redis.del(sessionKey);
    return this.issueTokens(user);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        { secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET') },
      );
      await this.redis.del(
        this.getRefreshSessionKey(payload.sub, payload.sessionId),
      );
    } catch {
      return;
    }
  }

  getRefreshCookieMaxAgeMs(): number {
    return this.parseTtlToSeconds(
      this.configService.getOrThrow<string>('JWT_REFRESH_TTL'),
    ) * 1000;
  }

  isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private async issueTokens(user: User): Promise<AuthTokenResult> {
    const sessionId = randomUUID();
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sessionId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.getOrThrow<string>('JWT_ACCESS_TTL'),
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.getOrThrow<string>('JWT_REFRESH_TTL'),
      }),
    ]);

    await this.redis.set(
      this.getRefreshSessionKey(user.id, sessionId),
      JSON.stringify({ userId: user.id, sessionId, createdAt: new Date().toISOString() }),
      'EX',
      this.parseTtlToSeconds(
        this.configService.getOrThrow<string>('JWT_REFRESH_TTL'),
      ),
    );

    return {
      accessToken,
      refreshToken,
      user: this.toAuthUserResponse(user),
    };
  }

  private assertActiveUser(user: User): void {
    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException('Account disabled');
    }
  }

  private getRefreshSessionKey(userId: string, sessionId: string): string {
    return `${REFRESH_SESSION_KEY_PREFIX}:${userId}:${sessionId}`;
  }

  private parseTtlToSeconds(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) {
      return Number(value);
    }

    const amount = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 24 * 60 * 60,
    };
    return amount * multipliers[unit];
  }

  private toAuthUserResponse(user: User): AuthUserResponse {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      avatar: user.avatar,
    };
  }
}
```

- [ ] **Step 4: Run AuthService tests**

Run:

```powershell
pnpm test auth.service
```

Expected: AuthService tests pass.

---

### Task 5: Add Passport JWT Strategy And Guard

**Related skills:** `nestjs-patterns`, `test-driven-development`, `systematic-debugging`

**Files:**
- Create: `src/modules/auth/strategies/jwt.strategy.ts`
- Create: `src/modules/auth/strategies/jwt.strategy.spec.ts`
- Create: `src/modules/auth/guards/jwt-auth.guard.ts`

- [ ] **Step 1: Write failing JwtStrategy tests**

Create `src/modules/auth/strategies/jwt.strategy.spec.ts`:

```ts
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UserRole, UserStatus } from '../../users/entities/user.entity';

describe('JwtStrategy', () => {
  const usersService = {
    findById: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn(() => 'access-secret'),
  } as unknown as ConfigService;

  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(configService, usersService as any);
  });

  it('returns an authenticated user for an active account', async () => {
    usersService.findById.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
    });

    await expect(
      strategy.validate({
        sub: 'user-id',
        email: 'user@example.com',
        role: UserRole.LEARNER,
      }),
    ).resolves.toEqual({
      id: 'user-id',
      email: 'user@example.com',
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
    });
  });

  it('rejects missing users', async () => {
    usersService.findById.mockResolvedValue(null);

    await expect(
      strategy.validate({
        sub: 'missing-id',
        email: 'missing@example.com',
        role: UserRole.LEARNER,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects inactive users', async () => {
    usersService.findById.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      role: UserRole.LEARNER,
      status: UserStatus.INACTIVE,
    });

    await expect(
      strategy.validate({
        sub: 'user-id',
        email: 'user@example.com',
        role: UserRole.LEARNER,
      }),
    ).rejects.toThrow(new ForbiddenException('Account disabled'));
  });
});
```

- [ ] **Step 2: Run JwtStrategy test and confirm failure**

Run:

```powershell
pnpm test jwt.strategy
```

Expected: fails because `jwt.strategy.ts` does not exist.

- [ ] **Step 3: Implement JwtStrategy and guard**

Create `src/modules/auth/strategies/jwt.strategy.ts`:

```ts
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { JWT_STRATEGY_NAME } from '../constants/auth.constant';
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../types/authenticated-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY_NAME) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException('Account disabled');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };
  }
}
```

Create `src/modules/auth/guards/jwt-auth.guard.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JWT_STRATEGY_NAME } from '../constants/auth.constant';

@Injectable()
export class JwtAuthGuard extends AuthGuard(JWT_STRATEGY_NAME) {}
```

- [ ] **Step 4: Run JwtStrategy tests**

Run:

```powershell
pnpm test jwt.strategy
```

Expected: JwtStrategy tests pass.

---

### Task 6: Add RolesGuard With TDD

**Related skills:** `nestjs-patterns`, `test-driven-development`

**Files:**
- Create: `src/modules/auth/guards/roles.guard.ts`
- Create: `src/modules/auth/guards/roles.guard.spec.ts`

- [ ] **Step 1: Write failing RolesGuard tests**

Create `src/modules/auth/guards/roles.guard.spec.ts`:

```ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../constants/auth.constant';
import { UserRole, UserStatus } from '../../users/entities/user.entity';

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  let guard: RolesGuard;

  const createContext = (role: UserRole): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: 'user-id',
            email: 'user@example.com',
            role,
            status: UserStatus.ACTIVE,
          },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new RolesGuard(reflector);
  });

  it('allows when no role metadata is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    expect(guard.canActivate(createContext(UserRole.LEARNER))).toBe(true);
  });

  it('allows matching role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);

    expect(guard.canActivate(createContext(UserRole.ADMIN))).toBe(true);
  });

  it('rejects wrong role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);

    expect(() => guard.canActivate(createContext(UserRole.LEARNER))).toThrow(
      ForbiddenException,
    );
  });
});
```

- [ ] **Step 2: Run RolesGuard test and confirm failure**

Run:

```powershell
pnpm test roles.guard
```

Expected: fails because `roles.guard.ts` does not exist.

- [ ] **Step 3: Implement RolesGuard**

Create `src/modules/auth/guards/roles.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/entities/user.entity';
import { ROLES_KEY } from '../constants/auth.constant';
import { AuthenticatedRequest } from '../types/authenticated-user.type';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (requiredRoles.includes(request.user.role)) {
      return true;
    }

    throw new ForbiddenException();
  }
}
```

- [ ] **Step 4: Run RolesGuard tests**

Run:

```powershell
pnpm test roles.guard
```

Expected: RolesGuard tests pass.

---

### Task 7: Wire AuthModule And AuthController

**Related skills:** `nestjs-patterns`, `test-driven-development`, `verification-before-completion`

**Files:**
- Create: `src/modules/auth/auth.module.ts`
- Create: `src/modules/auth/auth.controller.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create AuthModule**

Create `src/modules/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
```

- [ ] **Step 2: Create AuthController**

Create `src/modules/auth/auth.controller.ts`:

```ts
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
import { Response } from 'express';
import { UserRole } from '../users/entities/user.entity';
import { REFRESH_TOKEN_COOKIE_NAME } from './constants/auth.constant';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthService } from './auth.service';
import {
  AuthenticatedRequest,
  AuthenticatedUser,
} from './types/authenticated-user.type';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
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
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.refresh(
      request.cookies[REFRESH_TOKEN_COOKIE_NAME],
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
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(request.cookies[REFRESH_TOKEN_COOKIE_NAME]);
    response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/auth' });
    return { loggedOut: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
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

  private setRefreshCookie(response: Response, token: string): void {
    response.cookie(REFRESH_TOKEN_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.authService.isProduction(),
      path: '/auth',
      maxAge: this.authService.getRefreshCookieMaxAgeMs(),
    });
  }
}
```

- [ ] **Step 3: Import AuthModule in AppModule**

Modify `src/app.module.ts` imports and module list:

```ts
import { AuthModule } from './modules/auth/auth.module';
```

Add `AuthModule` after `UsersModule` in `imports`:

```ts
UsersModule,
AuthModule,
```

- [ ] **Step 4: Run build**

Run:

```powershell
pnpm build
```

Expected: build passes.

---

### Task 8: Add Auth E2E Tests

**Related skills:** `nestjs-patterns`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`

**Files:**
- Create: `test/auth.e2e-spec.ts`

- [ ] **Step 1: Create e2e test file**

Create `test/auth.e2e-spec.ts`:

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import cookieParser from 'cookie-parser';
import { AppModule } from './../src/app.module';
import {
  User,
  UserRole,
  UserStatus,
} from './../src/modules/users/entities/user.entity';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let usersRepository: Repository<User>;
  const password = 'Password1!';
  const suffix = Date.now();
  const learnerEmail = `auth-learner-${suffix}@example.com`;
  const inactiveEmail = `auth-inactive-${suffix}@example.com`;
  const adminEmail = `auth-admin-${suffix}@example.com`;
  const instructorEmail = `auth-instructor-${suffix}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    usersRepository = app.get(DataSource).getRepository(User);
    const hashedPassword = await bcrypt.hash(password, 10);
    await usersRepository.save([
      usersRepository.create({
        name: 'Auth Learner',
        email: learnerEmail,
        password: hashedPassword,
        role: UserRole.LEARNER,
        status: UserStatus.ACTIVE,
      }),
      usersRepository.create({
        name: 'Auth Inactive',
        email: inactiveEmail,
        password: hashedPassword,
        role: UserRole.LEARNER,
        status: UserStatus.INACTIVE,
      }),
      usersRepository.create({
        name: 'Auth Admin',
        email: adminEmail,
        password: hashedPassword,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      }),
      usersRepository.create({
        name: 'Auth Instructor',
        email: instructorEmail,
        password: hashedPassword,
        role: UserRole.INSTRUCTOR,
        status: UserStatus.ACTIVE,
      }),
    ]);
  });

  afterAll(async () => {
    await usersRepository.delete([
      { email: learnerEmail },
      { email: inactiveEmail },
      { email: adminEmail },
      { email: instructorEmail },
    ]);
    await app.close();
  });

  async function login(email: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const cookie = res.headers['set-cookie'][0] as string;
    return {
      accessToken: res.body.data.accessToken as string,
      cookie,
      body: res.body,
    };
  }

  it('logs in an active learner', async () => {
    const { body, cookie } = await login(learnerEmail);

    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.refreshToken).toBeUndefined();
    expect(body.data.user).toMatchObject({
      email: learnerEmail,
      role: 'Learner',
      status: 'Active',
    });
    expect(cookie).toContain('refreshToken=');
    expect(cookie).toContain('HttpOnly');
  });

  it('rejects wrong password with generic message', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: learnerEmail, password: 'Wrong1!' })
      .expect(401);

    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('rejects inactive account with Account disabled', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: inactiveEmail, password })
      .expect(403);

    expect(res.body.error.message).toBe('Account disabled');
  });

  it('rejects /auth/me without an access token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('returns current user with an access token', async () => {
    const { accessToken } = await login(learnerEmail);

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data).toMatchObject({
      email: learnerEmail,
      role: 'Learner',
      status: 'Active',
    });
  });

  it('refreshes with a valid refresh cookie', async () => {
    const { cookie } = await login(learnerEmail);

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.headers['set-cookie'][0]).toContain('refreshToken=');
  });

  it('logout invalidates the refresh session', async () => {
    const { cookie } = await login(learnerEmail);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookie)
      .expect(401);
  });

  it('enforces Admin role route', async () => {
    const admin = await login(adminEmail);
    const learner = await login(learnerEmail);

    await request(app.getHttpServer())
      .get('/auth/admin')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth/admin')
      .set('Authorization', `Bearer ${learner.accessToken}`)
      .expect(403);
  });

  it('enforces Instructor role route', async () => {
    const instructor = await login(instructorEmail);
    const learner = await login(learnerEmail);

    await request(app.getHttpServer())
      .get('/auth/instructor')
      .set('Authorization', `Bearer ${instructor.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth/instructor')
      .set('Authorization', `Bearer ${learner.accessToken}`)
      .expect(403);
  });

  it('enforces Learner role route', async () => {
    const learner = await login(learnerEmail);
    const admin = await login(adminEmail);

    await request(app.getHttpServer())
      .get('/auth/learner')
      .set('Authorization', `Bearer ${learner.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth/learner')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(403);
  });
});
```

- [ ] **Step 2: Run auth e2e and confirm behavior**

Run with compose infrastructure running:

```powershell
pnpm test:e2e -- auth.e2e-spec.ts
```

Expected: auth e2e passes. If the e2e runner does not accept the filename argument, run:

```powershell
pnpm test:e2e
```

Expected: all e2e specs pass.

---

### Task 9: Full Verification And Cleanup

**Related skills:** `verification-before-completion`, `systematic-debugging`, `requesting-code-review`

**Files:**
- Review all files touched by Tasks 1-8.

- [ ] **Step 1: Run unit tests**

Run:

```powershell
pnpm test
```

Expected: all unit tests pass.

- [ ] **Step 2: Run build**

Run:

```powershell
pnpm build
```

Expected: build passes.

- [ ] **Step 3: Run e2e tests**

Run with infrastructure running:

```powershell
pnpm test:e2e
```

Expected: health, users, and auth e2e suites pass.

- [ ] **Step 4: Run lint if tests and build pass**

Run:

```powershell
pnpm lint
```

Expected: lint completes. This command may modify files because the repo config uses `--fix`; inspect the diff afterward.

- [ ] **Step 5: Inspect git diff**

Run:

```powershell
git status --short
git diff -- .env.example package.json pnpm-lock.yaml src test docs
```

Expected: diff contains only T0-06 auth implementation, tests, env example, and plan/spec docs.

- [ ] **Step 6: Request code review before completion**

Use `requesting-code-review` skill or dispatch a review agent with this review focus:

```txt
Review T0-06 backend auth implementation for credential handling, refresh-token cookie security, Redis session revocation, Passport JWT validation, RBAC correctness, response format consistency, and test coverage gaps.
```

Expected: address any correctness/security findings before calling the work complete.

---

## Execution Notes

- Required execution skill: `subagent-driven-development` is recommended for task-by-task execution, especially Tasks 4-8.
- Alternative execution skill: `executing-plans` if implementation stays in the current session.
- Use `test-driven-development` for Tasks 2, 4, 5, 6, and 8.
- Use `nestjs-patterns` for Tasks 1-8.
- Use `systematic-debugging` for any failing test, build error, or unexpected auth behavior.
- Use `verification-before-completion` for Task 9 before stating the implementation is complete.
- Use `requesting-code-review` after full verification.
