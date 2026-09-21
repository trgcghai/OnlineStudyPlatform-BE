import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @IsUUID()
  courseId!: string;
}

export class ListCartQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export interface CartCourseInstructorResponse {
  id: string;
  name: string;
}

export interface CartCourseResponse {
  id: string;
  title: string;
  category: string;
  thumbnail: string | null;
  price: number;
  instructor: CartCourseInstructorResponse | null;
}

export interface CartItemResponse {
  id: string;
  courseId: string;
  addedAt: Date;
  course: CartCourseResponse;
}

export interface CartSummaryResponse {
  totalItems: number;
  totalPrice: number;
}

export interface CartResponse {
  items: CartItemResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: CartSummaryResponse;
}
