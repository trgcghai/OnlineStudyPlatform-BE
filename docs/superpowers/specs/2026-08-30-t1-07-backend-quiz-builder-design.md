# T1-07 Backend Quiz Builder Design

## Goal

Implement the backend for T1-07 so an Instructor can build a lesson quiz:
create a quiz (title, description, time limit, pass score %, attached to a
lesson) composed of two question types — MCQ (4 options, one or more correct
answers, points) and essay (points, no options). The backend enforces the
"delete quiz with attempts ⇒ block" policy, computes total points and the
pass-score threshold from the pass score percentage, and exposes edit / delete
for quizzes and questions plus drag-reorder of questions.

## Sources

- Task: `ba/tasks/phase-1-lms-core/T1-07-quiz-builder.md`
- BRD: `ba/02-brd-requirements.md` FR-24, FR-25, FR-35
- Backlog: `ba/03-user-stories-backlog.md` US-030
- Use case: `document/` UC09
- Notes in task: answers stored per Question (`correct_answers` JSON); pass
  score = % of total points (align FR-35); essay graded manually (T1-14).
- Current backend: `src/modules/courses`, `src/modules/lessons`

## Current Context

There is no quiz code in the backend yet. Courses (`Course`) and lessons
(`Lesson`) exist with ownership checks (`getOwnedCourseEntity`,
`assertCourseOwnership`). Lessons are attached to courses via `lesson_id`
(`OnDelete CASCADE`). There is no quiz, question, or attempt store. The
`QuizAttempt` entity is created now as a minimal, real table so the
"delete-with-attempts ⇒ block" acceptance criterion is enforceable and
testable; T1-12 will add the attempt write/grade logic.

## Design Decisions

### 1. Entities and relations

Three entities:

- `Quiz` (`quizzes`): `id` uuid, `lesson_id` FK `OnDelete CASCADE`
  (the `courseId` is resolved through the lesson, not stored), `title`,
  `description` (text, default `''`), `time_limit_minutes` (int, nullable =
  no limit), `pass_score` (int, default `70`, meaning percent of total),
  `OneToMany questions`.
- `Question` (`questions`): `id`, `quiz_id` FK `OnDelete CASCADE`, `content`
  (text), `type` (enum `MCQ` | `ESSAY`), `options` (jsonb `string[]`),
  `correct_answers` (jsonb `number[]` of option indices), `points` (int),
  `position` (int, ordering within the quiz).
- `QuizAttempt` (`quiz_attempts`): `id`, `quiz_id` FK `OnDelete RESTRICT`
  (DB safety net for the delete-with-attempts block), `learner_id` (nullable),
  `score` (nullable), `answers` (jsonb, nullable), `started_at` /
  `submitted_at` (nullable). Write/grade logic belongs to T1-12; only the
  record shape and the RESTRICT FK are created now.

Question type semantics (enforced in `normalizeQuestionPayload`):

