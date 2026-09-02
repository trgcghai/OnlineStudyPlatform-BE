# T1-14 Backend Essay Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the backend manual essay grading flow for instructors: queue submitted essay answers, save flat points and feedback, recompute quiz pass/fail, and re-evaluate BR-03 progress when grading flips an attempt to passed.

**Architecture:** Add a focused `EssayGradingController` and `EssayGradingService` inside `QuizzesModule`. Reuse the existing `QuizAttempt.gradingResult` jsonb snapshot for per-question essay grading metadata. Keep learner submission in `QuizAttemptsService`, but change its pass rule so attempts with pending essays cannot pass before manual grading completes.

**Tech Stack:** NestJS 11, TypeScript, TypeORM, PostgreSQL, Jest, class-validator, pnpm.

**Approved Design:** `docs/superpowers/specs/2026-09-02-t1-14-essay-grading-backend-design.md`

**Repository Rules:** Work inside `online-study-platform-be`. Use relative imports. Use `pnpm` only. Do not commit unless the user explicitly asks. Avoid `pnpm lint` until ready because it runs ESLint with `--fix`.

---

## File Structure

- Create: `src/modules/quizzes/dto/essay-grading.dto.ts`
- Create: `src/modules/quizzes/essay-grading.controller.ts`
- Create: `src/modules/quizzes/essay-grading.service.ts`
- Create: `src/modules/quizzes/essay-grading.service.spec.ts`
- Create: `src/modules/quizzes/essay-grading.controller.spec.ts`
- Modify: `src/modules/quizzes/dto/quiz-attempt.dto.ts`
- Modify: `src/modules/quizzes/quiz-attempts.service.ts`
- Modify: `src/modules/quizzes/quiz-attempts.service.spec.ts`
- Modify: `src/modules/quizzes/quizzes.module.ts`

---

### Task 1: DTO And Response Shapes

**Related skills:** `nestjs-patterns`, `test-driven-development`

**Files:**
- Modify: `src/modules/quizzes/dto/quiz-attempt.dto.ts`
- Create: `src/modules/quizzes/dto/essay-grading.dto.ts`

- [ ] **Step 1: Extend learner-visible question results**

Add optional manual grading metadata to `QuizAttemptQuestionResult`:

```ts
feedback?: string;
gradedAt?: string;
gradedBy?: string;
```

Keep existing fields unchanged so existing learner result/history consumers continue to work.

- [ ] **Step 2: Add grading filter enum**

Create `EssayGradingStatusFilter` with values:

```ts
PENDING = 'pending'
GRADED = 'graded'
ALL = 'all'
```

Use `pending` as the default at service/controller boundaries.

- [ ] **Step 3: Add list query DTO**

Create `ListEssayGradingSubmissionsQueryDto`:

- Optional `status`.
- `@IsEnum(EssayGradingStatusFilter)`.

- [ ] **Step 4: Add grade payload DTO**

Create `GradeEssayAnswerDto`:

- `points`: `@IsNumber()`, `@Min(0)`.
- `feedback`: optional string, length-bounded.

Do not validate max points in the DTO because it depends on the target question; validate it in the service.

- [ ] **Step 5: Add response interfaces**

Create interfaces for queue rows:

```ts
interface EssayGradingLearnerResponse {
  id: string;
  name: string;
  email: string;
}

interface EssayGradingQuestionResponse {
  questionId: string;
  content: string;
  text: string;
  score: number;
  maxScore: number;
  status: QuizAttemptQuestionStatus;
  feedback?: string;
  gradedAt?: string;
  gradedBy?: string;
}

interface EssayGradingSubmissionResponse {
  attemptId: string;
  quizId: string;
  learner: EssayGradingLearnerResponse;
  submittedAt: Date | null;
  totalScore: number;
  totalPoints: number;
  passScore: number;
  passScorePoints: number;
  passed: boolean;
  status: QuizAttemptStatus;
  pendingEssayCount: number;
  essays: EssayGradingQuestionResponse[];
}
```

- [ ] **Step 6: Build check**

```bash
pnpm build
```

Expected: PASS.

---

### Task 2: Submission Pass Rule Fix

**Related skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Modify: `src/modules/quizzes/quiz-attempts.service.spec.ts`
- Modify: `src/modules/quizzes/quiz-attempts.service.ts`

- [ ] **Step 1: Add failing test first**

Add a test where a quiz has one MCQ and one essay, the MCQ score alone reaches `passScorePoints`, and the essay remains `pending_grading`.

Expected result:

- `passed === false`.
- `status === QuizAttemptStatus.NOT_PASSED`.
- `pendingEssayCount === 1`.
- `recomputeLessonAndEnrollmentProgress` is not called.

- [ ] **Step 2: Run focused test and confirm failure**

```bash
pnpm test quiz-attempts.service
```

Expected: FAIL for the new pass-rule test before implementation.

- [ ] **Step 3: Update grading pass calculation**

