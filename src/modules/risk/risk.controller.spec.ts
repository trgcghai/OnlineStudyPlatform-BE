import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { UserRole } from '../users/entities/user.entity';
import { RiskBand } from './dto/risk.dto';
import { RiskController } from './risk.controller';
import { RiskService } from './risk.service';

describe('RiskController', () => {
  let controller: RiskController;
  let service: {
    getModel: jest.Mock;
    getSummary: jest.Mock;
    getLearners: jest.Mock;
    getLearnerDetail: jest.Mock;
    recomputeCourse: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getModel: jest.fn(),
      getSummary: jest.fn(),
      getLearners: jest.fn(),
      getLearnerDetail: jest.fn(),
      recomputeCourse: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RiskController],
      providers: [{ provide: RiskService, useValue: service }],
    }).compile();

    controller = moduleRef.get(RiskController);
  });

  it('passes instructor id to summary service', async () => {
    service.getSummary.mockResolvedValue({ totalScoredLearners: 0 });

    await controller.getSummary('course-1', 'instructor-1');

    expect(service.getSummary).toHaveBeenCalledWith('course-1', 'instructor-1');
  });

  it('gets risk model through service', async () => {
    const status = { model: null };
    service.getModel.mockResolvedValue(status);

    await expect(controller.getModel()).resolves.toBe(status);
  });

  it('requires admin role for model endpoint', () => {
    const getModelHandler = Object.getOwnPropertyDescriptor(
      RiskController.prototype,
      'getModel',
    )?.value as unknown;
    expect(Reflect.getMetadata(ROLES_KEY, getModelHandler)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it('passes filters to learner list service', async () => {
    service.getLearners.mockResolvedValue({ learners: [] });

    await controller.getLearners('course-1', 'instructor-1', {
      threshold: 80,
      band: RiskBand.HIGH,
    });

    expect(service.getLearners).toHaveBeenCalledWith(
      'course-1',
      'instructor-1',
      {
        threshold: 80,
        band: RiskBand.HIGH,
      },
    );
  });
});
