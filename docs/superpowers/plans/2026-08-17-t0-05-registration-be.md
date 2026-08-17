# T0-05 Registration (BE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `POST /users` (register) on the BE — creates a `User` (role `Learner`, status `Active`) with a bcryptjs-hashed password, validated via global `ValidationPipe`, duplicate email → 409, per card T0-05.

**Architecture:** UsersModule (scaffold already exists, trimmed to `POST /users` only) with a TypeORM `User` entity registered via `autoLoadEntities` + `synchronize: true`. Shared `configureApp()` helper applies the global `ValidationPipe` + CORS in both `main.ts` and the e2e bootstrap. Uniqueness is enforced by a DB unique constraint; the service catches PG error `23505` and maps it to `ConflictException('Email already registered')`. Password excluded from responses via `@Exclude()` + `ClassSerializerInterceptor`.

**Tech Stack:** NestJS 11, TypeORM (PostgreSQL), class-validator/class-transformer, bcryptjs, jest (unit `*.spec.ts` colocated, e2e in `test/`), supertest.

**Context:** Work in `F:\Cntt\KLTN\online-study-platform-be` on branch `feature/t0-05-registration` (created; contains spec commits `bfdb67d` `feb56b7` `e14b7bc`). The `nest g resource users` scaffold is **uncommitted** in the working tree: `package.json`/`pnpm-lock.yaml` (added `@nestjs/mapped-types`), `src/app.module.ts` (UsersModule registered), `src/modules/users/` (controller/service/specs/dto/entity stubs). All imports MUST be **relative** (jest cannot resolve `src/...` — proven failure, see `src/modules/file/file.module.ts` T0-03 fix). Spec: `docs/superpowers/specs/2026-08-17-t0-05-registration-design.md`. TypeORM is `^1.1.0` — if any decorator API errors on build, check `node_modules/typeorm` docs before changing code. e2e requires compose infra running (postgres/redis/mongodb/minio).

---

### Task 1: Dependencies (class-validator, class-transformer, bcryptjs; drop @nestjs/mapped-types)

**Skills:** none required — mechanical package.json change; verify with `pnpm`.

**Files:**
- Modify: `package.json` (dependencies block)
- Modify: `pnpm-lock.yaml` (via pnpm)

- [ ] **Step 1: Remove `@nestjs/mapped-types` and add the three deps**

Edit `package.json`: remove the line `"@nestjs/mapped-types": "*",` and add after `"@nestjs/config"` (alphabetical order):

```json
"bcryptjs": "^3.0.2",
```

and in the `dependencies` block add:

```json
"class-transformer": "^0.5.1",
"class-validator": "^0.14.2",
```

Use the installed `pnpm` to install the pinned versions instead of hand-editing when in doubt:

```bash
pnpm remove @nestjs/mapped-types
pnpm add bcryptjs class-transformer class-validator
```

- [ ] **Step 2: Verify**

Run: `pnpm install` then `node -e "require('bcryptjs'); require('class-transformer'); require('class-validator'); console.log('deps ok')"`
Expected: prints `deps ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add bcryptjs, class-transformer, class-validator; drop mapped-types"
```

---

### Task 2: User entity + role/status enums

**Skills:** [nestjs-patterns](skill) - entity conventions with TypeORM decorators in NestJS; keep the entity a plain data holder with no business logic.

**Files:**
- Create: `src/modules/users/entities/user.entity.ts`

- [ ] **Step 1: Write the entity**

`src/modules/users/entities/user.entity.ts` (exact content):

```typescript
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'Admin',
  INSTRUCTOR = 'Instructor',
  LEARNER = 'Learner',
}

export enum UserStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Exclude()
  @Column()
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.LEARNER })
  role: UserRole;

  @Column({ type: 'varchar', nullable: true })
  avatar: string | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm build`
