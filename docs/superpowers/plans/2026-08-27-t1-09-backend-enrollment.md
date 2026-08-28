# T1-09 Backend Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement backend enrollment for T1-09 so Learners can enroll in published courses once, public course detail can expose optional `isEnrolled`, and Learners can list their enrolled courses with progress.

**Architecture:** Add a focused `EnrollmentsModule` with a TypeORM `Enrollment` entity, thin controller, and service-owned business rules. Keep public course APIs mostly unchanged, but add optional JWT handling to `GET /courses/public/:id` so authenticated Learners receive `isEnrolled` while anonymous users keep the current response shape.

**Tech Stack:** NestJS 11, TypeScript, TypeORM, PostgreSQL, Jest, Passport JWT, pnpm.

**Approved Design:** `docs/superpowers/specs/2026-08-27-t1-09-backend-enrollment-design.md`

**Repository Rules:** Work inside `online-study-platform-be`. Use relative imports in new backend code. Use `pnpm` only. Do not commit unless the user explicitly asks.

---

## File Structure

- Create: `src/modules/enrollments/entities/enrollment.entity.ts` for the `enrollments` table and learner/course relations.
- Create: `src/modules/enrollments/dto/enrollment.dto.ts` for response interfaces.
- Create: `src/modules/enrollments/enrollments.service.ts` for enrollment business rules, duplicate handling, and response mapping.
- Create: `src/modules/enrollments/enrollments.controller.ts` for learner enrollment endpoints.
- Create: `src/modules/enrollments/enrollments.controller.spec.ts` for controller delegation and guard/role metadata.
- Create: `src/modules/enrollments/enrollments.module.ts` for TypeORM registration and DI wiring.
- Create: `src/modules/enrollments/enrollments.service.spec.ts` for service TDD coverage.
- Create: `src/common/guards/optional-jwt-auth.guard.ts` for public course detail optional auth.
- Modify: `src/app.module.ts` to import `EnrollmentsModule`.
- Modify: `src/modules/courses/dto/course.dto.ts` to add `isEnrolled?: boolean` to `PublicCourseResponse`.
- Modify: `src/modules/courses/courses.service.ts` to inject enrollment repository and compute optional enrollment state.
- Modify: `src/modules/courses/courses.module.ts` to register `Enrollment` with TypeORM.
- Modify: `src/modules/courses/public-courses.controller.ts` to use optional auth on detail only.
- Modify: `src/modules/courses/courses.service.spec.ts` to cover anonymous and authenticated `isEnrolled` behavior.
- Modify: `src/modules/courses/public-courses.controller.spec.ts` to expect optional guard metadata and user forwarding.

---

### Task 1: Enrollment Entity And DTOs

**Related skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/enrollments/entities/enrollment.entity.ts`
- Create: `src/modules/enrollments/dto/enrollment.dto.ts`

- [ ] **Step 1: Create the entity file**

Add `src/modules/enrollments/entities/enrollment.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Course } from '../../courses/entities/course.entity';
import { User } from '../../users/entities/user.entity';

@Entity('enrollments')
@Unique('UQ_enrollments_learner_course', ['learnerId', 'courseId'])
export class Enrollment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'learner_id', type: 'uuid' })
  learnerId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'learner_id' })
  learner!: User;

  @Column({ name: 'course_id', type: 'uuid' })
  courseId!: string;

  @ManyToOne(() => Course, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'course_id' })
  course!: Course;

  @CreateDateColumn({ name: 'enrolled_at' })
  enrolledAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  progress!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: Create response DTO interfaces**

Add `src/modules/enrollments/dto/enrollment.dto.ts`:

```ts
export interface EnrollmentCourseInstructorResponse {
  id: string;
  name: string;
}

export interface EnrollmentCourseResponse {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string | null;
  instructorId: string;
  instructor?: EnrollmentCourseInstructorResponse;
}

export interface EnrollmentResponse {
  id: string;
  learnerId: string;
  courseId: string;
  progress: string;
  enrolledAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  course?: EnrollmentCourseResponse;
}
```