- MCQ: `options` trimmed, must be ≥ 2 (no hard upper bound in code beyond the
  DTO's 10); `correct_answers` must be ≥ 1, each index `< options.length`,
  indices unique. Returned as a sorted unique set.
- Essay: `options` forced to `[]` and `correct_answers` forced to `[]`; passing
  a non-empty `options` or `correct_answers` for an essay is rejected (400).

### 2. Pass score = percentage of total points

`passScorePoints = Math.ceil(totalPoints * passScore / 100)` via an exported
pure helper `computePassScorePoints(totalPoints, passScore)`. With the task
scenario "1 MCQ 5 pts + 1 essay 10 pts, pass 70%": totalPoints = 15,
passScorePoints = ceil(15 * 0.7) = ceil(10.5) = 11. This aligns with FR-35
(pass score is a % of total achievable points). `passScore` on its own remains
0–100. The threshold is computed from the live question set and re-derived on
every read.

### 3. API surface (all `JwtAuthGuard` + `RolesGuard` + `@Roles(INSTRUCTOR)`)

```
POST/GET /courses/:courseId/lessons/:lessonId/quiz
  create            (201) / list summaries
GET/PATCH/DELETE /quizzes/:id
  findOne / update (200) / remove (204)
POST   /quizzes/:quizId/questions          (201) add a question
PATCH  /quizzes/:quizId/questions/reorder  (200) drag reorder via orderedIds
PATCH/DELETE /questions/:id                (200) / (204)
```

Each route resolves ownership through `getOwnedQuizEntity` /
`getOwnedQuestionEntity` (quiz → lesson → course → `instructorId`) and rejects
non-owners with 403. `questionId` update uses full-replace semantics: merge the
DTO over the existing record, then validate the merged payload as if creating
(so switching an MCQ to essay clears options, and vice versa requires new
correct answers).

### 4. Delete / destructive-edit policy when attempts exist

Because a deleted or restructured quiz would invalidate graded attempts, the
following are blocked with 409 when `quiz_attempts` rows reference the quiz:

- `ATTEMPTS_BLOCKED_DELETE_MESSAGE` — delete quiz.
- `ATTEMPTS_BLOCKED_QUESTION_MESSAGE` — add / update / delete / reorder
  questions.
- `ATTEMPTS_BLOCKED_PASS_SCORE_MESSAGE` — change `passScore`.

These come from exported constants. Only non-destructive metadata edits
(`title`, `description`, `timeLimitMinutes`) remain allowed after attempts
exist. The DB-level `RESTRICT` FK on `QuizAttempt.quizId` is a safety net that
`remove` also converts into the same 409 if a row somehow slips through the
`assertNoAttempts` check.

### 5. Ordering

Questions carry an integer `position`. Create assigns `0..n-1` in payload
order. `reorderQuestions` takes `{ orderedIds }`; it rejects a list that does
not contain exactly every question id of the quiz, then writes `position =
index` for each. `removeQuestion` reindexes the remaining questions in a
`queryRunner` transaction. `findOne`/responses sort by
`position ASC, createdAt ASC` so the order is deterministic.

## File Structure

- Create: `src/modules/quizzes/entities/quiz.entity.ts`
- Create: `src/modules/quizzes/entities/question.entity.ts` (exports
  `QuestionType`)
- Create: `src/modules/quizzes/entities/quiz-attempt.entity.ts`
- Create: `src/modules/quizzes/dto/quiz.dto.ts` (CreateQuizDto w/ nested
  questions, UpdateQuizDto, Create/UpdateQuestionDto, ReorderQuestionsDto;
  `QuizResponse`, `QuizSummaryResponse`, `QuestionResponse`)
- Create: `src/modules/quizzes/quizzes.service.ts` (exports
  `ATTEMPTS_BLOCKED_*` messages + `computePassScorePoints`)
- Create: `src/modules/quizzes/quizzes.controller.ts` (4 controllers: quizzes
  under lesson, quiz question mgmt, quiz manage, question manage)
- Create: `src/modules/quizzes/quizzes.module.ts`
- Create: `src/modules/quizzes/quizzes.service.spec.ts`
- Create: `src/modules/quizzes/quizzes.controller.spec.ts`
- Modify: `src/app.module.ts` (register `QuizzesModule`)

## Error Handling

- 404 when lesson / quiz / question does not exist.
- 400 for validation (DTO) and semantic errors (MCQ needs ≥2 options and ≥1
  correct answer; out-of-range / duplicate correct indices; essay with
  options; reorder list mismatch).
- 403 for non-owner access.
- 409 for destructive operations on a quiz that already has attempts.
- All through the global `ValidationPipe` / `HttpExceptionFilter` /
  `ResponseInterceptor`.

## Testing Design

### `quizzes.service.spec.ts`

- `assertLessonOwnership` not-found / wrong-course / not-owner.
- `create`: scenario quiz (1 MCQ 5 pts + 1 essay 10 pts, pass 70%) with
  totalPoints 15 and passScorePoints 11; defaults (pass 70, no time limit,
  empty description); MCQ-without-options rejected.
- `listByLesson` summaries with counts and total points.
- `findOne` full response ordering.
- `update`: metadata; pass-score blocked once attempts exist.
- `remove`: no attempts ⇒ deleted; attempts ⇒ 409; FK-23503 path ⇒ 409.
- `addQuestion` / `updateQuestion` (incl. MCQ↔essay switch) /
  `removeQuestion` (with reindex) / `reorderQuestions` (order, mismatch,
  non-membership, attempts-block).
- `computePassScorePoints` pure helper.
- DTO unit validation for the question forms.

### `quizzes.controller.spec.ts`

- Delegation for every route.
- Decorator metadata check that every quiz endpoint is
  `@Roles(INSTRUCTOR)`, plus a guard allow/reject smoke test.

## Out Of Scope

- Learner-facing quiz attempts, grading, and score computation (T1-12).
- Essay manual grading workflow (T1-14).
- Learner quiz-taking UI.
- Quiz timer enforcement at submission time (T1-12).
