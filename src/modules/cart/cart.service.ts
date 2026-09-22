import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FREE_COURSE_PRICE } from '../../common/constants/course.constant';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import {
  CartItemResponse,
  CartResponse,
  ListCartQueryDto,
} from './dto/cart.dto';
import { CartItem } from './entities/cart-item.entity';

const COURSE_NOT_FOUND_ERROR = 'Course not found';
const PUBLISHED_ONLY_ERROR =
  'Chỉ có thể thêm khóa học đã xuất bản vào giỏ hàng';
const FREE_COURSE_ERROR = 'Khóa học miễn phí có thể đăng ký trực tiếp';
const DUPLICATE_ENROLLMENT_ERROR = 'Bạn đã đăng ký khóa học này';
const DUPLICATE_CART_ITEM_ERROR = 'Khóa học đã có trong giỏ hàng';
const CART_ITEM_NOT_FOUND_ERROR = 'Cart item not found';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartItem)
    private readonly cartItemsRepository: Repository<CartItem>,
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
  ) {}

  async listCart(
    learnerId: string,
    query: ListCartQueryDto,
  ): Promise<CartResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const [items, total] = await this.cartItemsRepository
      .createQueryBuilder('cartItem')
      .leftJoinAndSelect('cartItem.course', 'course')
      .leftJoinAndSelect('course.instructor', 'instructor')
      .where('cartItem.learnerId = :learnerId', { learnerId })
      .orderBy('cartItem.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const responseItems = items.map((item) => this.toCartItemResponse(item));
    const totalPrice = responseItems.reduce(
      (sum, item) => sum + item.course.price,
      0,
    );

    return {
      items: responseItems,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        totalItems: total,
        totalPrice,
      },
    };
  }

  async addItem(
    learnerId: string,
    courseId: string,
  ): Promise<CartItemResponse> {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
      relations: { instructor: true },
    });

    if (!course) {
      throw new NotFoundException(COURSE_NOT_FOUND_ERROR);
    }

    if (course.status !== CourseStatus.PUBLISHED) {
      throw new BadRequestException(PUBLISHED_ONLY_ERROR);
    }

    if (course.price <= FREE_COURSE_PRICE) {
      throw new BadRequestException(FREE_COURSE_ERROR);
    }

    const isEnrolled = await this.enrollmentsRepository.exists({
      where: { learnerId, courseId },
    });
    if (isEnrolled) {
      throw new ConflictException(DUPLICATE_ENROLLMENT_ERROR);
    }

    const existingCartItem = await this.cartItemsRepository.findOne({
      where: { learnerId, courseId },
    });
    if (existingCartItem) {
      throw new ConflictException(DUPLICATE_CART_ITEM_ERROR);
    }

    const cartItem = this.cartItemsRepository.create({ learnerId, courseId });

    try {
      const saved = await this.cartItemsRepository.save(cartItem);
      saved.course = course;
      return this.toCartItemResponse(saved);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(DUPLICATE_CART_ITEM_ERROR);
      }
      throw error;
    }
  }

  async removeItem(learnerId: string, courseId: string): Promise<void> {
    const result = await this.cartItemsRepository.delete({
      learnerId,
      courseId,
    });

    if (!result.affected) {
      throw new NotFoundException(CART_ITEM_NOT_FOUND_ERROR);
    }
  }

  private toCartItemResponse(item: CartItem): CartItemResponse {
    return {
      id: item.id,
      courseId: item.courseId,
      addedAt: item.createdAt,
      course: {
        id: item.course.id,
        title: item.course.title,
        category: item.course.category,
        thumbnail: item.course.thumbnail,
        price: item.course.price,
        instructor: item.course.instructor
          ? {
              id: item.course.instructor.id,
              name: item.course.instructor.name,
            }
          : null,
      },
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }
}
