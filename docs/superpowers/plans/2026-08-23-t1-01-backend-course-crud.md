# T1-01 Backend Course CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build backend Course CRUD for Instructor-owned courses, including ownership checks, thumbnail upload, pagination/filtering, and safe delete behavior.

**Architecture:** Add a dedicated NestJS `courses` feature module under `src/modules/courses`. Controllers stay thin, service owns persistence and resource-level authorization, TypeORM owns Course persistence, and MinIO thumbnail upload follows the existing avatar pattern.

**Tech Stack:** NestJS 11, TypeScript, TypeORM, PostgreSQL, MinIO, Jest, class-validator, class-transformer, pnpm.

**Source Spec:** `docs/superpowers/specs/2026-08-23-t1-01-backend-course-crud-design.md`

**Commit Policy:** Do not commit during execution unless the user explicitly asks. Use verification checkpoints instead.

---

## File Structure

Create these files:

| File | Responsibility |
|---|---|
| `src/modules/courses/entities/course.entity.ts` | Course entity and `CourseStatus` enum |
| `src/modules/courses/dto/course.dto.ts` | Create/update/list DTOs, response interfaces, constants |
| `src/modules/courses/courses.module.ts` | Registers TypeORM repository, controller, service |
| `src/modules/courses/courses.service.ts` | Course persistence, ownership checks, list filters, delete rule, thumbnail upload |
| `src/modules/courses/courses.controller.ts` | Instructor course HTTP endpoints |
| `src/modules/courses/filters/thumbnail-upload-exception.filter.ts` | Multer thumbnail upload error normalization |
| `src/modules/courses/courses.service.spec.ts` | Service unit tests |
| `src/modules/courses/courses.controller.spec.ts` | Controller delegation and RBAC tests |

Modify these files:

| File | Change |
|---|---|
| `src/app.module.ts` | Import and register `CoursesModule` |
| `src/common/constants/file.constant.ts` | Add thumbnail upload constants |

---

## Related Skills By Task

| Task | Required Related Skills |
|---|---|
| Task 1 | `test-driven-development`, `nestjs-patterns` |
| Task 2 | `test-driven-development`, `nestjs-patterns` |
| Task 3 | `test-driven-development`, `nestjs-patterns` |
| Task 4 | `test-driven-development`, `nestjs-patterns` |
| Task 5 | `test-driven-development`, `nestjs-patterns` |
| Task 6 | `test-driven-development`, `nestjs-patterns` |
| Task 7 | `test-driven-development`, `nestjs-patterns`, `verification-before-completion` |

If skill loading fails during execution, read the corresponding skill file directly before continuing.

---

### Task 1: Course Entity, DTOs, Module Skeleton

**Related Skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/courses/entities/course.entity.ts`
- Create: `src/modules/courses/dto/course.dto.ts`
- Create: `src/modules/courses/courses.module.ts`
- Create: `src/modules/courses/courses.service.ts`
- Create: `src/modules/courses/courses.service.spec.ts`

- [ ] **Step 1: Write the failing test for default Draft ownership creation**

Create `src/modules/courses/courses.service.spec.ts` with this initial test:

```ts
import { Repository } from 'typeorm';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/course.dto';
import { Course, CourseStatus } from './entities/course.entity';

