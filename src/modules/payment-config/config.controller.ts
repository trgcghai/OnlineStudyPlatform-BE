import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { ConfigService } from './config.service';
import {
  ListPaymentConfigAuditsQueryDto,
  UpdatePaymentConfigDto,
} from './dto/config.dto';

@Controller('payment/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig() {
    return this.configService.getActiveConfig();
  }

  @Put()
  updateConfig(
    @CurrentUser('id') actorId: string,
    @Body() dto: UpdatePaymentConfigDto,
  ) {
    return this.configService.updateConfig(actorId, dto);
  }

  @Get('audits')
  listAudits(@Query() query: ListPaymentConfigAuditsQueryDto) {
    return this.configService.listAudits(query);
  }
}
