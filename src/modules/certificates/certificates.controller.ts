import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { CertificatesService } from './certificates.service';

@Controller('learner/certificates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LEARNER)
export class CertificatesController {
  constructor(private readonly service: CertificatesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser('id') learnerId: string) {
    return this.service.list(learnerId);
  }

  @Get(':id/download')
  @Header('Cache-Control', 'private, no-store')
  download(
    @CurrentUser('id') learnerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.download(learnerId, id);
  }
}

@Controller('certificates')
export class CertificateVerificationController {
  constructor(private readonly service: CertificatesService) {}

  @Get(':id/verify')
  verify(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.verify(id);
  }
}
