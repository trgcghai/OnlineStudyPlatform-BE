# T1-06 Backend Learning Order Design

## Goal

Implement the backend for T1-06 so an Instructor can configure a course to
`sequential` or `free` learning order, and the backend enforces that order at
the API layer (not just in the UI): in `sequential` mode a Learner must have
completed every prior lesson before opening a later one; in `free` mode every
lesson is accessible regardless of progress.

## Sources

- Task: `ba/tasks/phase-1-lms-core/T1-06-learning-order.md`
- BRD: `ba/02-brd-requirements.md` FR-23, BR-13
- Backlog: `ba/03-user-stories-backlog.md` US-022
- Thesis data model: `document/TruongCongHai_HuynhThanhLiem.md` ("Việc học theo
  trình tự hoặc tự do được cấu hình bởi Instructor đối với từng khóa học.")
- Current backend: `src/modules/courses`, `src/modules/lessons`

## Current Context

The `Course` entity has no ordering field today. `Lesson` carries an integer
`position` column (set by create and reordered/reindexed by T1-05). There is no
learner lesson API yet (owned by T1-10), and no lesson-progress store (owned by
T1-11). Per the task note, the gating API must be implemented now and verified
end-to-end in Sprint 4 once progress exists.

## Design Decisions

### 1. `learning_order` on Course

Add a `CourseLearningOrder` enum and a `learning_order` enum column on
`courses`:

```ts
export enum CourseLearningOrder {
  SEQUENTIAL = 'sequential',
  FREE = 'free',
}
```

```ts
@Column({
  name: 'learning_order',
  type: 'enum',
  enum: CourseLearningOrder,
  default: CourseLearningOrder.FREE,
})
learningOrder!: CourseLearningOrder;
```

**Default is `free`.** This is the least-restrictive value: a Learner is never
blocked unless the Instructor explicitly opts into sequential pacing. It keeps
the default behavior identical to today's system (all lessons accessible) and
avoids accidental lockout before progress tracking lands.

### 2. Configurable by the owner

The setting is exposed on `CreateCourseDto` and `UpdateCourseDto` as optional,
validated with `@IsEnum(CourseLearningOrder)`, and returned on
`CourseResponse` and `PublicCourseResponse`. Only the owner can change it
because it rides the existing ownership-guarded `CoursesService.update` /
`getOwnedCourseEntity` path. When omitted on create, the DB default `free`
applies; on update it is only written when provided, and the "No changes
provided" guard counts it.

### 3. API-level gating rule: `LearningAccessService`

Add a small, dependency-free `LearningAccessService` in the Lessons module
(which already registers `Course` and `Lesson` repositories). It exposes a pure,
fully testable rule:

```ts
determineLessonAccess(
  courseLearningOrder: CourseLearningOrder,
  targetLesson: Lesson,
  lessonsInCourse: ReadonlyArray<Lesson>,
  completedLessonIds: ReadonlySet<string>,
): LessonAccessDecision
```

- `free` => always `{ allowed: true }`.
- `sequential` => allowed only if every lesson with `position <
  targetLesson.position` is in `completedLessonIds`; otherwise
  `{ allowed: false, message: 'Hoàn thành bài học trước để tiếp tục' }`.

The completed set is passed in explicitly because the progress module (T1-11)
owns how completion is recorded. T1-10 wires its learner lesson endpoint to
call this service with the completed lessons from progress. This satisfies
"enforced at API level" now while remaining independently testable.

The service is registered as a provider and exported from `LessonsModule` so
T1-10 can inject it.

## File Structure

- Modify: `src/modules/courses/entities/course.entity.ts` - add
  `CourseLearningOrder` enum + `learningOrder` column.
- Modify: `src/modules/courses/dto/course.dto.ts` - add `LEARNING_ORDERS` /
  `LearningOrder`, optional `learningOrder` on Create/Update DTOs,
  `learningOrder` on `CourseResponse` and `PublicCourseResponse`.
- Modify: `src/modules/courses/courses.service.ts` - persist on create/update,
  return in both response mappers.
- Create: `src/modules/lessons/learning-access.service.ts` - gating rule.
- Create: `src/modules/lessons/learning-access.service.spec.ts` - gating tests
  (sequential block + free allow).
- Modify: `src/modules/lessons/lessons.module.ts` - register + export
  `LearningAccessService`.

## Error Handling

- Sequential block is a rule decision (`allowed: false`), not a thrown
  exception, so callers (T1-10) can decide the HTTP status / message. The
  Vietnamese message constant `SEQUENTIAL_BLOCK_MESSAGE` reads
  "Hoàn thành bài học trước để tiếp tục" per the acceptance criteria.
- Invalid `learningOrder` values are rejected by class-validator as 400 with
  the standard validation message.
- Edit-by-non-owner keeps the existing 403 ownership behavior.

## Testing Design

### `learning-access.service.spec.ts`

- free order allows any lesson regardless of progress.
- sequential order blocks lesson N+1 when a prior lesson is incomplete,
  with the Vietnamese message.
- sequential order allows the first lesson (no prior lessons).
- sequential order allows lesson N+1 once all prior lessons are completed.
- a same-position earlier lesson is not treated as a prerequisite (strictly
  lower positions only).

### `courses.service.spec.ts`

- `create` persists the `free` default (exact `repo.create` call) and persists
  an explicit `learningOrder` when provided.
- `update` writes `learningOrder` when provided.
- mock `Course` factory gains a `learningOrder` default.

## Out Of Scope

- Learner lesson HTTP endpoint (T1-10).
- Lesson-progress / completion recording (T1-11).
- Learner UI gating (T1-10 / FE).
- Quiz-related prerequisites (later tasks).
