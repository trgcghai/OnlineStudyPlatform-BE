# T1-02 Backend Course Status Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the T1-02 backend course status machine with Instructor publish requests, `Rejected + rejectReason`, and MongoDB queue notifications for course approval.

**Architecture:** Course state remains in PostgreSQL through TypeORM. Approval request notifications use the existing MongoDB notification module with Mongoose and a `course_approval` queue enum. Course business rules stay in `CoursesService`; controllers remain thin and delegate to services.

**Tech Stack:** NestJS 11, TypeScript, TypeORM/PostgreSQL, Mongoose/MongoDB, Jest, pnpm.

---

## Ground Rules

- Follow TDD: write or update the failing test first, run it and confirm the expected failure, then implement the minimal production code.
- Use `pnpm` only in `online-study-platform-be`.
- Do not use `src/...` absolute imports in backend code; Jest does not resolve that alias. Use relative imports.
- Do not commit unless the user explicitly asks for a commit. Commit steps are intentionally omitted to respect repository instructions.
- `pnpm lint` runs ESLint with `--fix` and can mutate files; run it only after the requested implementation is complete.

## File Map

| File | Responsibility |
|---|---|
| `src/modules/notifications/entities/notification.entity.ts` | Mongoose notification schema, `NotificationType`, `NotificationQueue` |
| `src/modules/notifications/notifications.module.ts` | Registers Mongoose model and exports `NotificationsService` |
| `src/modules/notifications/notifications.service.ts` | Creates queue notifications and supports compensation delete by id |
| `src/modules/notifications/notifications.service.spec.ts` | Unit coverage for queue notification persistence |
| `src/modules/courses/entities/course.entity.ts` | `CourseStatus.REJECTED` and `rejectReason` persistence |
| `src/modules/courses/dto/course.dto.ts` | Response shape includes `rejectReason` |
| `src/modules/courses/courses.module.ts` | Imports `NotificationsModule` |
| `src/modules/courses/courses.service.ts` | Transition guard, rejected revision handling, request publish transaction |
| `src/modules/courses/courses.service.spec.ts` | Course status machine, request publish, rollback/compensation behavior |
| `src/modules/courses/courses.controller.ts` | `POST /courses/:id/request-publish` Instructor endpoint |
| `src/modules/courses/courses.controller.spec.ts` | Controller delegation and RBAC handler coverage |

---

### Task 1: Notification Queue Persistence

**Related Skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Modify: `src/modules/notifications/entities/notification.entity.ts`
- Modify: `src/modules/notifications/notifications.module.ts`
- Modify: `src/modules/notifications/notifications.service.ts`
- Test: `src/modules/notifications/notifications.service.spec.ts`

- [ ] **Step 1: Write failing notification service tests**

Replace `src/modules/notifications/notifications.service.spec.ts` with:

```ts
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import {
  Notification,
  NotificationQueue,
  NotificationType,
} from './entities/notification.entity';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationModel: jest.Mock;
  let save: jest.Mock;
  let findByIdAndDelete: jest.Mock;

  beforeEach(() => {
    save = jest.fn();
    findByIdAndDelete = jest.fn();
    notificationModel = jest.fn().mockImplementation((input: unknown) => ({
      ...input,
      _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
      save,
    }));
    notificationModel.findByIdAndDelete = findByIdAndDelete;

    service = new NotificationsService(
      notificationModel as unknown as never,
    );
  });

  it('creates a queue notification with the course approval queue enum', async () => {
    const saved = {
      _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
      type: NotificationType.QUEUE,
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Yêu cầu duyệt khóa học',
      message: 'Nguyen Van A đã gửi yêu cầu xuất bản khóa học "NestJS".',
      actionUrl: '/admin/courses/approvals',
      metadata: {
        courseId: '33333333-3333-4333-8333-333333333333',
        instructorId: '11111111-1111-4111-8111-111111111111',
      },
      sentAt: new Date('2026-08-24T00:00:00Z'),
    };
    save.mockResolvedValue(saved);

    const result = await service.createQueueNotification({
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Yêu cầu duyệt khóa học',
      message: 'Nguyen Van A đã gửi yêu cầu xuất bản khóa học "NestJS".',
      actionUrl: '/admin/courses/approvals',
      metadata: {
        courseId: '33333333-3333-4333-8333-333333333333',
        instructorId: '11111111-1111-4111-8111-111111111111',
      },
      sentAt: new Date('2026-08-24T00:00:00Z'),
    });

    expect(notificationModel).toHaveBeenCalledWith({
      type: NotificationType.QUEUE,
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Yêu cầu duyệt khóa học',
      message: 'Nguyen Van A đã gửi yêu cầu xuất bản khóa học "NestJS".',
      actionUrl: '/admin/courses/approvals',
      metadata: {
        courseId: '33333333-3333-4333-8333-333333333333',
        instructorId: '11111111-1111-4111-8111-111111111111',
      },
      sentAt: new Date('2026-08-24T00:00:00Z'),
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toBe(saved);
  });

  it('deletes a notification by id for cross-store compensation', async () => {
    const notificationId = new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8');
    findByIdAndDelete.mockResolvedValue({ _id: notificationId });

    await service.deleteNotification(notificationId);

    expect(findByIdAndDelete).toHaveBeenCalledWith(notificationId);
  });
});
```