In `QuizAttemptsService.gradeQuiz()`, compute `pendingEssayCount` before `passed`, then use:

```ts
const passed = totalScore >= passScorePoints && pendingEssayCount === 0;
```

Set attempt status from this updated `passed` value.

- [ ] **Step 4: Run focused test again**

```bash
pnpm test quiz-attempts.service
```

Expected: PASS.

---

### Task 3: Essay Grading Service Tests First

**Related skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/quizzes/essay-grading.service.spec.ts`
- Later target: `src/modules/quizzes/essay-grading.service.ts`

- [ ] **Step 1: Set up service test factories**

Create factories for:

- Owned `Course` with `instructorId`.
- `Lesson` linked to the course.
- `Quiz` with MCQ and essay questions.
- Submitted `QuizAttempt` with `gradingResult` snapshots.
- `User` learner rows.
- Mock repositories and query runner.

- [ ] **Step 2: Write queue tests**

Cover:

- Pending queue returns submitted attempts with at least one pending essay.
- Graded queue returns attempts with essays and no pending essays.
- `all` returns both pending and graded essay submissions.
- Attempts without essays are excluded.
- In-progress attempts are excluded.
- Non-owner instructor gets `ForbiddenException`.

- [ ] **Step 3: Write grade validation tests**

Cover:

- Points above essay max returns `BadRequestException`.
- Non-essay target question returns `BadRequestException`.
- Missing submitted attempt returns `NotFoundException`.
- In-progress attempt returns `ConflictException`.
- Missing stored essay result returns `ConflictException`.

- [ ] **Step 4: Write recompute tests**

Cover:

- Grading persists score, feedback, `gradedAt`, and `gradedBy`.
- `pendingEssayCount` decrements after grading.
- Attempt `score`, `status`, `passed`, `correctCount`, and `wrongCount` are recomputed.
- Progress recompute is not called if the attempt remains not passed.
- Progress recompute is called when grading flips the attempt from not passed to passed.

- [ ] **Step 5: Run focused test and confirm failure**

```bash
pnpm test essay-grading.service
```

Expected: FAIL because the service does not exist yet.

---

### Task 4: Essay Grading Service Implementation

**Related skills:** `test-driven-development`, `nestjs-patterns`, `systematic-debugging`

**Files:**
- Create: `src/modules/quizzes/essay-grading.service.ts`
- Test: `src/modules/quizzes/essay-grading.service.spec.ts`

- [ ] **Step 1: Implement dependencies and context loading**

Inject repositories for `Course`, `Quiz`, `QuizAttempt`, and `User`. Inject `DataSource` and `LearningProgressService`.

Implement `loadInstructorQuizContext(instructorId, courseId, quizId)`:

- Find course by `courseId`, else `NotFoundException`.
- Reject if `course.instructorId !== instructorId` with `ForbiddenException`.
- Find quiz by `quizId` through the lesson/course relation with questions loaded, else `NotFoundException`.
- Return `{ course, lesson, quiz, questions }` or equivalent.

- [ ] **Step 2: Implement queue list**

Implement `listSubmissions(instructorId, courseId, quizId, query)`:

- Validate ownership through context helper.
- Load submitted attempts for `quizId`, newest first.
- Include learner display data from `User` repository.
- Build essay rows by matching stored essay results to quiz questions.
- Filter by `pending`, `graded`, or `all`.
- Return queue response rows.

- [ ] **Step 3: Implement grading transaction**

Implement `gradeEssay(instructorId, courseId, quizId, attemptId, questionId, dto)`:

- Validate ownership through context helper.
- Start a query runner transaction.
- Lock target `QuizAttempt` using `pessimistic_write`.
- Validate attempt belongs to quiz and is submitted.
- Validate target question belongs to quiz and is `QuestionType.ESSAY`.
- Validate `dto.points <= question.points`.
- Validate stored `gradingResult` has the target essay result.

- [ ] **Step 4: Update target essay result**

Preserve existing answer text and question metadata. Set:

- `score = dto.points`.
- `feedback = dto.feedback ?? ''`.
- `gradedAt = new Date().toISOString()`.
- `gradedBy = instructorId`.
- `isCorrect = dto.points === maxScore`.
- `status = 'correct' | 'partial' | 'wrong'`.

- [ ] **Step 5: Recompute attempt snapshot**

From all question results:

- Sum `score` into `attempt.score`.
- Recompute `pendingEssayCount`.
- Recompute `passed = score >= passScorePoints && pendingEssayCount === 0`.
- Recompute `status` from `passed`.
- Recompute `correctCount` and `wrongCount`.
- Save attempt inside transaction.

- [ ] **Step 6: Trigger BR-03 when pass flips**

Capture previous `attempt.passed` before mutation. After commit, if previous was false and saved is true, call:

```ts
this.learningProgressService.recomputeLessonAndEnrollmentProgress(
  saved.learnerId,
  courseId,
  quiz.lessonId,
);
```

- [ ] **Step 7: Return updated attempt result**

Return a `QuizAttemptResultResponse`-compatible object. Prefer a local mapper if `QuizAttemptsService.toAttemptResult()` remains private.

- [ ] **Step 8: Run focused service tests**

```bash
pnpm test essay-grading.service
```

Expected: PASS.

---

### Task 5: Essay Grading Controller And Module Wiring

**Related skills:** `nestjs-patterns`, `test-driven-development`

**Files:**
- Create: `src/modules/quizzes/essay-grading.controller.ts`
- Create: `src/modules/quizzes/essay-grading.controller.spec.ts`
- Modify: `src/modules/quizzes/quizzes.module.ts`

- [ ] **Step 1: Write controller tests first**

Cover:

- `GET /courses/:courseId/quizzes/:quizId/essay-grading` delegates to service with current instructor id and query DTO.
- `PATCH /courses/:courseId/quizzes/:quizId/attempts/:attemptId/essay/:questionId` delegates to service with path params, current instructor id, and DTO.
- Controller has `JwtAuthGuard` and `RolesGuard`.
- Controller requires `UserRole.INSTRUCTOR`.

- [ ] **Step 2: Run controller tests and confirm failure**

```bash
pnpm test essay-grading.controller
```

Expected: FAIL because the controller does not exist yet.

- [ ] **Step 3: Implement controller**

Create `EssayGradingController` with route prefix `courses/:courseId/quizzes/:quizId/essay-grading`:

- `GET ''` maps to `listSubmissions()`.
- `PATCH 'attempts/:attemptId/essay/:questionId'` maps to `gradeEssay()`.
- Apply `@UseGuards(JwtAuthGuard, RolesGuard)`.
- Apply `@Roles(UserRole.INSTRUCTOR)`.
- Use `@CurrentUser('id')` for instructor id.

- [ ] **Step 4: Register module dependencies**

Update `QuizzesModule`:

- Add `User` to `TypeOrmModule.forFeature()`.
- Add `EssayGradingController` to controllers.
- Add `EssayGradingService` to providers.

- [ ] **Step 5: Run controller tests**

```bash
pnpm test essay-grading.controller
```

Expected: PASS.

---

### Task 6: Integration Polish And Focused Verification

**Related skills:** `systematic-debugging`, `verification-before-completion`

**Files:**
- Modify as needed only in files touched by Tasks 1-5.

- [ ] **Step 1: Run quiz attempt tests**

```bash
pnpm test quiz-attempts.service
```

Expected: PASS.

- [ ] **Step 2: Run essay grading tests**

```bash
pnpm test essay-grading.service
pnpm test essay-grading.controller
```

Expected: PASS.

- [ ] **Step 3: Run build**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Fix failures systematically**

If tests or build fail, use `systematic-debugging`:

- Read the first failing assertion or compiler error.
- Identify whether it is a test setup issue, typing issue, DI/module wiring issue, or behavior mismatch.
- Make the smallest targeted fix.
- Re-run the focused command before broader verification.

---

### Task 7: Full Verification

**Related skills:** `verification-before-completion`

**Files:**
- No planned file edits unless verification finds a defect.

- [ ] **Step 1: Run all unit tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run build**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Optional lint only after tests/build pass**

```bash
pnpm lint
```

Expected: PASS. Note: this command may mutate files because the repo uses ESLint `--fix`.

---

### Task 8: Final Review

**Related skills:** `requesting-code-review`, `verification-before-completion`

**Files:**
- Review changed files from Tasks 1-7.

- [ ] **Step 1: Inspect worktree**

```bash
git status --short
git diff -- docs/superpowers/specs/2026-09-02-t1-14-essay-grading-backend-design.md docs/superpowers/plans/2026-09-02-t1-14-essay-grading-backend.md src/modules/quizzes
```

Expected: only intended T1-14 backend files changed.

- [ ] **Step 2: Request review**

Use `requesting-code-review` after implementation and verification pass.

Ask the reviewer to focus on:

- Instructor ownership and authorization gaps.
- Pass/recompute behavior with pending essays.
- Transaction safety when two instructors grade the same essay.
- Learner-visible feedback shape.
- Test coverage for BR-03 progress recompute.

- [ ] **Step 3: Summarize results**

Report changed files and exact verification commands/output. Do not claim completion unless verification commands have passed.

---

## Manual Smoke Checklist

Use this after backend implementation if a running local stack is available:

- [ ] Instructor can list pending essay submissions for their own course quiz.
- [ ] Instructor cannot list or grade another instructor's course quiz.
- [ ] Instructor can assign essay points and feedback.
- [ ] Queue state changes from pending to graded after the final essay is graded.
- [ ] Learner attempt result/history includes essay score and feedback.
- [ ] Attempt remains not passed while any essay is pending.
- [ ] Attempt flips to passed after grading if total score reaches the pass threshold.
- [ ] Lesson/course progress is re-evaluated after the pass flip.
