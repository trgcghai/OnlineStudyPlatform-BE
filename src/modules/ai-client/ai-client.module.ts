import { Module } from '@nestjs/common';
import { AiHttpClientService } from './ai-http-client.service';

@Module({
  providers: [AiHttpClientService],
  exports: [AiHttpClientService],
})
export class AiClientModule {}
