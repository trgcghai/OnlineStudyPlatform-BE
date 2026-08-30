# T1-07 Backend Quiz Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Instructor quiz-builder backend: quizzes attached to lessons with MCQ + essay questions, points and a pass-score percentage, plus quiz/question CRUD and drag reorder, and a documented delete-block when attempts exist.

**Architecture:** Three entities (`Quiz`, `Question`, minimal `QuizAttempt`) under a new `QuizzesModule`. Quiz/Question routes are ownership-guarded (quiz → lesson → course → instructor). `passScorePoints = ceil(totalPoints * passScore / 100)`. Attempts block destructive edits at the service layer with exported 409 messages; `QuizAttempt.quizId` uses `OnDelete RESTRICT` as a DB safety net.

**Tech Stack:** NestJS 11, TypeScript, TypeORM, PostgreSQL, Jest, class-validator, pnpm.

**Approved Design:** `docs/superpowers/specs/2026-08-30-t1-07-backend-quiz-builder-design.md`

**Repository Rules:** Work inside `online-study-platform-be`. Use relative imports. Use `pnpm` only. Do not commit unless the user explicitly asks.

---

## File Structure

- Create: `src/modules/quizzes/entities/quiz.entity.ts`
- Create: `src/modules/quizzes/entities/question.entity.ts`
- Create: `src/modules/quizzes/entities/quiz-attempt.entity.ts`
- Create: `src/modules/quizzes/dto/quiz.dto.ts`
- Create: `src/modules/quizzes/quizzes.service.ts`
- Create: `src/modules/quizzes/quizzes.controller.ts`
- Create: `src/modules/quizzes/quizzes.module.ts`
- Create: `src/modules/quizzes/quizzes.service.spec.ts`
- Create: `src/modules/quizzes/quizzes.controller.spec.ts`
- Modify: `src/app.module.ts`

---

### Task 1: Entities And DTOs

**Related skills:** `nestjs-patterns`

**Files:**
- Create: `src/modules/quizzes/entities/quiz.entity.ts`
- Create: `src/modules/quizzes/entities/question.entity.ts`
- Create: `src/modules/quizzes/entities/quiz-attempt.entity.ts`
- Create: `src/modules/quizzes/dto/quiz.dto.ts`

- [ ] **Step 1: Quiz entity**

`quizzes` table: uuid id, `lesson_id` uuid FK → `Lesson` (`OnDelete CASCADE`),
`title` (length 200), `description` (text, default `''`),
`time_limit_minutes` int nullable, `pass_score` int default 70,
`OneToMany` `questions`, created/updated timestamps.

- [ ] **Step 2: Question entity**

`questions` table: uuid id, `quiz_id` FK → `Quiz` (`OnDelete CASCADE`),
`content` text, `type` enum `MCQ`/`ESSAY` (`QuestionType`), `options` jsonb
`string[]`, `correct_answers` jsonb `number[]`, `points` int default 1,
`position` int default 0, timestamps.

- [ ] **Step 3: QuizAttempt entity**

`quiz_attempts` table: uuid id, `quiz_id` FK → `Quiz` (`OnDelete RESTRICT`),
`learner_id` uuid nullable, `score` int nullable, `answers` jsonb nullable,
`started_at` / `submitted_at` timestamp nullable, timestamps. Write/grade logic
is T1-12; only shape + RESTRICT FK now.

- [ ] **Step 4: DTOs**

`CreateQuizDto` (`title`, optional `description`, optional
`timeLimitMinutes`, optional `passScore` default 70, optional nested
`questions: CreateQuestionDto[]`); `UpdateQuizDto` (all optional);
`CreateQuestionDto` / `UpdateQuestionDto` (`type` `@IsEnum`, `content`,
performance `points` 1–1000, optional `options` `string[]` max 10, optional
`correctAnswers` `number[]`); `ReorderQuestionsDto` (`orderedIds` uuid array).
Response interfaces: `QuestionResponse`, `QuizResponse` (incl. `courseId`,
`totalPoints`, `passScorePoints`), `QuizSummaryResponse` (incl. `questionCount`).

- [ ] **Step 5: Build**

```bash
pnpm build
```

Expected: PASS.

---

### Task 2: Service Implementation