describe('CoursesService', () => {
  let service: CoursesService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let configService: { getOrThrow: jest.Mock };
  let minioClient: { putObject: jest.Mock; removeObject: jest.Mock };

  const instructorId = '11111111-1111-4111-8111-111111111111';
  const otherInstructorId = '22222222-2222-4222-8222-222222222222';
  const courseId = '33333333-3333-4333-8333-333333333333';

  const makeCourse = (overrides: Partial<Course> = {}): Course => ({
    id: courseId,
    title: 'Lap trinh NestJS',
    description: 'Khoa hoc nhap mon NestJS',
    category: 'Backend',
    thumbnail: null,
    status: CourseStatus.DRAFT,
    instructorId,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    repo = {
      create: jest.fn((input: Partial<Course>) => input),
      save: jest.fn((input: Partial<Course>) => ({ ...makeCourse(), ...input })),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'MINIO_BUCKET') return 'lms-bucket';
        if (key === 'MINIO_ENDPOINT') return 'http://localhost:9000';
        return undefined;
      }),
    };
    minioClient = {
      putObject: jest.fn().mockResolvedValue({ etag: 'etag' }),
      removeObject: jest.fn().mockResolvedValue(undefined),
    };
    service = new CoursesService(
      repo as unknown as Repository<Course>,
      configService as never,
      minioClient as never,
    );
  });

  describe('create', () => {
    it('creates a Draft course owned by the current Instructor', async () => {
      const dto: CreateCourseDto = {
        title: '  Lap trinh NestJS  ',
        description: '  Khoa hoc nhap mon NestJS  ',
        category: '  Backend  ',
      };

      const result = await service.create(instructorId, dto);

      expect(repo.create).toHaveBeenCalledWith({
        title: 'Lap trinh NestJS',
        description: 'Khoa hoc nhap mon NestJS',
        category: 'Backend',
        status: CourseStatus.DRAFT,
        instructorId,
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        title: 'Lap trinh NestJS',
        status: CourseStatus.DRAFT,
        instructorId,
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run from `online-study-platform-be`:

```bash
pnpm test courses.service
```

Expected: FAIL because `./courses.service`, DTO, and entity files do not exist.

- [ ] **Step 3: Implement minimal entity, DTO, module, and service creation path**

Create `src/modules/courses/entities/course.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum CourseStatus {
  DRAFT = 'Draft',
  PENDING = 'Pending',
  PUBLISHED = 'Published',
}

@Entity('courses')
export class Course {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 150 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ length: 80 })
  category!: string;

  @Column({ type: 'varchar', nullable: true })
  thumbnail!: string | null;

  @Column({ type: 'enum', enum: CourseStatus, default: CourseStatus.DRAFT })
  status!: CourseStatus;

  @Column({ name: 'instructor_id', type: 'uuid' })
  instructorId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  instructor!: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

Create `src/modules/courses/dto/course.dto.ts`:

```ts
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { CourseStatus } from '../entities/course.entity';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const COURSE_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'title',
  'category',
  'status',
] as const;

export type CourseSortField = (typeof COURSE_SORT_FIELDS)[number];
export type SortOrder = 'ASC' | 'DESC';

export class CreateCourseDto {
  @Transform(trimString)
  @IsString()
  @Length(2, 150)
  title!: string;

  @Transform(trimString)
  @IsString()
  @Length(1, 5000)
  description!: string;

  @Transform(trimString)
  @IsString()
  @Length(1, 80)
  category!: string;
}

export class UpdateCourseDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(2, 150)
  title?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 5000)
  description?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 80)
  category?: string;
}

export class ListCoursesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  q?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 80)
  category?: string;

  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;

  @IsOptional()
  @IsIn(COURSE_SORT_FIELDS)
  sortBy: CourseSortField = 'createdAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: SortOrder = 'DESC';
}