- [ ] **Step 2: Run the notification test and verify RED**

Run: `pnpm test notifications.service`

Expected: FAIL because `NotificationQueue`, `createQueueNotification`, constructor model injection, and `deleteNotification` are not implemented.

- [ ] **Step 3: Implement notification schema enum**

Update `src/modules/notifications/entities/notification.entity.ts` to add `NotificationQueue` and constrain `queue`:

```ts
export enum NotificationQueue {
  COURSE_APPROVAL = 'course_approval',
}
```

Change the queue property to:

```ts
  @Prop({
    type: String,
    enum: NotificationQueue,
    required: false,
    index: true,
  })
  queue?: NotificationQueue;
```

- [ ] **Step 4: Register and export notification persistence**

Replace `src/modules/notifications/notifications.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Notification,
  NotificationSchema,
} from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

- [ ] **Step 5: Implement notification service persistence**

Replace `src/modules/notifications/notifications.service.ts` with:

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationQueue,
  NotificationType,
} from './entities/notification.entity';

export interface CreateQueueNotificationInput {
  queue: NotificationQueue;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  sentAt?: Date;
}

export interface CreatedNotificationRef {
  _id: Types.ObjectId | string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async createQueueNotification(
    input: CreateQueueNotificationInput,
  ): Promise<CreatedNotificationRef> {
    const notification = new this.notificationModel({
      type: NotificationType.QUEUE,
      queue: input.queue,
      title: input.title,
      message: input.message,
      actionUrl: input.actionUrl,
      metadata: input.metadata ?? {},
      sentAt: input.sentAt ?? new Date(),
    });

    return notification.save();
  }

  async deleteNotification(id: Types.ObjectId | string): Promise<void> {
    await this.notificationModel.findByIdAndDelete(id);
  }
}
```

- [ ] **Step 6: Run the notification test and verify GREEN**

Run: `pnpm test notifications.service`

Expected: PASS.

---

### Task 2: Course Status Shape And Rejected Revision

**Related Skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Modify: `src/modules/courses/entities/course.entity.ts`
- Modify: `src/modules/courses/dto/course.dto.ts`
- Modify: `src/modules/courses/courses.service.ts`
- Test: `src/modules/courses/courses.service.spec.ts`

- [ ] **Step 1: Add failing tests for rejected course response and revision**

In `src/modules/courses/courses.service.spec.ts`, update `makeCourse` to include instructor name and `rejectReason`:

```ts
    rejectReason: null,
    instructor: {
      id: instructorId,
      name: 'Nguyen Van A',
    } as never,
```

Add these tests in `describe('getOwned and update', ...)`:

```ts
    it('includes rejection reason in owned course detail', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({
          status: CourseStatus.REJECTED,
          rejectReason: 'Nội dung khóa học chưa đủ rõ.',
        }),
      );

      const result = await service.getOwned(courseId, instructorId);

      expect(result).toMatchObject({
        status: CourseStatus.REJECTED,
        rejectReason: 'Nội dung khóa học chưa đủ rõ.',
      });
    });

    it('moves a rejected course back to Draft and clears rejectReason when the owner edits metadata', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({
          status: CourseStatus.REJECTED,
          rejectReason: 'Cần bổ sung mô tả.',
        }),
      );
      repo.save.mockImplementation((input: Course) => input);

      const result = await service.update(courseId, instructorId, {
        description: 'Mô tả đã bổ sung',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Mô tả đã bổ sung',
          status: CourseStatus.DRAFT,
          rejectReason: null,
        }),
      );
      expect(result.status).toBe(CourseStatus.DRAFT);
      expect(result.rejectReason).toBeNull();
    });
```

- [ ] **Step 2: Run course service tests and verify RED**

Run: `pnpm test courses.service`

Expected: FAIL because `CourseStatus.REJECTED` and `rejectReason` are missing.

- [ ] **Step 3: Extend course entity**

In `src/modules/courses/entities/course.entity.ts`, update `CourseStatus`:

