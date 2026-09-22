import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { PaymentsService } from '../payments/payments.service';
import { CartService } from './cart.service';
import { AddCartItemDto, ListCartQueryDto } from './dto/cart.dto';

@Controller('cart')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LEARNER)
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Post('checkout')
  checkout(@CurrentUser('id') learnerId: string) {
    return this.paymentsService.createCartCheckout(learnerId);
  }

  @Get()
  listCart(
    @CurrentUser('id') learnerId: string,
    @Query() query: ListCartQueryDto,
  ) {
    return this.cartService.listCart(learnerId, query);
  }

  @Post('items')
  addItem(@CurrentUser('id') learnerId: string, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(learnerId, dto.courseId);
  }

  @Delete('items/:courseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(
    @CurrentUser('id') learnerId: string,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.cartService.removeItem(learnerId, courseId);
  }
}
