import { LearningController } from './learning.controller';
import { LearningProgressService } from './learning-progress.service';
import { LearningService } from './learning.service';
import { LessonWatchEventType } from './entities/lesson-watch-event.entity';

describe('LearningController', () => {
  let controller: LearningController;
  let learningService: {
    getCourseLearning: jest.Mock;
    getLessonLearning: jest.Mock;
  };
  let progressService: {
    recordWatchEvent: jest.Mock;
  };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const lessonId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    learningService = {
      getCourseLearning: jest.fn(),
      getLessonLearning: jest.fn(),
    };
    progressService = {
      recordWatchEvent: jest.fn(),
    };
    controller = new LearningController(
      learningService as unknown as LearningService,
      progressService as unknown as LearningProgressService,
    );
  });

  it('delegates course snapshot loading to LearningService', async () => {
    const response = { firstAccessibleLessonId: lessonId };
    learningService.getCourseLearning.mockResolvedValue(response);

    await expect(controller.getCourse(courseId, learnerId)).resolves.toBe(
      response,
    );
    expect(learningService.getCourseLearning).toHaveBeenCalledWith(
      learnerId,
      courseId,
    );
  });

  it('delegates lesson playback loading to LearningService', async () => {
    const response = { id: lessonId, videoUrl: 'video.mp4' };
    learningService.getLessonLearning.mockResolvedValue(response);

    await expect(
      controller.getLesson(courseId, lessonId, learnerId),
    ).resolves.toBe(response);
    expect(learningService.getLessonLearning).toHaveBeenCalledWith(
      learnerId,
      courseId,
      lessonId,
    );
  });

  it('delegates watch-event recording to LearningProgressService', async () => {
    const dto = {
      idempotencyKey: 'course:lesson:session:heartbeat:120',
      eventType: LessonWatchEventType.HEARTBEAT,
      positionSeconds: 120,
      watchedSeconds: 120,
      durationSeconds: 600,
      clientCreatedAt: '2026-08-29T00:00:00.000Z',
    };
    const response = {
      lessonProgress: { lessonId, isLessonComplete: false },
    };
    progressService.recordWatchEvent.mockResolvedValue(response);

    await expect(
      controller.recordWatchEvent(courseId, lessonId, learnerId, dto),
    ).resolves.toBe(response);
    expect(progressService.recordWatchEvent).toHaveBeenCalledWith(
      learnerId,
      courseId,
      lessonId,
      dto,
    );
  });
});