```ts
export enum CourseStatus {
  DRAFT = 'Draft',
  PENDING = 'Pending',
  PUBLISHED = 'Published',
  REJECTED = 'Rejected',
}
```

Add below `status`:

```ts
  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason!: string | null;
```

- [ ] **Step 4: Extend response type and mapper**

In `src/modules/courses/dto/course.dto.ts`, add to `CourseResponse`:

```ts
  rejectReason: string | null;
```

In `CoursesService.toCourseResponse`, add:

```ts
      rejectReason: course.rejectReason,
```

- [ ] **Step 5: Implement rejected revision behavior**

In `CoursesService.update`, after metadata field assignments and before save, add:

```ts
    if (course.status === CourseStatus.REJECTED) {
      course.status = CourseStatus.DRAFT;
      course.rejectReason = null;
    }
```

- [ ] **Step 6: Run course service tests and verify GREEN for this task**

Run: `pnpm test courses.service`

Expected: PASS for existing and new response/revision tests. Other future request-publish tests do not exist yet.

---

### Task 3: Course Transition Guard

**Related Skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Modify: `src/modules/courses/courses.service.ts`
- Test: `src/modules/courses/courses.service.spec.ts`

- [ ] **Step 1: Add failing transition tests**

Add a new `describe('course status transitions', ...)` block in `courses.service.spec.ts`:

```ts
  describe('course status transitions', () => {
    it.each([
      [CourseStatus.DRAFT, CourseStatus.PENDING],
      [CourseStatus.PENDING, CourseStatus.PUBLISHED],
      [CourseStatus.PENDING, CourseStatus.REJECTED],
      [CourseStatus.REJECTED, CourseStatus.DRAFT],
    ])('allows %s -> %s', (from, to) => {
      expect(() => service.assertCourseStatusTransition(from, to)).not.toThrow();
    });

    it.each([
      [CourseStatus.DRAFT, CourseStatus.PUBLISHED],
      [CourseStatus.DRAFT, CourseStatus.REJECTED],
      [CourseStatus.PENDING, CourseStatus.DRAFT],
      [CourseStatus.PUBLISHED, CourseStatus.PENDING],
      [CourseStatus.PUBLISHED, CourseStatus.REJECTED],
    ])('rejects %s -> %s', (from, to) => {
      expect(() => service.assertCourseStatusTransition(from, to)).toThrow(
        new BadRequestException(`Illegal course status transition: ${from} -> ${to}`),
      );
    });
  });
```

- [ ] **Step 2: Run course service tests and verify RED**

Run: `pnpm test courses.service`

Expected: FAIL because `assertCourseStatusTransition` is not public and not implemented.

- [ ] **Step 3: Implement transition guard**

In `CoursesService`, add a public method near other business-rule methods:

```ts
  assertCourseStatusTransition(from: CourseStatus, to: CourseStatus): void {
    const legalTransitions: Partial<Record<CourseStatus, CourseStatus[]>> = {
      [CourseStatus.DRAFT]: [CourseStatus.PENDING],
      [CourseStatus.PENDING]: [CourseStatus.PUBLISHED, CourseStatus.REJECTED],
      [CourseStatus.REJECTED]: [CourseStatus.DRAFT],
    };

    if (!legalTransitions[from]?.includes(to)) {
      throw new BadRequestException(
        `Illegal course status transition: ${from} -> ${to}`,
      );
    }
  }
```

- [ ] **Step 4: Run course service tests and verify GREEN**

Run: `pnpm test courses.service`

Expected: PASS.

---

### Task 4: Request Publish Transaction And Notification

**Related Skills:** `test-driven-development`, `nestjs-patterns`, `systematic-debugging`

**Files:**
- Modify: `src/modules/courses/courses.module.ts`
- Modify: `src/modules/courses/courses.service.ts`
- Test: `src/modules/courses/courses.service.spec.ts`

- [ ] **Step 1: Add service dependencies to test setup**

In `courses.service.spec.ts`, add imports:

```ts
import { InternalServerErrorException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { NotificationQueue } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
```

If `InternalServerErrorException` is already imported, only add the missing imports.

Extend test variables:

```ts
  let notificationsService: { createQueueNotification: jest.Mock; deleteNotification: jest.Mock };
  let dataSource: { createQueryRunner: jest.Mock };
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: { getRepository: jest.Mock };
  };
```

In `beforeEach`, initialize:

```ts
    notificationsService = {
      createQueueNotification: jest.fn(),
      deleteNotification: jest.fn(),
    };
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: { getRepository: jest.fn().mockReturnValue(repo) },
    };
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };
```

