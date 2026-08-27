# T1-09 Backend Enrollment Design

## Goal

Implement the backend for T1-09 so Learners can enroll in published courses exactly once, course detail can show authenticated enrollment state, and Learners can retrieve their enrolled courses with progress.

## Sources

- Task: `ba/tasks/phase-1-lms-core/T1-09-enrollment.md`
- BRD: `ba/02-brd-requirements.md` FR-31, BR-01, BR-02, BR-05
- Thesis data model: `document/TruongCongHai_HuynhThanhLiem.md` Enrollment table
- Current backend: `src/modules/courses`, `src/modules/users`, `src/modules/lessons`

## Current Context

The backend already has course publishing status through `CourseStatus` in `src/modules/courses/entities/course.entity.ts`. Public course APIs live in `src/modules/courses/public-courses.controller.ts`, and protected instructor/admin course APIs live in `src/modules/courses/courses.controller.ts`. There is no enrollment module or entity yet.

The existing TypeORM style keeps explicit FK id fields and relation fields together. `Course` has `instructorId` plus `instructor`; `Lesson` has `courseId` plus `course`. Enrollment should follow the same pattern with `learnerId`/`learner` and `courseId`/`course`.

## Enrollment Entity

Create `src/modules/enrollments/entities/enrollment.entity.ts`.

The table name is `enrollments`. The entity should align with the thesis model and include both FK ids and relations:

```ts
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
}
```

`completedAt` is included now as nullable because it is part of the thesis Enrollment table, but T1-09 does not set it. Later learning/progress tasks can set it when progress reaches completion rules.

`progress` uses `decimal(5,2)` to match the class diagram's decimal progress and allow values from `0.00` to `100.00`. TypeORM returns PostgreSQL decimals as strings, so response DTOs should expose `progress` as `string` unless the service intentionally converts it.

## Module Structure

Create a focused `EnrollmentsModule`:

- `src/modules/enrollments/enrollments.module.ts`
- `src/modules/enrollments/enrollments.controller.ts`
- `src/modules/enrollments/enrollments.service.ts`
- `src/modules/enrollments/dto/enrollment.dto.ts`
- `src/modules/enrollments/entities/enrollment.entity.ts`
- `src/modules/enrollments/enrollments.service.spec.ts`

Import `EnrollmentsModule` in `src/app.module.ts`.

The module should use `TypeOrmModule.forFeature([Enrollment, Course])`. It does not need to import `UsersModule` because enrollment creation only needs the authenticated learner id from the JWT and a FK relation to `User`.

## API Design

### Enroll In Course

`POST /courses/:courseId/enrollments`

Protection:

- `JwtAuthGuard`
- `RolesGuard`
- `@Roles(UserRole.LEARNER)`

Behavior:

- Parse `courseId` with `ParseUUIDPipe`.
- Read learner id via `@CurrentUser('id')`.
- Load the course by id.
- Reject when the course is missing or not `Published`.
- Reject when `(learnerId, courseId)` already exists.
- Create enrollment with `progress = 0.00`, `completedAt = null`, and generated `enrolledAt`.
- Catch unique constraint errors and map them to the same duplicate-enrollment response.

Duplicate response:

```ts
throw new ConflictException('Bạn đã đăng ký khóa học này');
```

Published-only response:

Use one consistent behavior in implementation and tests. Preferred:

```ts
throw new BadRequestException('Chỉ có thể đăng ký khóa học đã xuất bản');
```

### List My Enrollments

`GET /enrollments/me`

Protection:

- `JwtAuthGuard`
- `RolesGuard`
- `@Roles(UserRole.LEARNER)`

Behavior:

- Return only enrollments for the authenticated learner.
- Join course and instructor so the frontend My Courses page can render without extra requests.
- Order newest first by `enrolledAt DESC`.

Pagination is not required for T1-09 unless the existing FE chooses to page My Courses. Keep the first implementation simple and return an array.

### Public Course Detail Enrollment State

Modify `GET /courses/public/:id`.

Behavior:

- Anonymous request returns the same public course response shape as today and does not include `isEnrolled`.
- Authenticated Learner request includes `isEnrolled: boolean`.
- Authenticated Admin/Instructor request includes `isEnrolled: false`.
- Missing or invalid auth must not block public course detail access.

This requires optional authentication support. Add `src/common/guards/optional-jwt-auth.guard.ts` as a subclass of `AuthGuard(JWT_STRATEGY_NAME)` that overrides `handleRequest` and returns `user ?? null` instead of throwing for missing, expired, malformed, or disabled-account tokens. Apply it only to `PublicCoursesController.getPublished`. Then `PublicCoursesController.getPublished` can use `@CurrentUser() user` and pass it to `CoursesService.getPublished(id, user)`.

The optional guard must not replace `JwtAuthGuard` on protected routes. Enrollment creation and My Enrollments remain strict-auth endpoints.

## Response DTOs

Enrollment responses should avoid returning raw entities.

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
  course?: EnrollmentCourseResponse;
}
```

Public course detail response should extend the current `PublicCourseResponse` with optional enrollment state:

```ts
isEnrolled?: boolean;
```

Do not add `isEnrolled` for anonymous requests.

## Business Rules

- BR-01: only `Published` courses are enrollable.
- BR-02: a learner can enroll in each course only once.
- BR-05: enrollment stores learner, course, and progress.
- T1-09 initializes progress only; T1-10 and later tasks update progress and completion.

## Error Handling

- Duplicate enrollment: `409 Conflict`, message `Bạn đã đăng ký khóa học này`.
- Non-published course: `400 Bad Request`, message `Chỉ có thể đăng ký khóa học đã xuất bản`.
- Missing course: `404 Not Found`, message `Course not found`.
- Non-Learner enrollment attempt: handled by `RolesGuard` as `403 Forbidden`.

All errors will be wrapped by the existing global `HttpExceptionFilter`.

## Testing Design

Add `src/modules/enrollments/enrollments.service.spec.ts` with mocked TypeORM repositories.

Cover:

- Successful enrollment creates an enrollment for a published course with progress `0.00` and `completedAt = null`.
- Draft, Pending, and Rejected courses cannot be enrolled.
- Duplicate enrollment fails with `ConflictException` and the Vietnamese message.
- Database unique-constraint failure is mapped to the same duplicate response.
- `findMine(learnerId)` returns only the current learner's enrollments and maps course/instructor fields.
- `isLearnerEnrolled(learnerId, courseId)` returns true/false for public course detail state.

Add or update course public detail tests with the existing controller spec structure:

- Anonymous detail response omits `isEnrolled`.
- Authenticated learner detail response includes `isEnrolled`.

Verification commands from `online-study-platform-be`:

```bash
pnpm test enrollments.service
pnpm build
```

`pnpm lint` can be run before final completion, but it uses `--fix` and may mutate files.

## Out Of Scope

- Learning player implementation.
- Lesson-level progress tracking.
- Quiz attempt progress updates.
- Certificate creation.
- Enrollment cancellation or unenrollment.
- Admin/instructor enrollment management.
