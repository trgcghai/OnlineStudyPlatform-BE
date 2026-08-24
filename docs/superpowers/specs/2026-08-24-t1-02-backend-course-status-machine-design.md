# T1-02 Backend Design - Course Status Machine

## Context

`T1-02` implements the backend course publication status machine for Instructor-owned courses.

Source task: `ba/tasks/phase-1-lms-core/T1-02-course-status-machine.md`

Traceability: `US-020 S2`, `FR-20`, `BR-01`, `UC07`

Depends on: `T1-01` course CRUD and ownership.

Admin approval UI and Admin approval endpoints belong to `T1-03`. T1-02 provides the status machine and notification persistence that T1-03 will use.

## Scope Decisions

| Decision | Choice |
|---|---|
| Rejection model | Distinct `Rejected` course status plus persisted `rejectReason` |
| Instructor request endpoint | `POST /courses/:id/request-publish` |
| Notification storage | Existing MongoDB notification schema |
| Notification style | Queue notification, not per-Admin direct notification |
| Queue enum | `NotificationQueue.COURSE_APPROVAL = 'course_approval'` |
| Metadata | Include `courseId` and `instructorId` only |
| Cross-store consistency | PostgreSQL transaction plus Mongo write before commit and best-effort compensation |

## Course Status Model

Extend `CourseStatus`:

```ts
export enum CourseStatus {
  DRAFT = 'Draft',
  PENDING = 'Pending',
  PUBLISHED = 'Published',
  REJECTED = 'Rejected',
}
```

Add `rejectReason` to `Course`:

| Field | Persistence | Notes |
|---|---|---|
| `rejectReason` | `reject_reason`, nullable text/varchar | Visible to Instructor when a course is rejected |

Include `rejectReason` in `CourseResponse` so existing Instructor detail/list surfaces can display it.

## Legal Transitions

| From | To | Owner |
|---|---|---|
| `Draft` | `Pending` | T1-02 Instructor request publish |
| `Pending` | `Published` | T1-03 Admin approval service path |
| `Pending` | `Rejected` | T1-03 Admin rejection service path |
| `Rejected` | `Draft` | T1-02 owner metadata update after revision |

Illegal transitions return `400 Bad Request`. Examples:

| From | To | Reason |
|---|---|---|
| `Draft` | `Published` | Instructor cannot publish directly |
| `Draft` | `Rejected` | Only pending requests can be rejected |
| `Pending` | `Draft` | Pending requests must be approved or rejected |
| `Published` | `Pending` | Published course cannot request publish again |
| `Published` | `Rejected` | Published course cannot be rejected through this flow |

## API Design

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/courses/:id/request-publish` | Instructor | Move owned Draft course to Pending and create Admin queue notification |

The existing Instructor controller remains protected by `JwtAuthGuard`, `RolesGuard`, and `UserRole.INSTRUCTOR`.

Admin approval/rejection controller routes are not part of T1-02. Service-level methods for `Pending -> Published` and `Pending -> Rejected` may be added so T1-03 can reuse the same transition checks.

The existing `PATCH /courses/:id` update path should support the `Rejected -> Draft` transition. When an owning Instructor edits course metadata while status is `Rejected`, the backend moves the course to `Draft` and clears `rejectReason`. The Instructor can then call `POST /courses/:id/request-publish` to submit the revised course.

## Request Publish Flow

1. Load the course with its Instructor relation inside the backend operation.
2. If the course does not exist, return `404 Not Found`.
3. If the authenticated Instructor does not own the course, return `403 Forbidden`.
4. If the status is not `Draft`, return `400 Bad Request`.
5. Update the course status to `Pending` and clear `rejectReason`.
6. Create a MongoDB queue notification for `course_approval`.
7. Return the updated course response.

Notification document shape:

```ts
{
  type: NotificationType.QUEUE,
  queue: NotificationQueue.COURSE_APPROVAL,
  title: 'Yêu cầu duyệt khóa học',
  message: `${instructor.name} đã gửi yêu cầu xuất bản khóa học "${course.title}".`,
  actionUrl: '/admin/courses/approvals',
  metadata: {
    courseId,
    instructorId,
  },
  sentAt: new Date(),
}
```

## Notification Module Design

The backend already has `src/modules/notifications` with a Mongoose schema. T1-02 should turn the scaffold into usable persistence for queue notifications.

Notification schema design:

```ts
export enum NotificationType {
  DIRECT = 'direct',
  QUEUE = 'queue',
}

