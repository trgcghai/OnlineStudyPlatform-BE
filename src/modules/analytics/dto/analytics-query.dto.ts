import { IsDateString } from 'class-validator';

export class AnalyticsQueryDto {
  @IsDateString({ strict: true })
  from!: string;

  @IsDateString({ strict: true })
  to!: string;
}
