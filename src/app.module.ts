import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisModule } from './modules/redis/redis.module';
import { MongooseModule } from '@nestjs/mongoose';
import { FileModule } from './modules/file/file.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { CoursesModule } from './modules/courses/courses.module';
import { LessonsModule } from './modules/lessons/lessons.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { CartModule } from './modules/cart/cart.module';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { LearningModule } from './modules/learning/learning.module';
import { QuizzesModule } from './modules/quizzes/quizzes.module';
import { SeedsModule } from './common/seeds/seeds.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AiChatModule } from './modules/ai-chat/ai-chat.module';
import { OrdersModule } from './modules/orders/orders.module';
import { AiSummaryModule } from './modules/ai-summary/ai-summary.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    RedisModule,
    FileModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.getOrThrow<string>('DB_HOST'),
        port: configService.getOrThrow<number>('DB_PORT'),
        username: configService.getOrThrow<string>('DB_USERNAME'),
        password: configService.getOrThrow<string>('DB_PASSWORD'),
        database: configService.getOrThrow<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize:
          configService.get<string>('DB_SYNCHRONIZE') === 'true' ||
          (configService.get<string>('DB_SYNCHRONIZE') === undefined &&
            configService.get<string>('NODE_ENV') !== 'production'),
      }),
    }),
    UsersModule,
    AuthModule,
    CoursesModule,
    LessonsModule,
    EnrollmentsModule,
    CartModule,
    LearningModule,
    DashboardModule,
    NotificationsModule,
    QuizzesModule,
    PaymentsModule,
    AiChatModule,
    AiSummaryModule,
    OrdersModule,
    SeedsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
  ],
})
export class AppModule {}