Expected: exit 0 (the scaffold's absolute imports in `users.controller.ts`/`users.service.ts` are fixed in Task 6; if `pnpm build` fails on them NOW, proceed — they are fixed later, or fix them first with the relative imports from Task 6 Step 1).

- [ ] **Step 3: Commit**

```bash
git add src/modules/users/entities/user.entity.ts
git commit -m "feat(users): User entity with role/status enums per thesis shape"
```

---

### Task 3: CreateUserDto with class-validator rules

**Skills:** [nestjs-patterns](skill) - DTO validation with class-validator decorators; `forbidNonWhitelisted` on the global pipe rejects unknown fields.

**Files:**
- Create: `src/modules/users/dto/user.dto.ts` (overwrite the scaffold stub containing empty `CreateUserDto`/`UpdateUserDto` — remove `UpdateUserDto`)

- [ ] **Step 1: Write the DTO**

`src/modules/users/dto/user.dto.ts` (exact content — note: `@nestjs/mapped-types` was removed, so the old `PartialType(UpdateUserDto)` import would break; the file is fully replaced):

```typescript
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @Length(2, 100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;

  @IsEmail()
  email: string;

  @Matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message:
      'Password must be at least 8 characters and include letters, numbers and a special character',
  })
  password: string;
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/modules/users/dto/user.dto.ts
git commit -m "feat(users): CreateUserDto validation rules (name, email, password policy)"
```

---

### Task 4: Shared configureApp helper — global ValidationPipe + CORS

**Skills:** [nestjs-patterns](skill) - app bootstrap configuration (pipes, CORS) in NestJS; DRY helper used by `main.ts` and e2e.

**Files:**
- Create: `src/common/configure-app.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write the helper**

`src/common/configure-app.ts` (exact content):

```typescript
import { INestApplication, ValidationPipe } from '@nestjs/common';

export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({ origin: true, credentials: true });
}
```

- [ ] **Step 2: Use it in main.ts**

Replace the body of `bootstrap()` in `src/main.ts`:

```typescript
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<string>('PORT');
  configureApp(app);
  await app.listen(port);
}
void bootstrap();
```

- [ ] **Step 3: Verify**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/common/configure-app.ts src/main.ts
git commit -m "feat(app): global ValidationPipe + CORS via shared configureApp helper"
```

---

### Task 5: UsersService.create — TDD (hash, normalize, 23505 → 409)

**Skills:** [test-driven-development](skill) - write the failing unit spec first, watch it fail, then implement; [nestjs-patterns](skill) - service with `@InjectRepository` + mocked repository in spec.

**Files:**
- Create: `src/modules/users/users.service.spec.ts` (overwrite scaffold stub)
- Modify: `src/modules/users/users.service.ts`
- Modify: `src/modules/users/users.module.ts` (register `TypeOrmModule.forFeature([User])`)

- [ ] **Step 1: Write the failing unit spec**

`src/modules/users/users.service.spec.ts` (exact content — relative imports only):

```typescript
import { ConflictException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/user.dto';
import { User, UserRole, UserStatus } from './entities/user.entity';

function duplicateKeyError(): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO "users"',
    [],
    Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    }),
  );
}

describe('UsersService', () => {
  let service: UsersService;
  let repo: { create: jest.Mock; save: jest.Mock };

  const dto: CreateUserDto = {
    name: '  Nguyen Van A  ',
    email: '  Test@Example.COM ',
    password: 'abcd1234!',
  };

  beforeEach(() => {
    repo = {
      create: jest.fn((input: Partial<User>) => input),
      save: jest.fn(),
    };
    service = new UsersService(repo as unknown as Repository<User>);
  });

  it('hashes the password before saving and returns the saved user', async () => {
    const saved = {
      id: 'b7f8c2a0-1111-4a11-9f0a-000000000001',
      name: 'Nguyen Van A',
      email: 'test@example.com',
      password: '$2b$10$abcdefghijklmnopqrstuv',
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
      avatar: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User;
    repo.save.mockResolvedValue(saved);

    const result = await service.create(dto);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Nguyen Van A',
        email: 'test@example.com',
        password: expect.stringMatching(/^\$2[ab]\$\d+\$/),
      }),
    );
    const savedInput = repo.create.mock.calls[0][0] as User;
    expect(savedInput.password).not.toBe(dto.password);
    expect(result).toEqual(saved);
  });

  it('normalizes email (trim + lowercase) and trims the name', async () => {
    repo.save.mockResolvedValue({} as User);

    await service.create(dto);

    const savedInput = repo.create.mock.calls[0][0] as User;
    expect(savedInput.email).toBe('test@example.com');
    expect(savedInput.name).toBe('Nguyen Van A');
  });

  it('maps a unique-violation error to ConflictException', async () => {
    repo.save.mockRejectedValue(duplicateKeyError());

    await expect(service.create(dto)).rejects.toEqual(
      new ConflictException('Email already registered'),
    );
  });

  it('rethrows unrelated database errors', async () => {
    const error = new Error('connection reset');
    repo.save.mockRejectedValue(error);

    await expect(service.create(dto)).rejects.toBe(error);
  });
});
```

