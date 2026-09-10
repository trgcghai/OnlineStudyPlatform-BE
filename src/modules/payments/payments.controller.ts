import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { CheckoutCourseDto } from './dto/payment.dto';
import { ConfigService } from './config.service';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LEARNER)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {}

  @Post('checkout')
  createCheckout(
    @CurrentUser('id') learnerId: string,
    @Body() dto: CheckoutCourseDto,
  ) {
    return this.paymentsService.createCheckout(learnerId, dto.courseId);
  }

  @Get('transactions/:transactionId')
  getTransaction(
    @CurrentUser('id') learnerId: string,
    @Param('transactionId') transactionId: string,
  ) {
    return this.paymentsService.getOwnedTransaction(learnerId, transactionId);
  }

  @Post('transactions/:transactionId/cancel')
  cancelTransaction(
    @CurrentUser('id') learnerId: string,
    @Param('transactionId') transactionId: string,
  ) {
    return this.paymentsService.cancelOwnedTransaction(
      learnerId,
      transactionId,
    );
  }

  @Get('pricing')
  @Roles(UserRole.INSTRUCTOR)
  getCoursePricing() {
    return this.configService.getCoursePricingReference();
  }
}
