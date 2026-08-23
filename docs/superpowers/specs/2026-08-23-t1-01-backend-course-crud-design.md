# T1-01 Backend Design - Course CRUD + Ownership

## Context

`T1-01` implements the backend part of Course CRUD for Instructor-owned courses.

Source task: `ba/tasks/phase-1-lms-core/T1-01-course-crud.md`

Traceability: `US-020 S1/S3`, `FR-20`, `UC07`

Status transitions beyond initial `Draft`, including publish request and Admin approval, are out of scope and belong to `T1-02`.

## Scope Decisions

| Decision | Choice |
|---|---|
| Thumbnail upload | Separate endpoint: `POST /courses/:id/thumbnail` |
| `price` field | Excluded for now; follow the `T1-01` task draft |
| Ownership delete rule | Non-owner delete returns `403`, no deletion |
| List endpoint | Supports pagination and filtering |

## Course Shape

| Field | Notes |
|---|---|
| `id` | UUID primary key |
| `title` | Required string, trimmed |
| `description` | Required string, trimmed |
| `category` | Required string, selected from frontend constants for now |
| `thumbnail` | Nullable MinIO public URL |
| `status` | `CourseStatus` enum, default `Draft` |
| `instructorId` | Owner foreign key to `User` |
| `createdAt` | TypeORM create timestamp |
| `updatedAt` | TypeORM update timestamp |

The broader document class diagram includes `price`, but this task intentionally leaves it out because `T1-01` only requires `title`, `description`, `category`, and `thumbnail`.

## API Design

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/courses` | Create a `Draft` course for the current Instructor |
| `GET` | `/courses/me` | List current Instructor's courses with pagination and filtering |
| `GET` | `/courses/:id` | Get owned course detail |
| `PATCH` | `/courses/:id` | Edit owned course metadata |
| `POST` | `/courses/:id/thumbnail` | Upload or replace owned course thumbnail |
| `DELETE` | `/courses/:id` | Delete owned course if no enrollments exist |

All endpoints require `JwtAuthGuard`, `RolesGuard`, and `UserRole.INSTRUCTOR`.

## DTOs

### Create Course

Fields:

| Field | Validation |
|---|---|
| `title` | string, trimmed, length-bounded |
| `description` | string, trimmed, length-bounded |
| `category` | string, trimmed, length-bounded |

The service always sets `status` to `Draft` and `instructorId` to the current authenticated user.

### Update Course

Fields are optional:

| Field | Validation |
|---|---|
| `title` | optional string, trimmed, length-bounded |
| `description` | optional string, trimmed, length-bounded |
| `category` | optional string, trimmed, length-bounded |

If no supported field is provided, the service rejects with `400 Bad Request`.

### List Courses Query

| Query | Behavior |
|---|---|
| `page` | default `1`, minimum `1` |
| `limit` | default `10`, maximum `100` |
| `q` | optional search by `title` or `description` |
| `category` | optional exact category filter |
| `status` | optional `CourseStatus` filter |
| `sortBy` | optional, default `createdAt`; allowed values: `createdAt`, `updatedAt`, `title`, `category`, `status` |
| `sortOrder` | optional `ASC` or `DESC`, default `DESC` |

Return shape:

```ts
{
  items: CourseResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

## Thumbnail Upload

Thumbnail upload follows the existing avatar upload pattern:

| Concern | Design |
|---|---|
| Field name | `thumbnail` |
| Storage | MinIO bucket from `MINIO_BUCKET` |
| Object key | `courses/{courseId}/thumbnails/{uuid}.{extension}` |
| Allowed types | JPEG, PNG, WebP, GIF |
| Max size | Reuse the existing avatar limit: 5 MB |
| URL | Public object URL built from `MINIO_ENDPOINT`, bucket, and object key |
| Replacement cleanup | Best-effort deletion of previous thumbnail object |

The service must check ownership before uploading to MinIO. If the current Instructor does not own the course, return `403` and do not upload.

## Ownership And Error Rules

| Case | Result |
|---|---|
| Non-Instructor accesses Instructor course endpoints | `403 Forbidden` |
| Instructor edits another Instructor's course | `403 Forbidden`, no modification |
| Instructor deletes another Instructor's course | `403 Forbidden`, no deletion |
| Instructor uploads thumbnail to another Instructor's course | `403 Forbidden`, no upload/course change |
| Course ID does not exist | `404 Not Found` |
| Delete course with enrollments | `409 Conflict` |
| Invalid thumbnail file | `400 Bad Request` |
| MinIO upload fails | `500 Internal Server Error`, metadata unchanged |

Ownership checks live in `CoursesService`, not only in the controller, so direct service tests can verify the rule.

## Delete Rule

`T1-01` requires deletion only if the course has no enrollments. Enrollment implementation is scheduled later, so the design should keep a clear seam for `T1-09`.

Add an `assertCourseCanBeDeleted(courseId)` method so the business rule has a dedicated location. For `T1-01`, it allows deletion after ownership is verified. When `T1-09` adds enrollments, extend this method to query enrollments and throw `409 Conflict` when at least one enrollment exists.

## Backend Components

Add a dedicated `courses` module:

| File | Purpose |
|---|---|
| `src/modules/courses/courses.module.ts` | Registers TypeORM repository and controller/service |
| `src/modules/courses/entities/course.entity.ts` | Course entity and `CourseStatus` enum |
| `src/modules/courses/dto/course.dto.ts` | Create, update, list query DTOs and response shapes |
| `src/modules/courses/courses.controller.ts` | Instructor course endpoints |
| `src/modules/courses/courses.service.ts` | Persistence, ownership, thumbnail, delete rules |
| `src/modules/courses/courses.service.spec.ts` | Unit tests for core backend behavior |

Register `CoursesModule` in `AppModule`. TypeORM uses `autoLoadEntities: true` and `synchronize: true`, so no migration is required in this repository.

## Testing

Minimum unit coverage:

| Area | Test |
|---|---|
| Create | Creates a `Draft` course owned by current Instructor |
| List | Returns only current Instructor's courses |
| List filters | Supports pagination, `q`, `category`, `status`, and sorting |
| Edit | Owner can update course metadata |
| Edit ownership | Non-owner update returns `403` and does not save changes |
| Delete | Owner can delete when no enrollments exist |
| Delete ownership | Non-owner delete returns `403` and does not delete |
| Thumbnail ownership | Non-owner thumbnail upload returns `403` before MinIO upload |
| Thumbnail upload | Owner upload stores file and updates thumbnail URL |

Verification commands for implementation phase:

```bash
pnpm test courses.service
pnpm build
```

`pnpm lint` can be run after implementation, but it uses `--fix` and may modify files.
