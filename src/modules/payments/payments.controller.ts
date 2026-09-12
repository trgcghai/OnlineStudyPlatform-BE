import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import {
  ListPaymentConfigAuditsQueryDto,
  UpdatePaymentConfigDto,
} from './dto/config.dto';
import {
  ListAdminPaymentProviderEventsQueryDto,
  ListAdminPaymentTransactionsQueryDto,
} from './dto/admin-payment.dto';
import { CheckoutCourseDto } from './dto/payment.dto';
import { ConfigService } from './config.service';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {}

  @Post('checkout')
  @Roles(UserRole.LEARNER)
  createCheckout(
    @CurrentUser('id') learnerId: string,
    @Body() dto: CheckoutCourseDto,
  ) {
    return this.paymentsService.createCheckout(learnerId, dto.courseId);
  }

  @Get('transactions/:transactionId')
  @Roles(UserRole.LEARNER)
  getTransaction(
    @CurrentUser('id') learnerId: string,
    @Param('transactionId') transactionId: string,
  ) {
    return this.paymentsService.getOwnedTransaction(learnerId, transactionId);
  }

  @Post('transactions/:transactionId/cancel')
  @Roles(UserRole.LEARNER)
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

  @Get('config')
  @Roles(UserRole.ADMIN)
  getConfig() {
    return this.configService.getActiveConfig();
  }

  @Put('config')
  @Roles(UserRole.ADMIN)
  updateConfig(
    @CurrentUser('id') actorId: string,
    @CurrentUser('email') actorEmail: string,
    @Body() dto: UpdatePaymentConfigDto,
  ) {
    return this.configService.updateConfig(actorId, actorEmail, dto);
  }

  @Get('config/audits')
  @Roles(UserRole.ADMIN)
  listAudits(@Query() query: ListPaymentConfigAuditsQueryDto) {
    return this.configService.listAudits(query);
  }

  @Get('admin/transactions')
  @Roles(UserRole.ADMIN)
  listAdminTransactions(@Query() query: ListAdminPaymentTransactionsQueryDto) {
    return this.paymentsService.listAdminTransactions(query);
  }

  @Get('admin/transactions/:transactionId')
  @Roles(UserRole.ADMIN)
  getAdminTransactionDetail(@Param('transactionId') transactionId: string) {
    return this.paymentsService.getAdminTransactionDetail(transactionId);
  }

  @Get('admin/provider-events')
  @Roles(UserRole.ADMIN)
  listAdminProviderEvents(
    @Query() query: ListAdminPaymentProviderEventsQueryDto,
  ) {
    return this.paymentsService.listAdminProviderEvents(query);
  }

  @Get('admin/provider-events/:eventId')
  @Roles(UserRole.ADMIN)
  getAdminProviderEventDetail(@Param('eventId') eventId: string) {
    return this.paymentsService.getAdminProviderEventDetail(eventId);
  }
}
