import { BadRequestException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { UserRole } from '../users/entities/user.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('AnalyticsController', () => {
  it('protects the course analytics route for instructors and delegates its range', async () => {
    const service = { getCourseAnalytics: jest.fn().mockResolvedValue({ courseId: 'course-id' }) };
    const controller = new AnalyticsController(service as unknown as AnalyticsService);
    const from = '2026-10-01T00:00:00.000Z';
    const to = '2026-10-08T00:00:00.000Z';

    await expect(controller.getCourseAnalytics('course-id', 'instructor-id', { from, to })).resolves.toEqual({ courseId: 'course-id' });
    expect(service.getCourseAnalytics).toHaveBeenCalledWith('course-id', 'instructor-id', new Date(from), new Date(to));
    expect(Reflect.getMetadata('__guards__', AnalyticsController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata('path', AnalyticsController)).toBe('courses');
    expect(Reflect.getMetadata('path', AnalyticsController.prototype.getCourseAnalytics)).toBe(':id/analytics');
    expect(Reflect.getMetadata('roles', AnalyticsController.prototype.getCourseAnalytics)).toContain(UserRole.INSTRUCTOR);
  });

  it('rejects non-ISO timestamps and missing query dates', async () => {
    const service = { getCourseAnalytics: jest.fn() };
    const controller = new AnalyticsController(service as unknown as AnalyticsService);
    expect(() => controller.getCourseAnalytics('course-id', 'instructor-id', { from: 'yesterday', to: '2026-10-08T00:00:00.000Z' })).toThrow(BadRequestException);
    expect(() => controller.getCourseAnalytics('course-id', 'instructor-id', { from: '2026-10-01T00:00:00.000Z' } as never)).toThrow(BadRequestException);
    expect(service.getCourseAnalytics).not.toHaveBeenCalled();
  });
});
