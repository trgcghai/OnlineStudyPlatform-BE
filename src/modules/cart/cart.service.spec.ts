import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FREE_COURSE_PRICE } from '../../common/constants/course.constant';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { CartService } from './cart.service';
import { CartItem } from './entities/cart-item.entity';

type MockRepo<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const learnerId = '11111111-1111-4111-8111-111111111111';
const otherLearnerId = '22222222-2222-4222-8222-222222222222';
const courseId = '33333333-3333-4333-8333-333333333333';

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: courseId,
    title: 'Paid Course',
    description: 'Description',
    category: 'Programming',
    price: 99000,
    thumbnail: null,
    status: CourseStatus.PUBLISHED,
    instructorId: '44444444-4444-4444-8444-444444444444',
    instructor: {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Teacher',
    } as never,
    learningOrder: 'free' as never,
    completionThresholdPercent: '90.00',
    rejectReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  const course = makeCourse();
  return {
    id: '55555555-5555-4555-8555-555555555555',
    learnerId,
    courseId,
    course,
    learner: undefined as never,
    createdAt: new Date('2026-01-03T00:00:00Z'),
    updatedAt: new Date('2026-01-03T00:00:00Z'),
    ...overrides,
  };
}

describe('CartService', () => {
  let service: CartService;
  let cartRepo: MockRepo<CartItem>;
  let courseRepo: MockRepo<Course>;
  let enrollmentRepo: MockRepo<Enrollment>;

  beforeEach(async () => {
    cartRepo = {
      create: jest.fn((input: Partial<CartItem>) => input),
      save: jest.fn((item: CartItem) => makeCartItem(item)),
      findOne: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    courseRepo = { findOne: jest.fn() };
    enrollmentRepo = { exists: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: getRepositoryToken(CartItem), useValue: cartRepo },
        { provide: getRepositoryToken(Course), useValue: courseRepo },
        { provide: getRepositoryToken(Enrollment), useValue: enrollmentRepo },
      ],
    }).compile();

    service = module.get(CartService);
  });

  it('adds a paid published course to the learner cart', async () => {
    courseRepo.findOne!.mockResolvedValue(makeCourse());
    enrollmentRepo.exists!.mockResolvedValue(false);
    cartRepo.findOne!.mockResolvedValue(null);

    const result = await service.addItem(learnerId, courseId);

    expect(cartRepo.create).toHaveBeenCalledWith({ learnerId, courseId });
    expect(cartRepo.save).toHaveBeenCalled();
    expect(result.courseId).toBe(courseId);
    expect(result.course.title).toBe('Paid Course');
  });

  it('rejects a missing course', async () => {
    courseRepo.findOne!.mockResolvedValue(null);

    await expect(service.addItem(learnerId, courseId)).rejects.toEqual(
      new NotFoundException('Course not found'),
    );
  });

  it('rejects an unpublished course', async () => {
    courseRepo.findOne!.mockResolvedValue(
      makeCourse({ status: CourseStatus.DRAFT }),
    );

    await expect(service.addItem(learnerId, courseId)).rejects.toEqual(
      new BadRequestException(
        'Chỉ có thể thêm khóa học đã xuất bản vào giỏ hàng',
      ),
    );
  });

  it('rejects a free course', async () => {
    courseRepo.findOne!.mockResolvedValue(
      makeCourse({ price: FREE_COURSE_PRICE }),
    );

    await expect(service.addItem(learnerId, courseId)).rejects.toEqual(
      new BadRequestException('Khóa học miễn phí có thể đăng ký trực tiếp'),
    );
  });

  it('rejects an already enrolled course', async () => {
    courseRepo.findOne!.mockResolvedValue(makeCourse());
    enrollmentRepo.exists!.mockResolvedValue(true);

    await expect(service.addItem(learnerId, courseId)).rejects.toEqual(
      new ConflictException('Bạn đã đăng ký khóa học này'),
    );
  });

  it('rejects a duplicate cart item', async () => {
    courseRepo.findOne!.mockResolvedValue(makeCourse());
    enrollmentRepo.exists!.mockResolvedValue(false);
    cartRepo.findOne!.mockResolvedValue(makeCartItem());

    await expect(service.addItem(learnerId, courseId)).rejects.toEqual(
      new ConflictException('Khóa học đã có trong giỏ hàng'),
    );
  });

  it('maps a database unique violation to duplicate conflict', async () => {
    courseRepo.findOne!.mockResolvedValue(makeCourse());
    enrollmentRepo.exists!.mockResolvedValue(false);
    cartRepo.findOne!.mockResolvedValue(null);
    cartRepo.save!.mockRejectedValue({ code: '23505' });

    await expect(service.addItem(learnerId, courseId)).rejects.toEqual(
      new ConflictException('Khóa học đã có trong giỏ hàng'),
    );
  });

  it('lists only the learner cart with pagination and summary', async () => {
    const item = makeCartItem();
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[item], 1]),
    };
    cartRepo.createQueryBuilder!.mockReturnValue(qb);

    const result = await service.listCart(learnerId, { page: 1, limit: 10 });

    expect(qb.where).toHaveBeenCalledWith('cartItem.learnerId = :learnerId', {
      learnerId,
    });
    expect(result.total).toBe(1);
    expect(result.summary).toEqual({ totalItems: 1, totalPrice: 99000 });
    expect(result.items[0].course.instructor).toEqual({
      id: item.course.instructorId,
      name: 'Teacher',
    });
  });

  it('removes only the current learner cart item', async () => {
    cartRepo.delete!.mockResolvedValue({ affected: 1 });

    await expect(
      service.removeItem(learnerId, courseId),
    ).resolves.toBeUndefined();

    expect(cartRepo.delete).toHaveBeenCalledWith({ learnerId, courseId });
    expect(cartRepo.delete).not.toHaveBeenCalledWith({
      learnerId: otherLearnerId,
      courseId,
    });
  });

  it('returns not found when removing a missing cart item', async () => {
    cartRepo.delete!.mockResolvedValue({ affected: 0 });

    await expect(service.removeItem(learnerId, courseId)).rejects.toEqual(
      new NotFoundException('Cart item not found'),
    );
  });
});
