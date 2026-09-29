import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticatedUser } from '../auth/dto/auth.dto';
import { UserRole } from '../users/entities/user.entity';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

describe('RecommendationsController', () => {
  let controller: RecommendationsController;
  let service: { getRecommendations: jest.Mock };

  beforeEach(async () => {
    service = { getRecommendations: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationsController],
      providers: [{ provide: RecommendationsService, useValue: service }],
    }).compile();

    controller = module.get(RecommendationsController);
  });

  it('delegates to service with current learner id and query limit', async () => {
    service.getRecommendations.mockResolvedValue([]);

    await expect(
      controller.getMyRecommendations(
        { id: 'learner-1', role: UserRole.LEARNER } as AuthenticatedUser,
        { limit: 6 },
      ),
    ).resolves.toEqual([]);

    expect(service.getRecommendations).toHaveBeenCalledWith('learner-1', 6);
  });

  it('uses default limit from query DTO', async () => {
    service.getRecommendations.mockResolvedValue([]);

    await controller.getMyRecommendations(
      { id: 'learner-1', role: UserRole.LEARNER } as AuthenticatedUser,
      { limit: 8 },
    );

    expect(service.getRecommendations).toHaveBeenCalledWith('learner-1', 8);
  });
});