Construct service with the new dependencies:

```ts
    service = new CoursesService(
      repo as unknown as Repository<Course>,
      configService as never,
      minioClient as never,
      notificationsService as unknown as NotificationsService,
      dataSource as unknown as DataSource,
    );
```

- [ ] **Step 2: Add failing request publish tests**

Add `describe('requestPublish', ...)` in `courses.service.spec.ts`:

```ts
  describe('requestPublish', () => {
    it('moves an owned Draft course to Pending and creates a course approval queue notification', async () => {
      repo.findOne.mockResolvedValue(makeCourse());
      repo.save.mockImplementation((input: Course) => input);
      notificationsService.createQueueNotification.mockResolvedValue({
        _id: 'notification-id',
      });

      const result = await service.requestPublish(courseId, instructorId);

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: courseId },
        relations: { instructor: true },
      });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: CourseStatus.PENDING,
          rejectReason: null,
        }),
      );
      expect(notificationsService.createQueueNotification).toHaveBeenCalledWith({
        queue: NotificationQueue.COURSE_APPROVAL,
        title: 'Yêu cầu duyệt khóa học',
        message: 'Nguyen Van A đã gửi yêu cầu xuất bản khóa học "Lap trinh NestJS".',
        actionUrl: '/admin/courses/approvals',
        metadata: { courseId, instructorId },
        sentAt: expect.any(Date),
      });
      expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(CourseStatus.PENDING);
    });

    it('rejects request publish when another Instructor owns the course', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ instructorId: otherInstructorId }),
      );

      await expect(service.requestPublish(courseId, instructorId)).rejects.toEqual(
        new ForbiddenException('You do not own this course'),
      );
      expect(notificationsService.createQueueNotification).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects request publish for non-Draft courses', async () => {
      repo.findOne.mockResolvedValue(makeCourse({ status: CourseStatus.PENDING }));

      await expect(service.requestPublish(courseId, instructorId)).rejects.toEqual(
        new BadRequestException(
          'Illegal course status transition: Pending -> Pending',
        ),
      );
      expect(notificationsService.createQueueNotification).not.toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('rolls back the course update when notification creation fails', async () => {
      repo.findOne.mockResolvedValue(makeCourse());
      repo.save.mockImplementation((input: Course) => input);
      notificationsService.createQueueNotification.mockRejectedValue(
        new Error('mongo down'),
      );

      await expect(service.requestPublish(courseId, instructorId)).rejects.toEqual(
        new InternalServerErrorException('Could not queue course approval notification'),
      );
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it('deletes the created notification when PostgreSQL commit fails after Mongo creation', async () => {
      const notificationId = '64b7f8f8f8f8f8f8f8f8f8f8';
      repo.findOne.mockResolvedValue(makeCourse());
      repo.save.mockImplementation((input: Course) => input);
      notificationsService.createQueueNotification.mockResolvedValue({
        _id: notificationId,
      });
      queryRunner.commitTransaction.mockRejectedValue(new Error('commit failed'));

      await expect(service.requestPublish(courseId, instructorId)).rejects.toEqual(
        new InternalServerErrorException('Could not request course publication'),
      );
      expect(notificationsService.deleteNotification).toHaveBeenCalledWith(notificationId);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });
  });
```

- [ ] **Step 3: Run course service tests and verify RED**

Run: `pnpm test courses.service`

Expected: FAIL because `CoursesService` constructor, `requestPublish`, notification calls, and transaction orchestration are not implemented.

- [ ] **Step 4: Import notification module into courses module**

Update `src/modules/courses/courses.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { Course } from './entities/course.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Course]), NotificationsModule],
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
```

- [ ] **Step 5: Inject DataSource and NotificationsService**

In `src/modules/courses/courses.service.ts`, update imports:

```ts
import { DataSource, Repository } from 'typeorm';
import { NotificationQueue } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
```

Update constructor:

```ts
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
```

- [ ] **Step 6: Implement requestPublish with manual transaction and compensation**

Add this public method in `CoursesService`:

