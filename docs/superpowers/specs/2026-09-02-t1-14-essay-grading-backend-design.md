# T1-14 Essay Grading Backend Design

## Task

- Source: `ba/tasks/phase-1-lms-core/T1-14-essay-grading.md`
- User story: as an instructor, I want to grade essay answers with feedback, so subjective assessment is possible.
- Scope for this spec: backend only.

## Goals

- Provide an instructor-only pending grading queue for submitted quiz attempts that contain essay answers.
- Allow instructors to grade a learner essay answer with flat points and written feedback.
- Recompute the quiz attempt result after grading.
- Re-evaluate BR-03 lesson/course progress when essay grading flips an attempt from not passed to passed.
- Expose learner-visible grade and feedback through existing attempt result/history responses.

## Existing State

- `QuizAttempt` already stores `answers`, `gradingResult`, `score`, `passed`, `status`, `correctCount`, `wrongCount`, and `pendingEssayCount`.
- Essay answers are currently stored in `gradingResult` as question results with `score: 0` and `status: "pending_grading"`.
- `QuizAttemptsService.submitAttempt()` currently computes pass/fail immediately from total score.
- `LearningProgressService.recomputeLessonAndEnrollmentProgress()` already supports BR-03 recomputation after a passed quiz attempt.
- TypeORM `synchronize: true` is enabled, so no migration is needed for DTO-only/jsonb shape changes.

## Approved Decision

Attempts with any pending essay answers must not be marked as passed, even if the auto-graded MCQ score reaches the pass threshold.

Pass condition:

```ts
passed = totalScore >= passScorePoints && pendingEssayCount === 0;
```

This prevents progress unlock before instructor grading is complete.

## API Design

### List Essay Grading Submissions

`GET /courses/:courseId/quizzes/:quizId/essay-grading?status=pending|graded|all`

Default `status`: `pending`.

Access:

- Require `JwtAuthGuard`.
- Require `RolesGuard`.
- Require `UserRole.INSTRUCTOR`.
- Verify the quiz belongs to the requested course through its lesson.
- Verify `course.instructorId === currentUser.id`.

Behavior:

- Return submitted attempts only.
- Return attempts whose `gradingResult` contains at least one essay question result.
- For `pending`, include attempts with at least one essay result where `status === "pending_grading"`.
- For `graded`, include attempts with essay results and no pending essay results.
- For `all`, include both pending and graded attempts.
- Sort newest submissions first.

Response shape:

```ts
interface EssayGradingSubmissionResponse {
  attemptId: string;
  quizId: string;
  learner: {
    id: string;
    name: string;
    email: string;
  };
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
```

### Grade Essay Answer

`PATCH /courses/:courseId/quizzes/:quizId/attempts/:attemptId/essay/:questionId`

Access:

- Same instructor and course ownership checks as the queue endpoint.

Request body:

```ts
interface GradeEssayAnswerDto {
  points: number;
  feedback?: string;
}
```

Validation:

- `points` is numeric.
- `points >= 0`.
- `points <= question.points`.
- `feedback` is optional text with a bounded max length.
- Target question must belong to the quiz.
- Target question must be `QuestionType.ESSAY`.
- Target attempt must belong to the quiz and be submitted.
- Target attempt `gradingResult` must contain the essay result.

Response:

- Return the updated `QuizAttemptResultResponse` so the frontend can refresh total score, pass/fail, pending count, essay score, and feedback from one response.

## Data Shape Changes

Extend `QuizAttemptQuestionResult` with optional manual grading metadata:

```ts
interface QuizAttemptQuestionResult {
  questionId: string;
  type: QuestionType;
  selectedOptionIndexes?: number[];
  text?: string;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  status: QuizAttemptQuestionStatus;
  feedback?: string;
  gradedAt?: string;
  gradedBy?: string;
}
```

No new table is required for T1-14 because the existing attempt snapshot already stores per-question grading results in `jsonb`.

## Service Design

Add a focused `EssayGradingService` to keep manual grading separate from learner submission logic.

Dependencies:

- `Course` repository.
- `Quiz` repository.
- `QuizAttempt` repository.
- `User` repository for learner display fields.
- `DataSource` for pessimistic locking while grading.
- `LearningProgressService` for BR-03 recompute.
- Optional `LearningAnalyticsEvent` repository if adding a `quiz_essay_graded` analytics event.

Key methods:

