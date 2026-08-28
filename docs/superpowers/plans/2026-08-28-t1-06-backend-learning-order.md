# T1-06 Backend Learning Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable `learning_order` (`sequential`/`free`) to courses and implement the API-level gating rule (sequential blocks, free allows) via a testable `LearningAccessService`.

**Architecture:** Add `CourseLearningOrder` + `learningOrder` column to the `Course` entity, surface it through course DTOs/service, and add a dependency-free `LearningAccessService` in the Lessons module that T1-10 will call from the learner lesson endpoint.

**Tech Stack:** NestJS 11, TypeScript, TypeORM, PostgreSQL, Jest, class-validator, pnpm.

**Approved Design:** `docs/superpowers/specs/2026-08-28-t1-06-backend-learning-order-design.md`

**Repository Rules:** Work inside `online-study-platform-be`. Use relative imports. Use `pnpm` only. Do not commit unless the user explicitly asks.

---

## File Structure

- Modify: `src/modules/courses/entities/course.entity.ts`
- Modify: `src/modules/courses/dto/course.dto.ts`
- Modify: `src/modules/courses/courses.service.ts`
- Modify: `src/modules/courses/courses.service.spec.ts`
- Create: `src/modules/lessons/learning-access.service.ts`
- Create: `src/modules/lessons/learning-access.service.spec.ts`
- Modify: `src/modules/lessons/lessons.module.ts`

---

### Task 1: Course Entity And DTO

**Related skills:** `nestjs-patterns`

**Files:**
- Modify: `src/modules/courses/entities/course.entity.ts`
- Modify: `src/modules/courses/dto/course.dto.ts`

- [ ] **Step 1: Add the enum and column to the Course entity**

Add to `src/modules/courses/entities/course.entity.ts`:

```ts
export enum CourseLearningOrder {
  SEQUENTIAL = 'sequential',
  FREE = 'free',
}
```

Add the column below `status`:

```ts
@Column({
  name: 'learning_order',
  type: 'enum',
  enum: CourseLearningOrder,
  default: CourseLearningOrder.FREE,
})
learningOrder!: CourseLearningOrder;
```

- [ ] **Step 2: Update the DTO file**

Import `CourseLearningOrder` alongside `CourseStatus`. Add constants near
`COURSE_REVIEW_STATUSES`:

```ts
export const LEARNING_ORDERS = [
  CourseLearningOrder.SEQUENTIAL,
  CourseLearningOrder.FREE,
] as const;

export type LearningOrder = (typeof LEARNING_ORDERS)[number];
```

Add an optional validated field to both `CreateCourseDto` and
`UpdateCourseDto`:

```ts
@IsOptional()
@IsEnum(CourseLearningOrder)
learningOrder?: CourseLearningOrder;
```

Add `learningOrder: LearningOrder;` to `CourseResponse` and
`PublicCourseResponse`.

- [ ] **Step 3: Run the focused build**

```bash
pnpm build
```

Expected: PASS (no wiring errors; entity/type changes are self-contained).

---

### Task 2: Course Service Persistence And Response

**Related skills:** `nestjs-patterns`

**Files:**
- Modify: `src/modules/courses/courses.service.ts`

- [ ] **Step 1: Handle learning order in create**

Import `CourseLearningOrder`. In `create`, persist the default or an explicit
value:

```ts
learningOrder: dto.learningOrder ?? CourseLearningOrder.FREE,
```

- [ ] **Step 2: Handle learning order in update**

Add `dto.learningOrder !== undefined` to the `hasChanges` guard, then assign
`course.learningOrder = dto.learningOrder;` when provided.

- [ ] **Step 3: Return learning order in responses**

Add `learningOrder: course.learningOrder,` to both `toCourseResponse` and
`toPublicCourseResponse`.

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: PASS.

---

### Task 3: Learning Access Gating Service (Tests First)

**Related skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/lessons/learning-access.service.spec.ts`
- Later target: `src/modules/lessons/learning-access.service.ts`

- [ ] **Step 1: Write failing gating tests**

Create `src/modules/lessons/learning-access.service.spec.ts` covering:
- free allows any lesson regardless of progress;
- sequential blocks lesson N+1 when a prior lesson is incomplete, with
  `SEQUENTIAL_BLOCK_MESSAGE`;
- sequential allows the first lesson;
- sequential allows lesson N+1 once all prior lessons are complete;
- a same-position lesson is not treated as a prerequisite.

- [ ] **Step 2: Run to see the tests fail (missing service)**

```bash
pnpm test learning-access.service
```

Expected: FAIL because `LearningAccessService` does not exist.

---

### Task 4: Learning Access Service Implementation

**Related skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/lessons/learning-access.service.ts`
- Test: `src/modules/lessons/learning-access.service.spec.ts`
- Modify: `src/modules/lessons/lessons.module.ts`

