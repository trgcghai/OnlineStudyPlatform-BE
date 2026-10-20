# S3-Compatible Storage Client Refactor Design

**Status:** Approved design
**Date:** 2026-10-20

## Goal

Remove the MinIO SDK client from the backend and use the two existing AWS SDK S3 clients for all object storage operations. Preserve the current file storage behavior, public asset access, startup bucket initialization, and health reporting.

## Current state

`FileModule` provides `MINIO_CLIENT`, `MINIO_S3_CLIENT`, and `MINIO_PUBLIC_S3_CLIENT`. The MinIO SDK client remains injected throughout application and feature services for bucket setup, health checks, object CRUD/list/stat operations, and batch deletion. The S3 clients are already used by lesson import multipart upload and presigned URL flows.

## Design

### Client responsibilities

- `MINIO_S3_CLIENT` is the internal S3 client. Use it for bucket operations and server-side object reads, writes, deletes, listing, metadata checks, and multipart cleanup.
- `MINIO_PUBLIC_S3_CLIENT` is the browser-facing S3 client used when creating presigned URLs that must resolve through `MINIO_PUBLIC_ENDPOINT`.
- Remove `MINIO_CLIENT`, its MinIO SDK provider, all injections/imports, and the `minio` package dependency if no remaining backend code uses it.

Both clients retain the existing credentials, `us-east-1` region, and path-style configuration. `MINIO_ENDPOINT`, `MINIO_PUBLIC_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, and `MINIO_BUCKET` remain the configuration contract.

### FileModule startup

Keep automatic public asset bucket setup in `FileModule.onModuleInit()` using `MINIO_S3_CLIENT`:

1. Check the configured bucket using `HeadBucketCommand`.
2. If it does not exist, create it with `CreateBucketCommand` in `us-east-1`.
3. Apply the existing anonymous `s3:GetObject` bucket policy with `PutBucketPolicyCommand`.

Preserve current startup logs and fail startup if bucket initialization or policy application fails. Do not change certificate storage: certificates continue using their separate private bucket behavior and must not receive the public-read policy.

### Health check

Replace the MinIO SDK injection in `AppService` with `MINIO_S3_CLIENT`. The storage health check sends `HeadBucketCommand` for `MINIO_BUCKET`, under the existing timeout and component reporting behavior. Keep the health component name `minio` to avoid changing the health response contract.

### Service migration

Migrate all existing MinIO SDK operations to equivalent AWS SDK S3 commands without changing service-level behavior:

- object uploads, downloads, and removals;
- object metadata/stat checks and prefix listing;
- batch deletion, respecting S3's 1,000-object limit;
- lesson import reads/writes and cleanup;
- certificate private-bucket operations.

Use `MINIO_S3_CLIENT` for these server-side operations. For stream handling, preserve existing error and resource cleanup behavior while using `GetObjectCommand` response bodies. Keep public URL generation and browser presigning behavior intact, using `MINIO_PUBLIC_S3_CLIENT` where endpoint selection is relevant.

### Constants, dependencies, and tests

Remove the `MINIO_CLIENT` token from `file.constant.ts` and all imports/references. Remove direct MinIO SDK imports and the `minio` dependency if repository-wide search confirms it is no longer used. Update all affected unit/module tests to mock S3 clients and command responses. Keep existing behavioral assertions for storage and failure cases; add or update coverage for bucket initialization and health checks using S3 commands.

Update backend documentation that describes `MINIO_CLIENT` as the storage interface. Historical implementation plans/specs need not be rewritten unless they are active guidance for the affected feature.

## Error handling and compatibility

Preserve existing public API responses, object key formats, bucket names, URL formats, and current service-level error behavior. AWS SDK command failures should flow through the same existing service or startup error paths. No data migration is required because bucket contents and object keys do not change.

## Verification

- Search the backend source and package manifests for remaining MinIO SDK client imports, `MINIO_CLIENT` token references, and direct `minio` package use.
- Run focused storage-related unit tests and the backend build.
- Verify test coverage for `FileModule` initialization and `AppService` storage health behavior.

## Scope boundaries

- No changes to storage providers, bucket naming, public access policy semantics, certificate privacy, or environment variable names.
- No changes to frontend or AI services.
- No refactor of storage abstractions beyond replacing the MinIO SDK client with the existing S3 client providers.