**Related skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/quizzes/quizzes.service.ts`

- [ ] **Step 1: Inject repos + helpers**

Inject `Quiz`, `Question`, `QuizAttempt`, `Lesson`, `Course` repositories and
`DataSource`. Export constants `ATTEMPTS_BLOCKED_DELETE_MESSAGE`,
`ATTEMPTS_BLOCKED_QUESTION_MESSAGE`, `ATTEMPTS_BLOCKED_PASS_SCORE_MESSAGE` and
the pure helper `computePassScorePoints(totalPoints, passScore)`.

- [ ] **Step 2: Ownership + validation helpers**

`assertLessonOwnership(courseId, lessonId, instructorId)` (404/400/403);
`getOwnedQuizEntity` (loads `lesson.course` and `questions`, 404/403);
`getOwnedQuestionEntity` (loads `quiz.lesson.course`, 404/403);
`assertNoAttempts(quizId, message)` (409 when count > 0);
`normalizeQuestionPayload` (MCQ rules + essay-forces-empty);
`reindexQuestionPositions` via queryRunner transaction.

- [ ] **Step 3: CRUD methods**

`create`, `listByLesson`, `findOne`, `update` (block passScore when attempts),
`remove` (assertNoAttempts + catch FK 23503 → 409), `addQuestion`,
`updateQuestion` (full-replace merge then normalize), `removeQuestion`,
`reorderQuestions` (exact-id-set check then positional write).

- [ ] **Step 4: Response mappers**

`toQuestionResponse`; `toQuizResponse` (sort by position/createdAt, sum points,
compute `passScorePoints`); `toQuizSummaryResponse` (with `questionCount`).

- [ ] **Step 5: Build + module wiring**

Register `QuizzesModule` in `src/app.module.ts` (imports the 5 entity repos,
exports `QuizzesService`). `pnpm build` PASS.

---

### Task 3: Controller Layer

**Related skills:** `nestjs-patterns`

**Files:**
- Create: `src/modules/quizzes/quizzes.controller.ts`

- [ ] **Step 1: Four controllers**

`QuizzesController` (`courses/:courseId/lessons/:lessonId/quiz` POST/GET),
`QuizQuestionsController` (`quizzes/:quizId/questions` POST, PATCH `reorder`),
`QuizManageController` (`quizzes/:id` GET/PATCH/DELETE),
`QuestionManageController` (`questions/:id` PATCH/DELETE). Every route
`@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(UserRole.INSTRUCTOR)`;
`@CurrentUser('id')`.

- [ ] **Step 2: Build**

`pnpm build` PASS.

---

### Task 4: Service + Controller Tests (Tests First)

**Related skills:** `test-driven-development`

**Files:**
- Create: `src/modules/quizzes/quizzes.service.spec.ts`
- Create: `src/modules/quizzes/quizzes.controller.spec.ts`

- [ ] **Step 1: Service spec**

Factories `makeCourse/makeLesson/makeQuiz/makeQuestion`. Cover: ownership;
create scenario (1 MCQ 5 pts + 1 essay 10 pts, pass 70% ⇒ totalPoints 15,
passScorePoints 11); create defaults; MCQ validation; listByLesson summaries;
findOne; update metadata + pass-score block; remove (none / attempts-block /
FK-23503); add/update/remove/reorder questions; computePassScorePoints; DTO
validation.

- [ ] **Step 2: Controller spec**

Delegation for every route + `@Roles(INSTRUCTOR)` metadata check + guard
smoke test (mirror `courses.controller.spec.ts`).

- [ ] **Step 3: Run focused tests**

```bash
pnpm test quizzes
```

Expected: PASS.

---

### Task 5: E2E (quiz CRUD + attempts-block DoD)

**Related skills:** `verification-before-completion`

**Files:**
- Create: `test/quizzes.e2e-spec.ts` (mirror `test/auth.e2e-spec.ts`)

- [ ] **Step 1: Write the e2e spec**

Register an instructor, login, `POST /courses`, `POST /courses/:id/lessons`
(text fields only). Then:
- POST quiz with 1 MCQ + 1 essay, pass 70% ⇒ 201, totalPoints 15,
  passScorePoints 11, ordered questions;
- GET list summaries with counts/total points;
- edit quiz metadata + a question, add one, reorder, delete a question,
  verify positions;
- insert a `QuizAttempt` directly via repo ⇒ DELETE quiz 409, PATCH passScore
  409, POST question 409; remove attempt ⇒ DELETE 204;
- unauthenticated route ⇒ 401.

- [ ] **Step 2: Run the e2e**

```bash
pnpm test:e2e quizzes
```

Expected: PASS (Postgres/Redis/MongoDB/MinIO reachable).

---

### Task 6: Full Verification

**Related skills:** `verification-before-completion`

- [ ] **Step 1: Full unit tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Build**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: PASS (0 errors; pre-existing warnings in `test/` are acceptable).

---

## Manual Smoke Checklist

- Start backend with reachable Postgres/Redis/MongoDB/MinIO.
- Create a course + lesson, then POST a quiz with an MCQ (options + correct
  answers) and an essay, pass 70%.
- Confirm totalPoints and passScorePoints in the response.
- PATCH a question (MCQ↔essay switch), add one, reorder via `orderedIds`.
- Insert a QuizAttempt row and confirm DELETE quiz / PATCH passScore / POST
  question all return 409 with the documented messages; delete the attempt
  and confirm the quiz can be deleted.
- Confirm a learner (or unauthenticated) request is rejected.

## Completion Criteria

- `QuizzesModule` registered; build, unit, and e2e suites green.
- Quiz CRUD + question CRUD + reorder; points summed; `passScorePoints` from
  percentage.
- Delete-with-attempts block returns 409 with exported messages (and RESTRICT
  FK safety net).
- Every endpoint is Instructor-only and ownership-guarded.
- `test/quizzes.e2e-spec.ts` satisfies the "quiz CRUD e2e" DoD.