export interface CourseResponse {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string | null;
  status: CourseStatus;
  instructorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseListResult {
  items: CourseResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

Create `src/modules/courses/courses.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Client as MinioClient } from 'minio';
import { Repository } from 'typeorm';
import { MINIO_CLIENT } from '../../common/constants/file.constant';
import {
  CourseResponse,
  CreateCourseDto,
  ListCoursesQueryDto,
  CourseListResult,
  UpdateCourseDto,
} from './dto/course.dto';
import { Course, CourseStatus } from './entities/course.entity';

@Injectable()
export class CoursesService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    private readonly configService: ConfigService,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
  ) {}

  async create(
    instructorId: string,
    dto: CreateCourseDto,
  ): Promise<CourseResponse> {
    const course = this.coursesRepository.create({
      title: dto.title.trim(),
      description: dto.description.trim(),
      category: dto.category.trim(),
      status: CourseStatus.DRAFT,
      instructorId,
    });

    const savedCourse = await this.coursesRepository.save(course);
    return this.toCourseResponse(savedCourse);
  }

  async findMine(
    instructorId: string,
    query: ListCoursesQueryDto,
  ): Promise<CourseListResult> {
    return {
      items: [],
      total: 0,
      page: query.page ?? 1,
      limit: query.limit ?? 10,
      totalPages: 1,
    };
  }

  private toCourseResponse(course: Course): CourseResponse {
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      thumbnail: course.thumbnail,
      status: course.status,
      instructorId: course.instructorId,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  }
}
```

Create `src/modules/courses/courses.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from './entities/course.entity';
import { CoursesService } from './courses.service';

@Module({
  imports: [TypeOrmModule.forFeature([Course])],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
pnpm test courses.service
```

Expected: PASS for the create test.

---

### Task 2: List Endpoint Service Pagination And Filtering

**Related Skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Modify: `src/modules/courses/courses.service.spec.ts`
- Modify: `src/modules/courses/courses.service.ts`

- [ ] **Step 1: Add failing list tests**

Append this `describe` block inside `CoursesService` tests:

```ts
describe('findMine', () => {
  const buildQueryBuilder = (options?: { count?: number; courses?: Course[] }) => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(options?.count ?? 0),
      getMany: jest.fn().mockResolvedValue(options?.courses ?? []),
    };
    repo.createQueryBuilder.mockReturnValue(qb);
    return qb;
  };

  it('scopes courses to the current Instructor and paginates', async () => {
    const qb = buildQueryBuilder({ count: 1, courses: [makeCourse()] });

    const result = await service.findMine(instructorId, {
      page: 2,
      limit: 5,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });

    expect(qb.where).toHaveBeenCalledWith('course.instructorId = :instructorId', {
      instructorId,
    });
    expect(qb.skip).toHaveBeenCalledWith(5);
    expect(qb.take).toHaveBeenCalledWith(5);
    expect(result).toEqual({
      items: [expect.objectContaining({ id: courseId })],
      total: 1,
      page: 2,
      limit: 5,
      totalPages: 1,
    });
  });

  it('applies q, category, status, and sorting filters', async () => {
    const qb = buildQueryBuilder();

    await service.findMine(instructorId, {
      page: 1,
      limit: 10,
      q: 'nestjs',
      category: 'Backend',
      status: CourseStatus.DRAFT,
      sortBy: 'title',
      sortOrder: 'ASC',
    });

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(course.title ILIKE :search OR course.description ILIKE :search)',
      { search: '%nestjs%' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('course.category = :category', {
      category: 'Backend',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('course.status = :status', {
      status: CourseStatus.DRAFT,
    });
    expect(qb.orderBy).toHaveBeenCalledWith('course.title', 'ASC');
  });

  it('returns totalPages as 1 when no courses exist', async () => {
    buildQueryBuilder({ count: 0, courses: [] });

    const result = await service.findMine(instructorId, {
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });

    expect(result.totalPages).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm test courses.service
```

Expected: FAIL because `findMine` returns an empty stub and does not use the query builder.

- [ ] **Step 3: Implement `findMine` query builder**

Replace `findMine` in `src/modules/courses/courses.service.ts`:

```ts
async findMine(
  instructorId: string,
  query: ListCoursesQueryDto,
): Promise<CourseListResult> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const sortBy = query.sortBy ?? 'createdAt';
  const sortOrder = query.sortOrder ?? 'DESC';

  const qb = this.coursesRepository
    .createQueryBuilder('course')
    .where('course.instructorId = :instructorId', { instructorId });

  if (query.q) {
    qb.andWhere(
      '(course.title ILIKE :search OR course.description ILIKE :search)',
      { search: `%${query.q}%` },
    );
  }

  if (query.category) {
    qb.andWhere('course.category = :category', { category: query.category });
  }

  if (query.status) {
    qb.andWhere('course.status = :status', { status: query.status });
  }

  qb.orderBy(`course.${sortBy}`, sortOrder);

  const total = await qb.getCount();
  const courses = await qb
    .skip((page - 1) * limit)
    .take(limit)
    .getMany();

  return {
    items: courses.map((course) => this.toCourseResponse(course)),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
pnpm test courses.service
```

Expected: PASS.

---

### Task 3: Owned Detail And Metadata Update

**Related Skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Modify: `src/modules/courses/courses.service.spec.ts`
- Modify: `src/modules/courses/courses.service.ts`

- [ ] **Step 1: Add failing ownership and update tests**

Add imports in `courses.service.spec.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
```

Append this test block:

```ts
describe('getOwned and update', () => {
  it('returns an owned course detail', async () => {
    repo.findOne.mockResolvedValue(makeCourse());

    const result = await service.getOwned(courseId, instructorId);

    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: courseId } });
    expect(result).toMatchObject({ id: courseId, instructorId });
  });

  it('throws NotFoundException when the course does not exist', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.getOwned(courseId, instructorId)).rejects.toEqual(
      new NotFoundException('Course not found'),
    );
  });

  it('throws ForbiddenException when another Instructor owns the course', async () => {
    repo.findOne.mockResolvedValue(makeCourse({ instructorId: otherInstructorId }));

    await expect(service.getOwned(courseId, instructorId)).rejects.toEqual(
      new ForbiddenException('You do not own this course'),
    );
  });

  it('updates owned course metadata and trims fields', async () => {
    repo.findOne.mockResolvedValue(makeCourse());
    repo.save.mockImplementation((input: Course) => input);

    const result = await service.update(courseId, instructorId, {
      title: '  NestJS Nang cao  ',
      description: '  Noi dung moi  ',
      category: '  Backend  ',
    });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'NestJS Nang cao',
        description: 'Noi dung moi',
        category: 'Backend',
      }),
    );
    expect(result.title).toBe('NestJS Nang cao');
  });

  it('rejects an empty update payload', async () => {
    await expect(service.update(courseId, instructorId, {})).rejects.toEqual(
      new BadRequestException('No changes provided'),
    );
    expect(repo.findOne).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm test courses.service
```

Expected: FAIL because `getOwned` and `update` do not exist on `CoursesService`.

- [ ] **Step 3: Implement ownership helper, detail, and update**

Update imports in `courses.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
```

Add `getOwned` and `update`, then add `getOwnedCourseEntity` before `toCourseResponse`:

```ts
async getOwned(id: string, instructorId: string): Promise<CourseResponse> {
  const course = await this.getOwnedCourseEntity(id, instructorId);
  return this.toCourseResponse(course);
}

async update(
  id: string,
  instructorId: string,
  dto: UpdateCourseDto,
): Promise<CourseResponse> {
  const hasChanges = Boolean(
    dto.title !== undefined ||
      dto.description !== undefined ||
      dto.category !== undefined,
  );

  if (!hasChanges) {
    throw new BadRequestException('No changes provided');
  }

  const course = await this.getOwnedCourseEntity(id, instructorId);

  if (dto.title !== undefined) {
    course.title = dto.title.trim();
  }

  if (dto.description !== undefined) {
    course.description = dto.description.trim();
  }

  if (dto.category !== undefined) {
    course.category = dto.category.trim();
  }

  const savedCourse = await this.coursesRepository.save(course);
  return this.toCourseResponse(savedCourse);
}

private async getOwnedCourseEntity(
  id: string,
  instructorId: string,
): Promise<Course> {
  const course = await this.coursesRepository.findOne({ where: { id } });

  if (!course) {
    throw new NotFoundException('Course not found');
  }

  if (course.instructorId !== instructorId) {
    throw new ForbiddenException('You do not own this course');
  }

  return course;
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
pnpm test courses.service
```

Expected: PASS.

---

### Task 4: Delete Owned Course With Delete Rule Seam

**Related Skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Modify: `src/modules/courses/courses.service.spec.ts`
- Modify: `src/modules/courses/courses.service.ts`

- [ ] **Step 1: Add failing delete tests**

Append this block:

```ts
describe('remove', () => {
  it('deletes an owned course after delete rule passes', async () => {
    repo.findOne.mockResolvedValue(makeCourse());

    await service.remove(courseId, instructorId);

    expect(repo.delete).toHaveBeenCalledWith(courseId);
  });

  it('returns 403 and does not delete when another Instructor owns the course', async () => {
    repo.findOne.mockResolvedValue(makeCourse({ instructorId: otherInstructorId }));

    await expect(service.remove(courseId, instructorId)).rejects.toEqual(
      new ForbiddenException('You do not own this course'),
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm test courses.service
```

Expected: FAIL because `remove` does not exist on `CoursesService`.

- [ ] **Step 3: Implement delete and delete-rule seam**

Add `remove` in `courses.service.ts` and add `assertCourseCanBeDeleted` before `toCourseResponse`:

```ts
async remove(id: string, instructorId: string): Promise<void> {
  await this.getOwnedCourseEntity(id, instructorId);
  await this.assertCourseCanBeDeleted(id);
  await this.coursesRepository.delete(id);
}

private async assertCourseCanBeDeleted(_courseId: string): Promise<void> {
  return;
}
```

When `T1-09` adds enrollments, replace the seam body with an enrollment count query and throw `ConflictException('Course has enrollments')` when count is greater than zero.

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
pnpm test courses.service
```

Expected: PASS.

---

### Task 5: Thumbnail Upload Constants, Filter, And Service

**Related Skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Modify: `src/common/constants/file.constant.ts`
- Create: `src/modules/courses/filters/thumbnail-upload-exception.filter.ts`
- Modify: `src/modules/courses/courses.service.spec.ts`
- Modify: `src/modules/courses/courses.service.ts`

- [ ] **Step 1: Add failing thumbnail service tests**

Update imports in `courses.service.spec.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
```

Append this block:

```ts
describe('uploadThumbnail', () => {
  const pngFile: Express.Multer.File = {
    fieldname: 'thumbnail',
    originalname: 'cover.PNG',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 4,
    buffer: Buffer.from('png!'),
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
  };

  it('uploads an owned course thumbnail and stores the public URL', async () => {
    repo.findOne.mockResolvedValue(makeCourse());
    repo.save.mockImplementation((input: Course) => input);

    const result = await service.uploadThumbnail(courseId, instructorId, pngFile);

    expect(minioClient.putObject).toHaveBeenCalledWith(
      'lms-bucket',
      expect.stringMatching(/^courses\/33333333-.+\/thumbnails\/.+\.png$/),
      pngFile.buffer,
      pngFile.size,
      { contentType: 'image/png' },
    );
    expect(result.thumbnail).toMatch(
      /^http:\/\/localhost:9000\/lms-bucket\/courses\//,
    );
  });

  it('returns 403 before uploading when another Instructor owns the course', async () => {
    repo.findOne.mockResolvedValue(makeCourse({ instructorId: otherInstructorId }));

    await expect(
      service.uploadThumbnail(courseId, instructorId, pngFile),
    ).rejects.toEqual(new ForbiddenException('You do not own this course'));
    expect(minioClient.putObject).not.toHaveBeenCalled();
  });

  it('removes previous thumbnail object best-effort after replacement', async () => {
    repo.findOne.mockResolvedValue(
      makeCourse({
        thumbnail:
          'http://localhost:9000/lms-bucket/courses/33333333-3333-4333-8333-333333333333/thumbnails/old.png',
      }),
    );
    repo.save.mockImplementation((input: Course) => input);

    await service.uploadThumbnail(courseId, instructorId, pngFile);

    expect(minioClient.removeObject).toHaveBeenCalledWith(
      'lms-bucket',
      'courses/33333333-3333-4333-8333-333333333333/thumbnails/old.png',
    );
  });

  it('wraps MinIO upload failures and keeps metadata unchanged', async () => {
    repo.findOne.mockResolvedValue(makeCourse());
    minioClient.putObject.mockRejectedValue(new Error('minio down'));

    await expect(
      service.uploadThumbnail(courseId, instructorId, pngFile),
    ).rejects.toEqual(
      new InternalServerErrorException('Could not upload course thumbnail'),
    );
    expect(repo.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm test courses.service
```

Expected: FAIL because `uploadThumbnail` does not exist on `CoursesService`.

- [ ] **Step 3: Add thumbnail constants**

Modify `src/common/constants/file.constant.ts` to include:

```ts
export const COURSE_THUMBNAIL_FIELD_NAME = 'thumbnail';
export const COURSE_THUMBNAIL_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const COURSE_THUMBNAIL_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];
```

- [ ] **Step 4: Add upload exception filter**

Create `src/modules/courses/filters/thumbnail-upload-exception.filter.ts`:

```ts
import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

@Catch(MulterError)
export class ThumbnailUploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = 400;
    const message =
      exception.code === 'LIMIT_FILE_SIZE'
        ? 'Course thumbnail must be at most 5 MB'
        : 'Invalid course thumbnail upload';

    response.status(status).json({
      success: false,
      statusCode: status,
      data: null,
      error: new BadRequestException(message).getResponse(),
      timestamp: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 5: Implement thumbnail service helpers**

Update imports in `courses.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
```

Add `uploadThumbnail`, then add helper methods before `toCourseResponse`:

```ts
async uploadThumbnail(
  id: string,
  instructorId: string,
  file: Express.Multer.File,
): Promise<CourseResponse> {
  if (!file) {
    throw new BadRequestException('Course thumbnail is required');
  }

  const course = await this.getOwnedCourseEntity(id, instructorId);
  const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');
  const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');
  const objectKey = this.buildThumbnailObjectKey(course.id, file);

  try {
    await this.minioClient.putObject(
      bucket,
      objectKey,
      file.buffer,
      file.size,
      { contentType: file.mimetype },
    );
  } catch {
    throw new InternalServerErrorException('Could not upload course thumbnail');
  }

  const previousThumbnail = course.thumbnail;
  course.thumbnail = this.buildPublicObjectUrl(endpoint, bucket, objectKey);
  const savedCourse = await this.coursesRepository.save(course);

  if (previousThumbnail) {
    await this.deleteThumbnailObjectQuietly(endpoint, bucket, previousThumbnail);
  }

  return this.toCourseResponse(savedCourse);
}

private buildThumbnailObjectKey(
  courseId: string,
  file: Express.Multer.File,
): string {
  const extension = this.extractImageExtension(file.originalname, file.mimetype);
  return `courses/${courseId}/thumbnails/${randomUUID()}${extension}`;
}

private extractImageExtension(originalName: string, mimetype: string): string {
  const extensionFromName = originalName.includes('.')
    ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase()
    : '';

  if (/^\.[a-z0-9]{1,5}$/.test(extensionFromName)) {
    return extensionFromName;
  }

  const mimeExtensions: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };

  return mimeExtensions[mimetype] ?? '';
}

private buildPublicObjectUrl(
  endpoint: string,
  bucket: string,
  objectKey: string,
): string {
  return `${endpoint.replace(/\/+$/, '')}/${bucket}/${objectKey}`;
}

private getObjectKeyFromPublicUrl(
  endpoint: string,
  bucket: string,
  publicUrl: string,
): string | null {
  const prefix = this.buildPublicObjectUrl(endpoint, bucket, '');
  return publicUrl.startsWith(prefix) ? publicUrl.slice(prefix.length) : null;
}

private async deleteThumbnailObjectQuietly(
  endpoint: string,
  bucket: string,
  publicUrl: string,
): Promise<void> {
  const objectKey = this.getObjectKeyFromPublicUrl(endpoint, bucket, publicUrl);
  if (!objectKey) {
    return;
  }

  try {
    await this.minioClient.removeObject(bucket, objectKey);
  } catch {
    // Best-effort cleanup; stale thumbnail objects must not fail the request.
  }
}
```

- [ ] **Step 6: Run test to verify GREEN**

Run:

```bash
pnpm test courses.service
```

Expected: PASS.

---

### Task 6: Course Controller, RBAC, Upload Route, AppModule Wiring

**Related Skills:** `test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/courses/courses.controller.ts`
- Create: `src/modules/courses/courses.controller.spec.ts`
- Modify: `src/modules/courses/courses.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write failing controller delegation and RBAC tests**

Create `src/modules/courses/courses.controller.spec.ts`:

```ts
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { CourseStatus } from './entities/course.entity';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

describe('CoursesController', () => {
  let controller: CoursesController;
  let service: {
    create: jest.Mock;
    findMine: jest.Mock;
    getOwned: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    uploadThumbnail: jest.Mock;
  };

  const instructorId = '11111111-1111-4111-8111-111111111111';
  const courseId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findMine: jest.fn(),
      getOwned: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      uploadThumbnail: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoursesController],
      providers: [{ provide: CoursesService, useValue: service }],
    }).compile();

    controller = module.get<CoursesController>(CoursesController);
  });

  it('delegates create with the current Instructor id', async () => {
    const dto = {
      title: 'NestJS',
      description: 'Intro',
      category: 'Backend',
    };

    await controller.create(instructorId, dto);

    expect(service.create).toHaveBeenCalledWith(instructorId, dto);
  });

  it('delegates list with query filters', async () => {
    const query = { page: 1, limit: 10, status: CourseStatus.DRAFT };

    await controller.findMine(instructorId, query);

    expect(service.findMine).toHaveBeenCalledWith(instructorId, query);
  });

  it('delegates get, update, delete, and thumbnail ownership operations', async () => {
    const file = { originalname: 'cover.png' } as Express.Multer.File;

    await controller.getOwned(courseId, instructorId);
    await controller.update(courseId, instructorId, { title: 'New title' });
    await controller.remove(courseId, instructorId);
    await controller.uploadThumbnail(courseId, instructorId, file);

    expect(service.getOwned).toHaveBeenCalledWith(courseId, instructorId);
    expect(service.update).toHaveBeenCalledWith(courseId, instructorId, {
      title: 'New title',
    });
    expect(service.remove).toHaveBeenCalledWith(courseId, instructorId);
    expect(service.uploadThumbnail).toHaveBeenCalledWith(
      courseId,
      instructorId,
      file,
    );
  });
});

describe('CoursesController RBAC', () => {
  type HandlerName =
    | 'create'
    | 'findMine'
    | 'getOwned'
    | 'update'
    | 'remove'
    | 'uploadThumbnail';

  const handlerOf = (methodName: HandlerName): unknown =>
    Object.getOwnPropertyDescriptor(CoursesController.prototype, methodName)
      ?.value;

  const buildContext = (
    handler?: unknown,
    user?: { id: string; role: UserRole },
  ) => ({
    switchToHttp: () => ({
      getRequest: <T>() => ({ user }) as T,
    }),
    getHandler: () => handler,
    getClass: () => CoursesController,
  });

  const reflector = new Reflector();

  const runGuard = (user?: { id: string; role: UserRole }): boolean =>
    new RolesGuard(reflector).canActivate(
      buildContext(handlerOf('findMine'), user) as never,
    );

  it('protects the controller with Instructor role metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CoursesController)).toEqual([
      UserRole.INSTRUCTOR,
    ]);
  });

  it('allows an Instructor through', () => {
    expect(runGuard({ id: 'instructor-id', role: UserRole.INSTRUCTOR })).toBe(
      true,
    );
  });

  it('rejects anonymous requests with UnauthorizedException', () => {
    expect(() => runGuard(undefined)).toThrow(UnauthorizedException);
  });

  it.each([UserRole.ADMIN, UserRole.LEARNER])(
    'denies %s with ForbiddenException',
    (role) => {
      expect(() => runGuard({ id: 'user-id', role })).toThrow(
        ForbiddenException,
      );
    },
  );
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm test courses.controller
```

Expected: FAIL because `courses.controller.ts` does not exist.

- [ ] **Step 3: Implement controller**

Create `src/modules/courses/courses.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  COURSE_THUMBNAIL_ALLOWED_MIME_TYPES,
  COURSE_THUMBNAIL_FIELD_NAME,
  COURSE_THUMBNAIL_MAX_SIZE_BYTES,
} from '../../common/constants/file.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import {
  CreateCourseDto,
  ListCoursesQueryDto,
  UpdateCourseDto,
} from './dto/course.dto';
import { ThumbnailUploadExceptionFilter } from './filters/thumbnail-upload-exception.filter';
import { CoursesService } from './courses.service';