- [ ] **Step 3: Run a focused build check**

Run from `online-study-platform-be`:

```bash
pnpm build
```

Expected: build may still fail because the new entity is not wired yet only if unused-import rules are triggered. If it fails from unrelated existing files, record the exact error before continuing.

---

### Task 2: Enrollment Service Tests First

**Related skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/enrollments/enrollments.service.spec.ts`
- Later implementation target: `src/modules/enrollments/enrollments.service.ts`

- [ ] **Step 1: Write failing service tests**

Create `src/modules/enrollments/enrollments.service.spec.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from './entities/enrollment.entity';
import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;
  let enrollmentsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    exists: jest.Mock;
  };
  let coursesRepository: { findOne: jest.Mock };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const instructorId = '33333333-3333-4333-8333-333333333333';
  const enrolledAt = new Date('2026-08-27T00:00:00.000Z');
  const updatedAt = new Date('2026-08-27T00:01:00.000Z');

  const makeCourse = (overrides: Partial<Course> = {}): Course => ({
    id: courseId,
    title: 'Lap trinh NestJS',
    description: 'Khoa hoc nhap mon NestJS',
    category: 'Backend',
    thumbnail: null,
    status: CourseStatus.PUBLISHED,
    rejectReason: null,
    instructorId,
    instructor: {
      id: instructorId,
      name: 'Nguyen Van A',
      email: 'instructor@example.com',
    } as never,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt,
    ...overrides,
  });

  const makeEnrollment = (
    overrides: Partial<Enrollment> = {},
  ): Enrollment => ({
    id: '44444444-4444-4444-8444-444444444444',
    learnerId,
    learner: { id: learnerId } as never,
    courseId,
    course: makeCourse(),
    progress: '0.00',
    enrolledAt,
    completedAt: null,
    updatedAt,
    ...overrides,
  });

  beforeEach(() => {
    enrollmentsRepository = {
      create: jest.fn((input: Partial<Enrollment>) => input),
      save: jest.fn(async (input: Partial<Enrollment>) =>
        makeEnrollment(input),
      ),
      findOne: jest.fn(),
      find: jest.fn(),
      exists: jest.fn(),
    };
    coursesRepository = { findOne: jest.fn() };
    service = new EnrollmentsService(
      enrollmentsRepository as unknown as Repository<Enrollment>,
      coursesRepository as unknown as Repository<Course>,
    );
  });

  describe('enroll', () => {
    it('creates an enrollment for a published course with zero progress', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(null);

      const result = await service.enroll(learnerId, courseId);

      expect(coursesRepository.findOne).toHaveBeenCalledWith({
        where: { id: courseId },
      });
      expect(enrollmentsRepository.findOne).toHaveBeenCalledWith({
        where: { learnerId, courseId },
      });
      expect(enrollmentsRepository.create).toHaveBeenCalledWith({
        learnerId,
        courseId,
        progress: '0.00',
        completedAt: null,
      });
      expect(result).toEqual(
        expect.objectContaining({
          learnerId,
          courseId,
          progress: '0.00',
          completedAt: null,
        }),
      );
    });

    it.each([
      CourseStatus.DRAFT,
      CourseStatus.PENDING,
      CourseStatus.REJECTED,
    ])('rejects enrollment for %s courses', async (status) => {
      coursesRepository.findOne.mockResolvedValue(makeCourse({ status }));

      await expect(service.enroll(learnerId, courseId)).rejects.toEqual(
        new BadRequestException('Chỉ có thể đăng ký khóa học đã xuất bản'),
      );
      expect(enrollmentsRepository.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the course does not exist', async () => {
      coursesRepository.findOne.mockResolvedValue(null);

      await expect(service.enroll(learnerId, courseId)).rejects.toEqual(
        new NotFoundException('Course not found'),
      );
    });

    it('rejects duplicate enrollment with a friendly message', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(makeEnrollment());

      await expect(service.enroll(learnerId, courseId)).rejects.toEqual(
        new ConflictException('Bạn đã đăng ký khóa học này'),
      );
    });

    it('maps database unique constraint failures to duplicate enrollment', async () => {
      coursesRepository.findOne.mockResolvedValue(makeCourse());
      enrollmentsRepository.findOne.mockResolvedValue(null);
      enrollmentsRepository.save.mockRejectedValue({ code: '23505' });

      await expect(service.enroll(learnerId, courseId)).rejects.toEqual(
        new ConflictException('Bạn đã đăng ký khóa học này'),
      );
    });
  });

  describe('findMine', () => {
    it('returns current learner enrollments with course and instructor data', async () => {
      enrollmentsRepository.find.mockResolvedValue([makeEnrollment()]);

      const result = await service.findMine(learnerId);

      expect(enrollmentsRepository.find).toHaveBeenCalledWith({
        where: { learnerId },
        relations: { course: { instructor: true } },
        order: { enrolledAt: 'DESC' },
      });
      expect(result).toEqual([
        expect.objectContaining({
          learnerId,
          courseId,
          course: expect.objectContaining({
            id: courseId,
            instructor: { id: instructorId, name: 'Nguyen Van A' },
          }),
        }),
      ]);
    });
  });

  describe('isLearnerEnrolled', () => {
    it('returns true when an enrollment exists', async () => {
      enrollmentsRepository.exists.mockResolvedValue(true);

      await expect(
        service.isLearnerEnrolled(learnerId, courseId),
      ).resolves.toBe(true);
      expect(enrollmentsRepository.exists).toHaveBeenCalledWith({
        where: { learnerId, courseId },
      });
    });

    it('returns false when an enrollment does not exist', async () => {
      enrollmentsRepository.exists.mockResolvedValue(false);

      await expect(
        service.isLearnerEnrolled(learnerId, courseId),
      ).resolves.toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail for missing service**

Run:

```bash
pnpm test enrollments.service
```

Expected: FAIL because `src/modules/enrollments/enrollments.service.ts` does not exist yet or does not export `EnrollmentsService`.

---

### Task 3: Enrollment Service Implementation

**Related skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/enrollments/enrollments.service.ts`
- Test: `src/modules/enrollments/enrollments.service.spec.ts`

- [ ] **Step 1: Implement the service**

Create `src/modules/enrollments/enrollments.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import {
  EnrollmentCourseResponse,
  EnrollmentResponse,
} from './dto/enrollment.dto';
import { Enrollment } from './entities/enrollment.entity';

const DUPLICATE_ENROLLMENT_ERROR = 'Bạn đã đăng ký khóa học này';
const PUBLISHED_ONLY_ERROR = 'Chỉ có thể đăng ký khóa học đã xuất bản';

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
  ) {}

  async enroll(
    learnerId: string,
    courseId: string,
  ): Promise<EnrollmentResponse> {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.status !== CourseStatus.PUBLISHED) {
      throw new BadRequestException(PUBLISHED_ONLY_ERROR);
    }

    const existingEnrollment = await this.enrollmentsRepository.findOne({
      where: { learnerId, courseId },
    });

    if (existingEnrollment) {
      throw new ConflictException(DUPLICATE_ENROLLMENT_ERROR);
    }

    const enrollment = this.enrollmentsRepository.create({
      learnerId,
      courseId,
      progress: '0.00',
      completedAt: null,
    });

    try {
      const savedEnrollment = await this.enrollmentsRepository.save(enrollment);
      return this.toEnrollmentResponse(savedEnrollment);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(DUPLICATE_ENROLLMENT_ERROR);
      }
      throw error;
    }
  }

  async findMine(learnerId: string): Promise<EnrollmentResponse[]> {
    const enrollments = await this.enrollmentsRepository.find({
      where: { learnerId },
      relations: { course: { instructor: true } },
      order: { enrolledAt: 'DESC' },
    });

    return enrollments.map((enrollment) =>
      this.toEnrollmentResponse(enrollment),
    );
  }

  async isLearnerEnrolled(
    learnerId: string,
    courseId: string,
  ): Promise<boolean> {
    return this.enrollmentsRepository.exists({
      where: { learnerId, courseId },
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }

  private toEnrollmentResponse(enrollment: Enrollment): EnrollmentResponse {
    return {
      id: enrollment.id,
      learnerId: enrollment.learnerId,
      courseId: enrollment.courseId,
      progress: enrollment.progress,
      enrolledAt: enrollment.enrolledAt,
      completedAt: enrollment.completedAt,
      updatedAt: enrollment.updatedAt,
      course: enrollment.course
        ? this.toEnrollmentCourseResponse(enrollment.course)
        : undefined,
    };
  }

  private toEnrollmentCourseResponse(course: Course): EnrollmentCourseResponse {
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      thumbnail: course.thumbnail,
      instructorId: course.instructorId,
      instructor: course.instructor
        ? {
            id: course.instructor.id,
            name: course.instructor.name,
          }
        : undefined,
    };
  }
}
```

- [ ] **Step 2: Run service tests**

Run:

```bash
pnpm test enrollments.service
```

Expected: PASS for all `EnrollmentsService` tests.

---

### Task 4: Enrollment Controller Tests, Controller, And Module

**Related skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/enrollments/enrollments.controller.spec.ts`
- Create: `src/modules/enrollments/enrollments.controller.ts`
- Create: `src/modules/enrollments/enrollments.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/modules/enrollments/enrollments.controller.spec.ts`

- [ ] **Step 1: Write failing controller tests**

Create `src/modules/enrollments/enrollments.controller.spec.ts`:

```ts
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

describe('EnrollmentsController', () => {
  let controller: EnrollmentsController;
  let service: { enroll: jest.Mock; findMine: jest.Mock };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    service = { enroll: jest.fn(), findMine: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnrollmentsController],
      providers: [{ provide: EnrollmentsService, useValue: service }],
    }).compile();

    controller = module.get<EnrollmentsController>(EnrollmentsController);
  });

  it('delegates course enrollment to the service', async () => {
    await controller.enroll(courseId, learnerId);

    expect(service.enroll).toHaveBeenCalledWith(learnerId, courseId);
  });

  it('delegates current learner enrollment listing to the service', async () => {
    await controller.findMine(learnerId);

    expect(service.findMine).toHaveBeenCalledWith(learnerId);
  });
});

describe('EnrollmentsController auth metadata', () => {
  type HandlerName = 'enroll' | 'findMine';

  const handlerOf = (methodName: HandlerName): unknown =>
    Object.getOwnPropertyDescriptor(
      EnrollmentsController.prototype,
      methodName,
    )?.value;

  it('uses strict auth and roles guards at controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, EnrollmentsController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });

  it.each<HandlerName>(['enroll', 'findMine'])(
    'restricts %s to Learners',
    (handlerName) => {
      expect(Reflect.getMetadata(ROLES_KEY, handlerOf(handlerName))).toEqual([
        UserRole.LEARNER,
      ]);
    },
  );
});
```

- [ ] **Step 2: Run controller tests to verify they fail for missing controller**

Run:

```bash
pnpm test enrollments.controller
```

Expected: FAIL because `src/modules/enrollments/enrollments.controller.ts` does not exist yet or does not export `EnrollmentsController`.

- [ ] **Step 3: Create controller**

Create `src/modules/enrollments/enrollments.controller.ts`:

```ts
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { EnrollmentsService } from './enrollments.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post('courses/:courseId/enrollments')
  @Roles(UserRole.LEARNER)
  @HttpCode(HttpStatus.CREATED)
  enroll(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') learnerId: string,
  ) {
    return this.enrollmentsService.enroll(learnerId, courseId);
  }

  @Get('enrollments/me')
  @Roles(UserRole.LEARNER)
  findMine(@CurrentUser('id') learnerId: string) {
    return this.enrollmentsService.findMine(learnerId);
  }
}
```

- [ ] **Step 4: Create module**

Create `src/modules/enrollments/enrollments.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { Enrollment } from './entities/enrollment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Enrollment, Course])],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
```

- [ ] **Step 5: Register module in app module**

Modify `src/app.module.ts`:

```ts
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
```

Add `EnrollmentsModule` to the `imports` array after `LessonsModule` or near `CoursesModule`:

```ts
CoursesModule,
LessonsModule,
EnrollmentsModule,
NotificationsModule,
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
pnpm test enrollments.service
pnpm test enrollments.controller
pnpm build
```

Expected: tests pass and build succeeds. If build fails due existing absolute imports such as `src/...`, fix only if this new work triggers the failure path.

---

### Task 5: Optional JWT Guard

**Related skills:** `test-driven-development`, `nestjs-patterns`, `systematic-debugging`

**Files:**
- Create: `src/common/guards/optional-jwt-auth.guard.ts`
- Later test target: `src/modules/courses/public-courses.controller.spec.ts`

- [ ] **Step 1: Create optional auth guard**

Create `src/common/guards/optional-jwt-auth.guard.ts`:

```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JWT_STRATEGY_NAME } from '../constants/auth.constant';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard(JWT_STRATEGY_NAME) {
  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<{ headers?: { authorization?: string } }>();
    const authorization = request.headers?.authorization;

    if (!authorization) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    _error: unknown,
    user: TUser | false | null,
  ): TUser | null {
    return user || null;
  }
}
```

- [ ] **Step 2: Run build to catch guard issues**

Run:

```bash
pnpm build
```

Expected: build succeeds.

---

### Task 6: Public Course Detail With `isEnrolled`

**Related skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Modify: `src/modules/courses/dto/course.dto.ts`
- Modify: `src/modules/courses/courses.module.ts`
- Modify: `src/modules/courses/courses.service.ts`
- Modify: `src/modules/courses/public-courses.controller.ts`
- Modify: `src/modules/courses/courses.service.spec.ts`
- Modify: `src/modules/courses/public-courses.controller.spec.ts`

- [ ] **Step 1: Write failing service tests for `isEnrolled`**

Modify `src/modules/courses/courses.service.spec.ts` constructor setup to include an enrollment repository mock before updating implementation:

```ts
let enrollmentRepo: { exists: jest.Mock };
```

Initialize it in `beforeEach`:

```ts
enrollmentRepo = { exists: jest.fn() };
```

Update `new CoursesService(...)` to pass the enrollment repository as the final dependency:

```ts
service = new CoursesService(
  repo as unknown as Repository<Course>,
  configService as never,
  minioClient as never,
  notificationsService as unknown as NotificationsService,
  dataSource as unknown as DataSource,
  enrollmentRepo as never,
);
```

Add tests inside `describe('getPublished', ...)`:

```ts
it('omits isEnrolled for anonymous public course detail', async () => {
  repo.findOne.mockResolvedValue(makeCourse({ status: CourseStatus.PUBLISHED }));

  const result = await service.getPublished(courseId, null);

  expect(result).not.toHaveProperty('isEnrolled');
  expect(enrollmentRepo.exist).not.toHaveBeenCalled();
});

it('includes isEnrolled for authenticated Learners', async () => {
  const learnerId = '44444444-4444-4444-8444-444444444444';
  repo.findOne.mockResolvedValue(makeCourse({ status: CourseStatus.PUBLISHED }));
  enrollmentRepo.exist.mockResolvedValue(true);

  const result = await service.getPublished(courseId, {
    id: learnerId,
    email: 'learner@example.com',
    role: 'Learner' as never,
    status: 'Active' as never,
  });

  expect(enrollmentRepo.exist).toHaveBeenCalledWith({
    where: { learnerId, courseId },
  });
  expect(result.isEnrolled).toBe(true);
});

it('returns isEnrolled false for authenticated non-Learners', async () => {
  repo.findOne.mockResolvedValue(makeCourse({ status: CourseStatus.PUBLISHED }));

  const result = await service.getPublished(courseId, {
    id: instructorId,
    email: 'instructor@example.com',
    role: 'Instructor' as never,
    status: 'Active' as never,
  });

  expect(enrollmentRepo.exist).not.toHaveBeenCalled();
  expect(result.isEnrolled).toBe(false);
});
```

- [ ] **Step 2: Write failing controller tests for optional auth forwarding**

Modify `src/modules/courses/public-courses.controller.spec.ts`:

```ts
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
```

Update the detail delegation test:

```ts
it('delegates public course detail by id with optional current user', async () => {
  const user = {
    id: '44444444-4444-4444-8444-444444444444',
    email: 'learner@example.com',
    role: 'Learner',
    status: 'Active',
  } as never;

  await controller.getPublished(courseId, user);

  expect(service.getPublished).toHaveBeenCalledWith(courseId, user);
});
```

Update the metadata test so only `getPublished` has `OptionalJwtAuthGuard`:

```ts
it.each<HandlerName>([
  'findPublished',
  'findPublishedSuggestions',
  'findLatestPublished',
])('keeps %s public without guards', (handlerName) => {
  expect(Reflect.getMetadata(ROLES_KEY, handlerOf(handlerName))).toBeUndefined();
  expect(Reflect.getMetadata(GUARDS_METADATA, handlerOf(handlerName))).toBeUndefined();
});

it('uses optional JWT auth only on public course detail', () => {
  expect(Reflect.getMetadata(ROLES_KEY, handlerOf('getPublished'))).toBeUndefined();
  expect(Reflect.getMetadata(GUARDS_METADATA, handlerOf('getPublished'))).toEqual([
    OptionalJwtAuthGuard,
  ]);
});
```

- [ ] **Step 3: Run failing course tests**

Run:

```bash
pnpm test courses.service public-courses.controller
```

Expected: FAIL because implementation has not been updated.

- [ ] **Step 4: Update DTO**

Modify `src/modules/courses/dto/course.dto.ts`:

```ts
export interface PublicCourseResponse {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string | null;
  instructorId: string;
  instructor?: PublicCourseInstructorSummary;
  createdAt: Date;
  updatedAt: Date;
  isEnrolled?: boolean;
}
```

- [ ] **Step 5: Register Enrollment repository in CoursesModule**

Modify `src/modules/courses/courses.module.ts`:

```ts
import { Enrollment } from '../enrollments/entities/enrollment.entity';
```

Update TypeORM feature registration:

```ts
imports: [TypeOrmModule.forFeature([Course, Enrollment]), NotificationsModule],
```

- [ ] **Step 6: Update CoursesService constructor and detail logic**

Modify `src/modules/courses/courses.service.ts` imports:

```ts
import { AuthenticatedUser } from '../auth/dto/auth.dto';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { UserRole } from '../users/entities/user.entity';
```

Add constructor dependency after `dataSource`:

```ts
@InjectRepository(Enrollment)
private readonly enrollmentsRepository: Repository<Enrollment>,
```

Change `getPublished` signature and body:

```ts
async getPublished(
  id: string,
  currentUser?: AuthenticatedUser | null,
): Promise<PublicCourseResponse> {
  const course = await this.coursesRepository.findOne({
    where: { id, status: CourseStatus.PUBLISHED },
    relations: { instructor: true },
  });

  if (!course) {
    throw new NotFoundException('Course not found');
  }

  const response = this.toPublicCourseResponse(course);

  if (!currentUser) {
    return response;
  }

  if (currentUser.role !== UserRole.LEARNER) {
    return { ...response, isEnrolled: false };
  }

  const isEnrolled = await this.enrollmentsRepository.exists({
    where: { learnerId: currentUser.id, courseId: id },
  });

  return { ...response, isEnrolled };
}
```

- [ ] **Step 7: Update public courses controller**

Modify `src/modules/courses/public-courses.controller.ts` imports:

```ts
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { AuthenticatedUser } from '../auth/dto/auth.dto';
```

Change detail method:

```ts
@Get(':id')
@UseGuards(OptionalJwtAuthGuard)
getPublished(
  @Param('id', ParseUUIDPipe) id: string,
  @CurrentUser() user?: AuthenticatedUser | null,
) {
  return this.coursesService.getPublished(id, user);
}
```

- [ ] **Step 8: Run course tests**

Run:

```bash
pnpm test courses.service public-courses.controller
```

Expected: PASS.

---

### Task 7: Build And Import Cleanup

**Related skills:** `verification-before-completion`, `systematic-debugging`

**Files:**
- Modify only files needed to fix build or test failures.

- [ ] **Step 1: Run focused enrollment tests**

Run:

```bash
pnpm test enrollments.service
```

Expected: PASS.

- [ ] **Step 2: Run focused course tests**

Run:

```bash
pnpm test courses.service public-courses.controller
```

Expected: PASS.

- [ ] **Step 3: Run backend build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: If build fails, fix only T1-09-related issues**

Use this checklist:

- New imports must be relative, not `src/...`.
- `CoursesService` tests must pass the new constructor dependency everywhere.
- `OptionalJwtAuthGuard` must not throw on missing auth header.
- `PublicCourseResponse.isEnrolled` must be optional.
- `Enrollment.progress` must stay string-compatible because PostgreSQL decimal returns strings.

---

### Task 8: Final Verification

**Related skills:** `verification-before-completion`

**Files:**
- No code edits unless verification fails.

- [ ] **Step 1: Run all unit tests**

Run:

```bash
pnpm test
```

Expected: PASS. If this fails in unrelated existing tests, record the failing suite and rerun focused T1-09 tests to confirm this work is still green.

- [ ] **Step 2: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Optional lint**

Run only if the user wants lint verification, because this script can mutate files:

```bash
pnpm lint
```

Expected: PASS after auto-fix or no errors. Review any files changed by lint before reporting completion.

---

## Manual Smoke Checklist

- Start backend with reachable PostgreSQL, Redis, MongoDB, and MinIO.
- Create or use a Learner account.
- Create or use a published course.
- Call `GET /courses/public/:id` without auth and confirm `isEnrolled` is absent.
- Call `GET /courses/public/:id` with Learner auth before enrollment and confirm `isEnrolled: false`.
- Call `POST /courses/:courseId/enrollments` with Learner auth and confirm progress is `0.00` and `completedAt` is `null`.
- Call `POST /courses/:courseId/enrollments` again and confirm `409` with `Bạn đã đăng ký khóa học này`.
- Call `GET /courses/public/:id` with Learner auth after enrollment and confirm `isEnrolled: true`.
- Call `GET /enrollments/me` and confirm the course and instructor summary are present.

## Completion Criteria

- `Enrollment` entity matches the thesis-backed shape including `completedAt` and decimal `progress`.
- Enroll endpoint is learner-only and enforces published-only courses.
- Duplicate enrollments are blocked by service logic and DB uniqueness.
- Public course detail keeps anonymous shape unchanged while adding `isEnrolled` for authenticated users.
- My enrollments endpoint returns current Learner enrollments only.
- Focused tests pass: `pnpm test enrollments.service`, `pnpm test enrollments.controller`, and `pnpm test courses.service public-courses.controller`.
- Backend build passes: `pnpm build`.
