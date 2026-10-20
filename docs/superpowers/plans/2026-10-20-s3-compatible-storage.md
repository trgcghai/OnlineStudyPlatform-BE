# S3-Compatible Storage Client Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove the MinIO SDK client from the backend and use the existing internal and public AWS SDK S3 clients for all storage operations.

**Architecture:** `MINIO_S3_CLIENT` will own all server-side bucket and object commands. `MINIO_PUBLIC_S3_CLIENT` remains for browser-facing presigned URLs. `FileModule` keeps public bucket initialization, and `AppService` keeps the existing `minio` health component while checking the configured bucket through S3.

**Tech Stack:** NestJS 11, TypeScript, AWS SDK v3 `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, Jest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-20-s3-compatible-storage-design.md`

## Global Constraints

- Preserve bucket names, object key formats, public URL formats, environment variable names, API responses, and service-level error behavior.
- Keep `MINIO_S3_CLIENT` for internal operations and `MINIO_PUBLIC_S3_CLIENT` for browser-facing signing.
- Keep public asset bucket initialization and anonymous `s3:GetObject` policy setup in `FileModule`.
- Keep certificates in their separate private bucket without applying the public-read policy.
- Keep the health response component named `minio`.
- Do not change frontend or AI services.

## Review Focus

- A bucket can be missing, already present, or inaccessible during startup; verify create-on-missing and propagation of unrelated S3 failures.
- Public policy application must run for an existing bucket as well as a newly created bucket; verify the exact `PutBucketPolicyCommand` input.
- S3 `GetObject` returns a stream and may fail during consumption; verify existing cleanup/error paths and stream behavior.
- `DeleteObjectsCommand` accepts at most 1,000 keys; verify chunking and per-object error handling where required by existing behavior.
- Private certificate storage and public URL signing use distinct concerns; verify certificates never trigger public bucket policy and public signing uses the public endpoint client.

---

## File Map

- `src/modules/file/file.module.ts`: construct/export the two S3 clients and initialize the public bucket/policy.
- `src/common/constants/file.constant.ts`: remove the obsolete MinIO SDK injection token.
- `src/app.service.ts`, `src/app.service.spec.ts`: check configured bucket health through the internal S3 client.
- `src/modules/users/users.service.ts`, `src/modules/courses/courses.service.ts`, `src/modules/courses/cleanup/course-asset-cleanup.service.ts`, `src/modules/lessons/lessons.service.ts`, `src/modules/ai-summary/lesson-audio.service.ts`, `src/modules/certificates/certificate-storage.service.ts`, `src/modules/lessons/import/lesson-import.service.ts`, `src/modules/lessons/import/lesson-import-processor.service.ts`, and related specs: replace SDK operations and their test doubles with S3 commands.
- `src/modules/learning/learning.module.spec.ts`: remove the obsolete provider from module test setup.
- `package.json` and `pnpm-lock.yaml`: remove `minio` if source/package-wide search confirms no remaining runtime use.
- `docs/superpowers/specs/2026-08-21-t0-07-profile-password-design.md`: update the active storage interface statement referring to `MINIO_CLIENT`.

## Task 1: Migrate bucket initialization and health check

**Files:**
- Modify: `src/modules/file/file.module.ts`
- Modify: `src/common/constants/file.constant.ts`
- Modify: `src/app.service.ts`
- Test: `src/modules/file/file.module.spec.ts` (create if absent)
- Test: `src/app.service.spec.ts`
- Test: `src/modules/learning/learning.module.spec.ts`

**Interfaces:**
- `MINIO_S3_CLIENT` and `MINIO_PUBLIC_S3_CLIENT` remain string provider tokens exported by `file.constant.ts`.
- `AppService` receives an AWS `S3Client` under `MINIO_S3_CLIENT`; its health check sends `HeadBucketCommand({ Bucket: MINIO_BUCKET })`.

- [x] **Step 1: Add failing FileModule tests**

Test the `onModuleInit()` path with a mocked internal `S3Client.send`: existing bucket (`HeadBucketCommand` succeeds), missing bucket (`HeadBucketCommand` rejects with `NotFound`/`NoSuchBucket`, then `CreateBucketCommand`), policy is set in both cases, and a non-missing bucket error propagates. Assert the create bucket region/configuration and exact public-read policy resource.

