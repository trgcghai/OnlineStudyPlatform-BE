import { MODULE_METADATA } from '@nestjs/common/constants';
import { NotificationsModule } from '../notifications/notifications.module';
import { LearningModule } from './learning.module';

describe('LearningModule', () => {
  it('imports NotificationsModule for quiz attempt notification dependencies', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      LearningModule,
    );

    expect(imports).toContain(NotificationsModule);
  });
});