- `listSubmissions(instructorId, courseId, quizId, filter)`.
- `gradeEssay(instructorId, courseId, quizId, attemptId, questionId, dto)`.

Shared helper behavior:

- `loadInstructorQuizContext()` loads quiz with `lesson`, `lesson.course`, and `questions`, then validates ownership.
- `getEssayResults()` combines stored grading results with question metadata to build queue rows.
- `recomputeAttemptFromResults()` recalculates score, counts, pending essay count, pass/fail, and status.

## Grading Algorithm

When saving a grade:

1. Load and ownership-check the quiz context.
2. Start a transaction.
3. Lock the target `QuizAttempt` with `pessimistic_write`.
4. Validate the attempt is submitted and belongs to the quiz.
5. Find the target essay question and stored essay result.
6. Validate `points <= question.points`.
7. Replace only the target essay result fields:
   - Preserve `questionId`, `type`, `text`, and `maxScore`.
   - Set `score` to `points`.
   - Set `feedback`.
   - Set `gradedAt` to current timestamp.
   - Set `gradedBy` to instructor id.
   - Set `isCorrect` to `points === maxScore`.
   - Set `status` to `correct`, `partial`, or `wrong`.
8. Recompute attempt fields from all question results.
9. Save the attempt.
10. Commit the transaction.
11. If `passed` changed from `false` to `true`, call BR-03 progress recompute.
12. Return the updated attempt result.

Status mapping:

```ts
status = points === maxScore ? 'correct' : points > 0 ? 'partial' : 'wrong';
```

Attempt recompute:

```ts
totalScore = sum(question.score);
pendingEssayCount = count(essayResult.status === 'pending_grading');
passed = totalScore >= passScorePoints && pendingEssayCount === 0;
status = passed ? QuizAttemptStatus.PASSED : QuizAttemptStatus.NOT_PASSED;
correctCount = count(question.status === 'correct');
wrongCount = count(question.status === 'wrong');
```

## Submission Change

Update learner submission grading to use the same pass rule:

```ts
passed = totalScore >= passScorePoints && pendingEssayCount === 0;
```

This means a quiz with pending essays remains `not_passed` until grading is complete.

## Error Handling

- Course not found: `NotFoundException`.
- Course exists but is not owned by the instructor: `ForbiddenException`.
- Quiz not found under course: `NotFoundException`.
- Attempt not found under quiz: `NotFoundException`.
- Attempt not submitted: `ConflictException`.
- Question not found or not essay: `BadRequestException`.
- Missing stored essay result: `ConflictException` because the submitted attempt snapshot is inconsistent.
- Points above max score: `BadRequestException`.

## Tests

Add focused unit tests for the new service and update learner attempt tests.

Required coverage:

- Submission with pending essay does not pass even when MCQ score reaches threshold.
- Pending queue returns submitted attempts with at least one pending essay.
- Graded queue returns submitted attempts with essays and no pending essays.
- `all` queue returns both pending and graded essay submissions.
- Queue rejects non-owner instructor.
- Grade rejects points above essay max score.
- Grade rejects non-essay questions.
- Grade persists points, feedback, `gradedAt`, and `gradedBy`.
- Grade recomputes total score, `pendingEssayCount`, `passed`, `status`, and counts.
- Grade does not recompute progress when attempt remains not passed.
- Grade calls `recomputeLessonAndEnrollmentProgress()` when grading flips attempt from not passed to passed.

Verification commands:

```bash
pnpm test quiz-attempts.service
pnpm test essay-grading.service
pnpm build
pnpm test
```

Avoid `pnpm lint` until the implementation is ready because the backend lint script runs with `--fix` and can mutate files.

## Implementation Files

- `src/modules/quizzes/dto/quiz-attempt.dto.ts`
- `src/modules/quizzes/dto/essay-grading.dto.ts`
- `src/modules/quizzes/essay-grading.controller.ts`
- `src/modules/quizzes/essay-grading.service.ts`
- `src/modules/quizzes/essay-grading.service.spec.ts`
- `src/modules/quizzes/quiz-attempts.service.ts`
- `src/modules/quizzes/quiz-attempts.service.spec.ts`
- `src/modules/quizzes/quizzes.module.ts`

## Non-Goals

- No rubric UI or rubric scoring model.
- No separate essay grading table.
- No frontend implementation in this backend spec.
- No migration unless future persistence requirements move grading metadata out of `gradingResult`.
