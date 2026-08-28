import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';

describe('LearningController', () => {
  let controller: LearningController;
  let learningService: {
    getCourseLearning: jest.Mock;
    getLessonLearning: jest.Mock;
  };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const lessonId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    learningService = {
      getCourseLearning: jest.fn(),
      getLessonLearning: jest.fn(),
    };
    controller = new LearningController(
      learningService as unknown as LearningService,
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
});