```ts
  async requestPublish(id: string, instructorId: string): Promise<CourseResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    let createdNotificationId: unknown;

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const courseRepository = queryRunner.manager.getRepository(Course);
      const course = await courseRepository.findOne({
        where: { id },
        relations: { instructor: true },
      });

      if (!course) {
        throw new NotFoundException('Course not found');
      }

      if (course.instructorId !== instructorId) {
        throw new ForbiddenException('You do not own this course');
      }

      this.assertCourseStatusTransition(course.status, CourseStatus.PENDING);

      course.status = CourseStatus.PENDING;
      course.rejectReason = null;
      const savedCourse = await courseRepository.save(course);

      try {
        const notification = await this.notificationsService.createQueueNotification({
          queue: NotificationQueue.COURSE_APPROVAL,
          title: 'Yêu cầu duyệt khóa học',
          message: `${course.instructor.name} đã gửi yêu cầu xuất bản khóa học "${course.title}".`,
          actionUrl: '/admin/courses/approvals',
          metadata: { courseId: course.id, instructorId },
          sentAt: new Date(),
        });
        createdNotificationId = notification._id;
      } catch {
        throw new InternalServerErrorException(
          'Could not queue course approval notification',
        );
      }

      try {
        await queryRunner.commitTransaction();
      } catch {
        if (createdNotificationId) {
          await this.notificationsService.deleteNotification(
            createdNotificationId as never,
          );
        }
        throw new InternalServerErrorException(
          'Could not request course publication',
        );
      }

      return this.toCourseResponse(savedCourse);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
```

- [ ] **Step 7: Run course service tests and verify GREEN**

Run: `pnpm test courses.service`

Expected: PASS.

---

### Task 5: Request Publish Controller Endpoint

**Related Skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Modify: `src/modules/courses/courses.controller.ts`
- Test: `src/modules/courses/courses.controller.spec.ts`

- [ ] **Step 1: Add failing controller tests**

In `courses.controller.spec.ts`, extend service mock type and setup with:

```ts
    requestPublish: jest.Mock;
```

and:

```ts
      requestPublish: jest.fn(),
```

Add to the delegation test or as a new test:

```ts
  it('delegates request publish with course id and current Instructor id', async () => {
    await controller.requestPublish(courseId, instructorId);

    expect(service.requestPublish).toHaveBeenCalledWith(courseId, instructorId);
  });
```

Extend the `HandlerName` union:

```ts
    | 'requestPublish';
```

Add a guard check for the handler:

```ts
  it('keeps request publish protected by Instructor role metadata', () => {
    expect(
      new RolesGuard(reflector).canActivate(
        buildContext(handlerOf('requestPublish'), {
          id: 'instructor-id',
          role: UserRole.INSTRUCTOR,
        }) as never,
      ),
    ).toBe(true);
  });
```

- [ ] **Step 2: Run controller tests and verify RED**

Run: `pnpm test courses.controller`

Expected: FAIL because `requestPublish` controller method is missing.

- [ ] **Step 3: Add controller endpoint**

In `src/modules/courses/courses.controller.ts`, add after `getOwned` or before `update`:

```ts
  @Post(':id/request-publish')
  @HttpCode(HttpStatus.OK)
  requestPublish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.coursesService.requestPublish(id, instructorId);
  }
```

- [ ] **Step 4: Run controller tests and verify GREEN**

Run: `pnpm test courses.controller`

Expected: PASS.

---

### Task 6: Final Verification And Build

**Related Skills:** `verification-before-completion`, `systematic-debugging`, `nestjs-patterns`

**Files:**
- Review: all modified backend files

- [ ] **Step 1: Run focused course tests**

Run: `pnpm test courses.service`

Expected: PASS with all T1-01 and T1-02 course service tests passing.

- [ ] **Step 2: Run focused notification tests**

Run: `pnpm test notifications.service`

Expected: PASS with queue notification tests passing.

- [ ] **Step 3: Run focused controller tests**

Run: `pnpm test courses.controller`

Expected: PASS with request-publish delegation and RBAC coverage passing.

- [ ] **Step 4: Run backend build**

Run: `pnpm build`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Optional lint after tests and build pass**

Run: `pnpm lint`

Expected: PASS. Inspect the diff after lint because this command uses `--fix` and may mutate files.

- [ ] **Step 6: Inspect changed files**

Run: `git diff -- src/modules/courses src/modules/notifications docs/superpowers/plans/2026-08-24-t1-02-backend-course-status-machine.md docs/superpowers/specs/2026-08-24-t1-02-backend-course-status-machine-design.md`

Expected: Diff contains only T1-02 backend status machine, notification persistence, and planning/spec files.

---

## Self-Review

- Spec coverage: The plan covers `Rejected + rejectReason`, legal/illegal transitions, request-publish endpoint, Mongo queue notification, cross-store rollback/compensation, BR-01 seam, service/controller tests, and build verification.
- Placeholder scan: The plan contains concrete file paths, test code, implementation snippets, commands, and expected outcomes.
- Type consistency: The plan consistently uses `NotificationQueue.COURSE_APPROVAL`, `course_approval`, `requestPublish`, `rejectReason`, `assertCourseStatusTransition`, and `CourseStatus.REJECTED`.
