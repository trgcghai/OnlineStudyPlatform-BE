import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardModule } from './dashboard.module';
import { LearnerDashboardService } from './learner-dashboard.service';

describe('DashboardModule', () => {
  it('declares dashboard controller and learner dashboard service', () => {
    expect(Reflect.getMetadata('controllers', DashboardModule)).toContain(
      DashboardController,
    );
    expect(Reflect.getMetadata('providers', DashboardModule)).toContain(
      LearnerDashboardService,
    );
  });

  it('registers dashboard entity repositories', () => {
    const imports = Reflect.getMetadata('imports', DashboardModule);
    const typeOrmFeatureModule = imports[0];

    expect(typeOrmFeatureModule.module).toBe(TypeOrmModule);
    expect(
      typeOrmFeatureModule.providers.map(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        (provider: { provide: string | Function }) => provider.provide,
      ),
    ).toEqual(
      expect.arrayContaining([
        getRepositoryToken(Enrollment),
        getRepositoryToken(Lesson),
        getRepositoryToken(LessonProgress),
        getRepositoryToken(QuizAttempt),
        getRepositoryToken(LearningAnalyticsEvent),
      ]),
    );
  });
});