- [ ] **Step 2: Run it — verify it FAILS**

Run: `pnpm test -- src/modules/users/users.service.spec.ts`
Expected: FAIL — the scaffold service has no constructor/`create` matching the spec (constructor injection error), proving the tests are real.

- [ ] **Step 3: Implement the service**

`src/modules/users/users.service.ts` (exact content):

```typescript
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { CreateUserDto } from './dto/user.dto';
import { User } from './entities/user.entity';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const { name, email, password } = createUserDto;
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = this.usersRepository.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
    });

    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { driverError?: { code?: string } })
          .driverError?.code === PG_UNIQUE_VIOLATION
      ) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }
}
```

- [ ] **Step 4: Register the entity with TypeORM**

`src/modules/users/users.module.ts` (exact content):

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 5: Run the unit tests — verify they PASS**

Run: `pnpm test -- src/modules/users/users.service.spec.ts`
Expected: 4/4 PASS (hash+returns, normalize, 409 mapping, rethrow).

- [ ] **Step 6: Commit**

```bash
git add src/modules/users/users.service.ts src/modules/users/users.service.spec.ts src/modules/users/users.module.ts
git commit -m "feat(users): create() with bcrypt hash, email normalization, 23505 -> 409"
```

---

### Task 6: Controller scoped to POST /users (relative imports, serialized response)

**Skills:** [nestjs-patterns](skill) - controllers returning DTOs via `ClassSerializerInterceptor`; never expose the password hash.

**Files:**
- Modify: `src/modules/users/users.controller.ts`
- Modify: `src/modules/users/users.controller.spec.ts`

- [ ] **Step 1: Trim the controller and fix imports**

