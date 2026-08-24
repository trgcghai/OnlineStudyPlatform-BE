import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
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
    instructor: undefined as never,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    repo = {
      create: jest.fn((input: Partial<Course>) => input),
      save: jest.fn((input: Partial<Course>) => ({
        ...makeCourse(),
        ...input,
      })),
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

  describe('findMine', () => {
    const buildQueryBuilder = (options?: {
      count?: number;
      courses?: Course[];
    }) => {
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

      expect(qb.where).toHaveBeenCalledWith(
        'course.instructorId = :instructorId',
        { instructorId },
      );
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
      repo.findOne.mockResolvedValue(
        makeCourse({ instructorId: otherInstructorId }),
      );

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

  describe('remove', () => {
    it('deletes an owned course after delete rule passes', async () => {
      repo.findOne.mockResolvedValue(makeCourse());

      await service.remove(courseId, instructorId);

      expect(repo.delete).toHaveBeenCalledWith(courseId);
    });

    it('returns 403 and does not delete when another Instructor owns the course', async () => {
      repo.findOne.mockResolvedValue(
        makeCourse({ instructorId: otherInstructorId }),
      );

      await expect(service.remove(courseId, instructorId)).rejects.toEqual(
        new ForbiddenException('You do not own this course'),
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

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

      const result = await service.uploadThumbnail(
        courseId,
        instructorId,
        pngFile,
      );

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
      repo.findOne.mockResolvedValue(
        makeCourse({ instructorId: otherInstructorId }),
      );

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
});