@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.INSTRUCTOR)
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  create(
    @CurrentUser('id') instructorId: string,
    @Body() dto: CreateCourseDto,
  ) {
    return this.coursesService.create(instructorId, dto);
  }

  @Get('me')
  findMine(
    @CurrentUser('id') instructorId: string,
    @Query() query: ListCoursesQueryDto,
  ) {
    return this.coursesService.findMine(instructorId, query);
  }

  @Get(':id')
  getOwned(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.coursesService.getOwned(id, instructorId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.coursesService.update(id, instructorId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.coursesService.remove(id, instructorId);
  }

  @Post(':id/thumbnail')
  @HttpCode(HttpStatus.OK)
  @UseFilters(ThumbnailUploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor(COURSE_THUMBNAIL_FIELD_NAME, {
      limits: { fileSize: COURSE_THUMBNAIL_MAX_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!COURSE_THUMBNAIL_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          callback(
            new BadRequestException(
              'Course thumbnail must be a JPEG, PNG, WebP or GIF image',
            ),
            false,
          );
          return;
        }

        callback(null, true);
      },
    }),
  )
  uploadThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Course thumbnail is required');
    }

    return this.coursesService.uploadThumbnail(id, instructorId, file);
  }
}
```

- [ ] **Step 4: Register controller and module**

Modify `src/modules/courses/courses.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from './entities/course.entity';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  imports: [TypeOrmModule.forFeature([Course])],
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
```

Modify `src/app.module.ts` by adding the import:

```ts
import { CoursesModule } from './modules/courses/courses.module';
```

Then add `CoursesModule` to the `imports` array after `AuthModule` or next to other feature modules:

```ts
UsersModule,
AuthModule,
CoursesModule,
```

- [ ] **Step 5: Run controller and service tests**

Run:

```bash
pnpm test courses
```

Expected: PASS for `courses.service.spec.ts` and `courses.controller.spec.ts`.

---

### Task 7: Final Verification And Spec Coverage

**Related Skills:** `test-driven-development`, `nestjs-patterns`, `verification-before-completion`

**Files:**
- Verify: `src/modules/courses/*`
- Verify: `src/app.module.ts`
- Verify: `src/common/constants/file.constant.ts`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test courses
```

Expected: PASS, no unhandled warnings.

- [ ] **Step 2: Run full unit suite**

Run:

```bash
pnpm test
```

Expected: PASS for all unit tests.

- [ ] **Step 3: Run build/typecheck**

Run:

```bash
pnpm build
```

Expected: PASS; Nest build completes without TypeScript errors.

- [ ] **Step 4: Optional lint after tests/build**

Run only after noting that it may modify files:

```bash
pnpm lint
```

Expected: PASS. If it modifies files, re-run `pnpm test courses` and `pnpm build`.

- [ ] **Step 5: Manual spec coverage check**

Confirm these requirements are implemented:

| Spec Requirement | Verification |
|---|---|
| Create course sets `Draft` and `instructorId` | `creates a Draft course owned by the current Instructor` test |
| List supports pagination and filters | `findMine` list tests |
| Non-owner edit returns `403` | `getOwned and update` ownership test |
| Non-owner delete returns `403` | `remove` ownership test |
| Non-owner thumbnail upload returns `403` before MinIO | `uploadThumbnail` ownership test |
| Thumbnail upload follows avatar pattern | `uploadThumbnail` MinIO/object URL tests |
| Delete rule seam exists | `assertCourseCanBeDeleted` method exists and is called before delete |
| Controller is Instructor-only | `CoursesController RBAC` tests |

- [ ] **Step 6: Report final verification evidence**

In the final implementation response, include exact commands run and their pass/fail results. Do not claim completion unless `pnpm test courses` and `pnpm build` have passed.