- [x] **Step 2: Run the focused tests and confirm the missing behavior fails**

Run: `pnpm test --runInBand -- file.module.spec.ts app.service.spec.ts learning.module.spec.ts`
Expected: FileModule tests fail because bucket operations still use the MinIO SDK provider.

- [x] **Step 3: Replace the MinIO SDK provider and startup operations**

In `file.module.ts`, remove `minio` import/provider, inject `MINIO_S3_CLIENT`, and use `HeadBucketCommand`, `CreateBucketCommand`, and `PutBucketPolicyCommand` from `@aws-sdk/client-s3`. Treat only the recognized missing-bucket responses as a create condition; rethrow other errors. Continue applying the policy after either bucket path. Remove `MINIO_CLIENT` from constants/exports and remove obsolete test providers.

- [x] **Step 4: Update the health check tests and implementation**

Change `AppService` to inject `MINIO_S3_CLIENT` as `S3Client`; implement `checkMinio()` using `send(new HeadBucketCommand({ Bucket: configuredBucket }))`. Update app service tests to mock `.send()` and assert `HeadBucketCommand` behavior while preserving timeout and `minio` component assertions.

- [x] **Step 5: Run focused tests**

Run: `pnpm test --runInBand -- file.module.spec.ts app.service.spec.ts learning.module.spec.ts`
Expected: PASS; tests prove setup on an existing bucket, creation on a missing bucket, error propagation, and health status behavior.

## Task 2: Migrate standard object storage consumers

**Files:**
- Modify: `src/modules/users/users.service.ts` and `.spec.ts`
- Modify: `src/modules/courses/courses.service.ts` and `.spec.ts`
- Modify: `src/modules/courses/cleanup/course-asset-cleanup.service.ts` and `.spec.ts`
- Modify: `src/modules/lessons/lessons.service.ts` and `.spec.ts`
- Modify: `src/modules/ai-summary/lesson-audio.service.ts` and `.spec.ts`
- Modify: `src/modules/certificates/certificate-storage.service.ts` and `.spec.ts`

**Interfaces:**
- All server-side object operations use injected `MINIO_S3_CLIENT: S3Client` and AWS SDK commands.
- For downloads, `GetObjectCommand` response `Body` is handled as a Node readable stream using existing service return types and cleanup behavior.

- [x] **Step 1: Update storage service tests to S3 command mocks**

For each listed service, replace MinIO method mocks with a mock `S3Client.send()` that branches on command class. Preserve assertions for bucket/key/content type/body, deletion, not-found behavior, upload failures, and generated URLs. Add assertions for `GetObjectCommand`, `PutObjectCommand`, `DeleteObjectCommand`, `HeadObjectCommand`, `ListObjectsV2Command`, or `DeleteObjectsCommand` as applicable to that service.

- [x] **Step 2: Run affected focused tests and confirm failures**

Run: `pnpm test --runInBand -- users.service.spec.ts courses.service.spec.ts course-asset-cleanup.service.spec.ts lessons.service.spec.ts lesson-audio.service.spec.ts certificate-storage.service.spec.ts`
Expected: FAIL because services still inject `MINIO_CLIENT` and use MinIO SDK methods.

- [x] **Step 3: Migrate user, course, and lesson operations**

Replace upload/delete/stat/list operations with the matching S3 commands. Preserve object-key construction, MIME metadata, cleanup ordering, and URL formatting. Keep public URL signing endpoint selection unchanged; use `MINIO_PUBLIC_S3_CLIENT` for presigning when the service currently signs URLs.

- [x] **Step 4: Migrate audio and certificate storage**

Use S3 commands for lesson audio upload/download/delete and certificate private-bucket operations. Preserve the certificate bucket selection and ensure no certificate code applies or depends on the public-read policy. For streams, preserve current consumer and error handling semantics.

- [x] **Step 5: Migrate batch cleanup**

Use `DeleteObjectsCommand` with chunks of at most 1,000 unique object keys. Preserve empty-input no-op behavior and existing failure propagation/logging. Keep the existing batch size constant if still applicable, renaming it to S3 terminology only if that improves clarity without changing behavior.

