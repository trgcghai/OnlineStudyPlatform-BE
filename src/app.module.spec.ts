import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

jest.mock('./modules/redis/redis.module', () => ({
  RedisModule: class RedisModule {},
}));
jest.mock('./modules/file/file.module', () => ({
  FileModule: class FileModule {},
}));
jest.mock('./modules/users/users.module', () => ({
  UsersModule: class UsersModule {},
}));
jest.mock('./modules/auth/auth.module', () => ({
  AuthModule: class AuthModule {},
}));
jest.mock('./modules/courses/courses.module', () => ({
  CoursesModule: class CoursesModule {},
}));
jest.mock('./modules/lessons/lessons.module', () => ({
  LessonsModule: class LessonsModule {},
}));
jest.mock('./modules/enrollments/enrollments.module', () => ({
  EnrollmentsModule: class EnrollmentsModule {},
}));
jest.mock('./modules/cart/cart.module', () => ({
  CartModule: class CartModule {},
}));
jest.mock('./modules/notifications/notifications.module', () => ({
  NotificationsModule: class NotificationsModule {},
}));
jest.mock('./modules/learning/learning.module', () => ({
  LearningModule: class LearningModule {},
}));
jest.mock('./modules/quizzes/quizzes.module', () => ({
  QuizzesModule: class QuizzesModule {},
}));
jest.mock('./common/seeds/seeds.module', () => ({
  SeedsModule: class SeedsModule {},
}));
jest.mock('./modules/dashboard/dashboard.module', () => ({
  DashboardModule: class DashboardModule {},
}));
jest.mock('./modules/payments/payments.module', () => ({
  PaymentsModule: class PaymentsModule {},
}));
jest.mock('./modules/ai-chat/ai-chat.module', () => ({
  AiChatModule: class AiChatModule {},
}));
jest.mock('./modules/orders/orders.module', () => ({
  OrdersModule: class OrdersModule {},
}));
jest.mock('./modules/recommendations/recommendations.module', () => ({
  RecommendationsModule: class RecommendationsModule {},
}));

import { AppModule } from './app.module';

describe('AppModule rate limiting', () => {
  it('registers ThrottlerModule globally', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    ) as unknown[];

    expect(imports.some((entry) => entry === ThrottlerModule)).toBe(false);
    expect(
      imports.some(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          'module' in entry &&
          entry.module === ThrottlerModule,
      ),
    ).toBe(true);
  });

  it('registers ThrottlerGuard as a global guard', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AppModule,
    ) as Array<{ provide?: unknown; useClass?: unknown }>;

    expect(providers).toContainEqual({
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    });
  });
});
