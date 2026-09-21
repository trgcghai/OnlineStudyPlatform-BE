import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartService } from 'src/modules/cart/cart.service';
import { CartController } from 'src/modules/cart/cart.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CartItem, Course, Enrollment])],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