`src/modules/users/users.controller.ts` (exact content — scaffold's absolute `src/modules/users/...` imports replaced with relative; CRUD endpoints removed; `ClassSerializerInterceptor` drops `password` via `@Exclude`):

```typescript
import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @UseInterceptors(ClassSerializerInterceptor)
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }
}
```

- [ ] **Step 2: Update the controller spec**

`src/modules/users/users.controller.spec.ts` (exact content):

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/user.dto';

describe('UsersController', () => {
  let controller: UsersController;
  let service: { create: jest.Mock };

  beforeEach(async () => {
    service = { create: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates create to the service', async () => {
    const dto: CreateUserDto = {
      name: 'Nguyen Van A',
      email: 'a@example.com',
      password: 'abcd1234!',
    };
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });
});
```

- [ ] **Step 3: Verify unit tests + build**

Run: `pnpm test` (all unit tests: health 5 + users 5)
Expected: 10/10 PASS.
Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/users/users.controller.ts src/modules/users/users.controller.spec.ts
git commit -m "feat(users): scope controller to POST /users, serialize response, relative imports"
```

---

### Task 7: e2e — register happy path, duplicate 409, validation 400s (needs compose infra)

**Skills:** [test-driven-development](skill) - e2e spec written against the real AppModule; [verification-before-completion](skill) - assert actual HTTP responses, not just status codes.

**Files:**
- Create: `test/users.e2e-spec.ts`

- [ ] **Step 1: Boot infra**

Run (from `F:\Cntt\KLTN` root, `.env` must exist — see root README):

```bash
docker compose up -d postgres redis mongodb minio
```

Wait for healthy: `docker compose ps` shows all four `(healthy)`.

- [ ] **Step 2: Write the e2e spec**

`test/users.e2e-spec.ts` (exact content — uses `configureApp` so the pipe config under test is identical to production; relative imports; cleanup deletes only the rows this spec created):

```typescript
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/common/configure-app';
import { User } from './../src/modules/users/entities/user.entity';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const email = `e2e-register-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await dataSource.getRepository(User).delete({ email });
    await app.close();
  });

  it('creates a Learner with status Active and never returns the password', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Nguyen Van A', email, password: 'abcd1234!' })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'Nguyen Van A',
      email,
      role: 'Learner',
      status: 'Active',
      avatar: null,
    });
    expect(res.body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.body.password).toBeUndefined();

    const row = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email });
    expect(row.password).not.toBe('abcd1234!');
    expect(row.password).toMatch(/^\$2[ab]\$\d+\$/);
  });

  it('rejects a duplicate email with 409 "Email already registered"', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Another User', email, password: 'xyz98765#' })
      .expect(409);

    expect(res.body.message).toBe('Email already registered');
  });

  it('rejects an invalid email with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Nguyen Van A', email: 'not-an-email', password: 'abcd1234!' })
      .expect(400);

    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it('rejects a weak password with 400 and the policy message', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Nguyen Van A', email: `weak-${email}`, password: 'abc12' })
      .expect(400);

    expect(JSON.stringify(res.body.message)).toContain(
      'Password must be at least 8 characters and include letters, numbers and a special character',
    );
  });

  it('rejects unknown fields with 400 (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Nguyen Van A', email: `extra-${email}`, password: 'abcd1234!', phone: '123' })
      .expect(400);

    expect(JSON.stringify(res.body.message)).toContain('phone');
  });
});
```

- [ ] **Step 3: Run the e2e spec — verify it PASSES**

Run: `pnpm test:e2e -- users.e2e-spec.ts`
Expected: 5/5 PASS (plus the existing health e2e when run in full: `pnpm test:e2e`).

- [ ] **Step 4: Commit**

```bash
git add test/users.e2e-spec.ts
git commit -m "test(e2e): register happy path, duplicate 409, validation 400s"
```

---

### Task 8: Full verification pass + final commit

**Skills:** [verification-before-completion](skill) - run every gate and confirm output before claiming done.

**Files:**
- None (verification only)

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: exit 0, no errors (prettier/eslint clean).

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: exit 0, `dist/` produced.

- [ ] **Step 3: Unit tests**

Run: `pnpm test`
Expected: 10/10 PASS.

- [ ] **Step 4: Full e2e (health + users)**

Run: `pnpm test:e2e`
Expected: 6/6 PASS (1 health + 5 users).

- [ ] **Step 5: Manual smoke against compose BE**

If the `be` service is not already rebuilt, run from root: `docker compose up -d --build be`. Then:

```bash
curl -s -X POST http://localhost:3001/users -H "Content-Type: application/json" -d "{\"name\":\"Smoke Test\",\"email\":\"smoke-$(Get-Random)@example.com\",\"password\":\"abcd1234!\"}"
```

Expected: 201 JSON body with `role: "Learner"`, `status: "Active"`, **no** `password` field, `created_at`/`updated_at` populated. Repeat the same request → 409. Delete the smoke row in psql (port 5433) afterwards so no test data lingers:
`DELETE FROM users WHERE email LIKE 'smoke-%@example.com';`

- [ ] **Step 6: Verify working tree state**

Run: `git status`
Expected: clean (all scaffold + implementation committed on `feature/t0-05-registration`).

- [ ] **Step 7: Final commit if anything drifted**

If any verification step forced a code change, commit it with a message describing the fix; otherwise skip (no empty commits).