export enum NotificationQueue {
  COURSE_APPROVAL = 'course_approval',
}
```

Fields:

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `direct` or `queue` |
| `userId` | no | Used by direct notifications later |
| `queue` | required for queue notifications | Enum for queue names; only `course_approval` for now |
| `title` | yes | Human-readable title |
| `message` | yes | Human-readable message |
| `actionUrl` | no | Frontend deep link |
| `metadata` | no | Flexible payload; T1-02 uses `courseId`, `instructorId` |
| `sentAt` | no | Set when created by T1-02 |

Implementation notes:

- Register `Notification` with `MongooseModule.forFeature` in `NotificationsModule`.
- Export `NotificationsService` from `NotificationsModule`.
- Add a narrow method such as `createQueueNotification(input)` instead of exposing broad unvalidated CRUD behavior.
- Keep notification center APIs minimal or non-functional if they are not needed for T1-02; Phase 3 owns notification center UI.

## Cross-Store Consistency

Courses are stored in PostgreSQL and notifications are stored in MongoDB, so there is no simple single ACID transaction across both stores.

T1-02 uses practical consistency:

1. Start a TypeORM PostgreSQL transaction with a manual `QueryRunner` so commit failures can be handled after the Mongo write.
2. Validate course existence, ownership, and status inside the transaction.
3. Save course status as `Pending` inside the transaction.
4. Create the MongoDB notification before the PostgreSQL transaction commits.
5. If Mongo notification creation fails, throw `500`; the PostgreSQL transaction rolls back.
6. If PostgreSQL save fails, the Mongo notification is never created.
7. If PostgreSQL commit fails after Mongo notification creation, delete the created Mongo notification by id as best-effort compensation, return `5xx`, and avoid claiming success.

This is not a distributed transaction, but it prevents normal server failures from leaving a successful course status update without a queued approval notification.

## Error Handling

Client or validation failures return `4xx` and perform no writes:

| Case | Result |
|---|---|
| Course not found | `404 Not Found` |
| Non-owner Instructor | `403 Forbidden` |
| Illegal transition | `400 Bad Request` |
| Invalid request data | `400 Bad Request` |

Server failures return `5xx` and roll back or compensate:

| Case | Result |
|---|---|
| PostgreSQL save/transaction fails | `500 Internal Server Error` |
| Mongo notification create fails | `500 Internal Server Error`, PostgreSQL rollback |
| Compensation delete fails | `500 Internal Server Error`, log/avoid success response |

## BR-01 Enrollability Rule

T1-02 must define the API-level rule: only `Published` courses are enrollable.

There is no enrollment module in the current backend. T1-02 should provide a clear service-level helper or documented seam, such as `assertCourseIsPublishedForEnrollment(course)`, for T1-09 to call when enrollment is implemented.

## Backend Components

| File | Purpose |
|---|---|
| `src/modules/courses/entities/course.entity.ts` | Add `Rejected` and `rejectReason` |
| `src/modules/courses/dto/course.dto.ts` | Include `rejectReason` in response shape |
| `src/modules/courses/courses.controller.ts` | Add Instructor request-publish endpoint |
| `src/modules/courses/courses.service.ts` | Own transition checks, request publish, transaction orchestration |
| `src/modules/courses/courses.service.spec.ts` | Status machine and notification rollback tests |
| `src/modules/courses/courses.controller.spec.ts` | Endpoint delegation and RBAC coverage |
| `src/modules/notifications/entities/notification.entity.ts` | Add `NotificationQueue` enum and queue validation |
| `src/modules/notifications/notifications.module.ts` | Register Mongoose schema and export service |
| `src/modules/notifications/notifications.service.ts` | Persist queue notifications |

## Testing

Minimum unit coverage:

| Area | Test |
|---|---|
| Draft request publish | Owner moves `Draft -> Pending` |
| Notification create | Request publish creates one `course_approval` queue notification |
| Message content | Notification message includes Instructor name and Course title |
| Reject reason reset | Request publish clears stale `rejectReason` |
| Rejected revision | Owner metadata update moves `Rejected -> Draft` and clears `rejectReason` |
| Ownership | Non-owner request publish returns `403` and creates no notification |
| Not found | Missing course returns `404` and creates no notification |
| Illegal transitions | Non-Draft request publish returns `400` |
| Legal transition table | All expected legal transitions are accepted by transition guard |
| Illegal transition table | Invalid transitions are rejected by transition guard |
| Mongo failure | Notification failure rolls back course status and returns `5xx` |
| Controller | `requestPublish` delegates with course id and current user id |

Verification commands for implementation phase:

```bash
pnpm test courses.service
pnpm test notifications.service
pnpm build
```

`pnpm lint` can be run after implementation, but it uses `--fix` and may modify files.