- [x] **Step 6: Run affected focused tests**

Run the Task 2 focused test command again.
Expected: PASS with preserved behavior and S3 command assertions.

## Task 3: Migrate lesson-import object operations and stream processing

**Files:**
- Modify: `src/modules/lessons/import/lesson-import.service.ts` and `.spec.ts`
- Modify: `src/modules/lessons/import/lesson-import-processor.service.ts` and `.spec.ts`
- Modify: `src/modules/lessons/import/lesson-import-cleanup.service.ts` (no colocated spec currently exists)

**Interfaces:**
- Multipart upload and abort cleanup continue using `MINIO_S3_CLIENT`.
- Object reads/writes/listing in the import processor use `MINIO_S3_CLIENT`; browser upload presigning continues using `MINIO_PUBLIC_S3_CLIENT`.

- [x] **Step 1: Update import processor/cleanup tests to mock S3 commands**

Cover source-object metadata (`HeadObjectCommand`), reads (`GetObjectCommand`), writes (`PutObjectCommand`), prefix listing (`ListObjectsV2Command` pagination), and deletes (`DeleteObjectCommand`/`DeleteObjectsCommand`) according to current behavior. Retain multipart create/upload/complete/abort assertions and verify presigning uses the public client.

- [x] **Step 2: Run focused lesson-import tests and confirm failures**

Run: `pnpm test --runInBand -- lesson-import.service.spec.ts lesson-import-processor.service.spec.ts`
Expected: tests fail at obsolete MinIO token/method expectations.

- [x] **Step 3: Convert processor operations to S3 commands**

Replace `statObject`, `getObject`, `putObject`, `listObjectsV2`, and object removal with AWS SDK commands. For list results, follow continuation tokens until exhausted. Adapt S3 `Body` to existing stream consumers and preserve temp-file/stream cleanup behavior.

- [x] **Step 4: Remove redundant MinIO dependency from lesson import service**

Use S3 commands for any remaining metadata/removal operations in `lesson-import.service.ts`; retain existing multipart commands and keep `MINIO_PUBLIC_S3_CLIENT` for browser-facing presigned URLs.

- [x] **Step 5: Run focused lesson-import tests**

Run the Task 3 focused test command again.
Expected: PASS, including stream, pagination, multipart, cleanup, and public presigning assertions.

## Task 4: Remove MinIO SDK dependency and stale active references

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/superpowers/specs/2026-08-21-t0-07-profile-password-design.md`
- Modify: any remaining source/test files identified by repository search

- [x] **Step 1: Search for remaining production/test references**

Run: `rg -n 'MINIO_CLIENT|Minio\.Client|MinioClient|from .minio.|from .minio|require\(.minio' src package.json`
Expected: only references to remove or historical/non-code docs remain; no application source or active tests rely on the SDK.

- [x] **Step 2: Remove the direct dependency and update the lockfile**

Remove `minio` from `package.json` and run `pnpm install --lockfile-only` from the backend directory to update `pnpm-lock.yaml`.

- [x] **Step 3: Update active documentation and test wiring**

Change the profile/password spec's storage interface description to the retained S3 token. Remove any leftover `MINIO_CLIENT` mocks/imports in module and unit tests. Leave historical completed plans untouched.

- [x] **Step 4: Confirm no SDK/token references remain**

Run: `rg -n 'MINIO_CLIENT|Minio\.Client|MinioClient|from .minio.|"minio"' src package.json pnpm-lock.yaml`
Expected: no MinIO SDK client/token/dependency matches. The literal health component label and environment names such as `MINIO_BUCKET` remain valid.

## Task 5: Backend verification

**Files:**
- No planned source changes; resolve any defects in the owning task files.

- [x] **Step 1: Run all focused storage-related unit tests**

Run the Task 1, Task 2, and Task 3 focused test commands.
Expected: all PASS.

- [x] **Step 2: Build the backend**

Run: `pnpm build`
Expected: Nest build completes successfully with no unresolved provider tokens or TypeScript errors.

- [x] **Step 3: Review final diff and search results**

Run: `git diff --check` and the Task 4 repository search.
Expected: no whitespace errors and no MinIO SDK client/token/dependency references remain in source or package files.