- [ ] **Step 1: Implement the service**

```ts
import { Injectable } from '@nestjs/common';
import { CourseLearningOrder } from '../courses/entities/course.entity';
import { Lesson } from './entities/lesson.entity';

export interface LessonAccessDecision {
  allowed: boolean;
  message: string;
}

export const SEQUENTIAL_BLOCK_MESSAGE =
  'Hoàn thành bài học trước để tiếp tục';

@Injectable()
export class LearningAccessService {
  determineLessonAccess(
    courseLearningOrder: CourseLearningOrder,
    targetLesson: Lesson,
    lessonsInCourse: ReadonlyArray<Lesson>,
    completedLessonIds: ReadonlySet<string>,
  ): LessonAccessDecision {
    if (courseLearningOrder === CourseLearningOrder.FREE) {
      return { allowed: true, message: '' };
    }

    const hasIncompletePriorLesson = lessonsInCourse.some(
      (lesson) =>
        lesson.position < targetLesson.position &&
        !completedLessonIds.has(lesson.id),
    );

    if (hasIncompletePriorLesson) {
      return { allowed: false, message: SEQUENTIAL_BLOCK_MESSAGE };
    }

    return { allowed: true, message: '' };
  }
}
```

- [ ] **Step 2: Register and export the service in the module**

```ts
providers: [LessonsService, LearningAccessService],
exports: [LessonsService, LearningAccessService],
```

- [ ] **Step 3: Run the gating tests**

```bash
pnpm test learning-access.service
```

Expected: PASS.

---

### Task 5: Update Course Service Tests

**Related skills:** `test-driven-development`

**Files:**
- Modify: `src/modules/courses/courses.service.spec.ts`

- [ ] **Step 1: Add learningOrder to the mock course factory**

Add `learningOrder: CourseLearningOrder.FREE` to the mock `Course` defaults and
import `CourseLearningOrder`.

- [ ] **Step 2: Fix the create exact-match assertion**

The `repo.create` exact-match in the create test must now include
`learningOrder: CourseLearningOrder.FREE`. Add an extra test that an explicit
`learningOrder` is persisted.

- [ ] **Step 3: Add an update test**

Add a test that `update` writes `learningOrder` when provided.

- [ ] **Step 4: Run course tests**

```bash
pnpm test courses.service
```

Expected: PASS.

---

### Task 6: Full Verification

**Related skills:** `verification-before-completion`

**Files:**
- No code edits unless verification fails.

- [ ] **Step 1: Run all unit tests**

```bash
pnpm test
```

Expected: PASS. If an unrelated pre-existing suite fails (e.g. an
`async`-without-`await` lint error in `enrollments.service.spec.ts` blocks
`pnpm lint`), fix only that trivial gate-blocking issue and rerun.

- [ ] **Step 2: Run the build**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: PASS (this script auto-fixes; review any files it changes).

---

## Manual Smoke Checklist

- Start the backend with reachable Postgres/Redis/MongoDB/MinIO.
- Create a course via `POST /courses` and confirm `learningOrder` is `free` by default.
- `PATCH /courses/:id` with `{ "learningOrder": "sequential" }` as the owner and confirm it persists.
- `PATCH /courses/:id` with a non-owner and confirm 403.
- `PATCH /courses/:id` with `{ "learningOrder": "invalid" }` and confirm 400.
- Confirm the gating rule via the unit tests (sequential block + free allow);
  end-to-end learner gating is verified in Sprint 4 once T1-10/T1-11 land.

## Completion Criteria

- `Course.learningOrder` enum column exists with default `free`.
- Instructor can set `learningOrder` via create/update; only the owner can edit.
- `CourseResponse` and `PublicCourseResponse` expose `learningOrder`.
- `LearningAccessService` enforces sequential block / free allow at the rule
  layer with message "Hoàn thành bài học trước để tiếp tục".
- Tests green: full `pnpm test`, `pnpm build`, `pnpm lint`.
