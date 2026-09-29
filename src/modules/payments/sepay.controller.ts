import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SePayWebhookPayload } from './dto/payment.dto';
import { PaymentsService } from './payments.service';
import { SePayAuthGuard } from '../../common/guards/sepay-auth.guard';

@Controller('payments/sepay')
export class SePayWebhookController {
  private readonly logger = new Logger(SePayWebhookController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhook')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @UseGuards(SePayAuthGuard)
  async handleWebhook(
    @Body() payload: SePayWebhookPayload,
    @Res() res: Response,
  ): Promise<void> {
    if (!payload || typeof payload.transferType !== 'string') {
      throw new BadRequestException('Invalid SePay payload');
    }

    try {
      this.logger.log(
        `SePay webhook #${payload.id} type=${payload.transferType} amount=${payload.transferAmount} code=${payload.code ?? '(none)'} acc=***${payload.accountNumber.slice(-4)}`,
      );
      await this.paymentsService.processSePayWebhook(payload);
      this.logger.log(`SePay webhook #${payload.id} processed OK`);
    } catch (error) {
      this.logger.error('SePay webhook processing failed', error as Error);
    }

    res.status(HttpStatus.OK).json({ success: true });
  }
}
