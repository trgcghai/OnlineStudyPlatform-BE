import { PartialType } from '@nestjs/mapped-types';

export class CreateNotificationDto {}

export class UpdateNotificationDto extends PartialType(CreateNotificationDto) {}
