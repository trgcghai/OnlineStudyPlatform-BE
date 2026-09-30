import { Repository } from 'typeorm';

import { User, UserRole } from '../../modules/users/entities/user.entity';
import { SampleUserSeed } from './sampleUser.seed';

describe('SampleUserSeed', () => {
  let usersRepository: {
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let seed: SampleUserSeed;

  beforeEach(() => {
    usersRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    seed = new SampleUserSeed(usersRepository as unknown as Repository<User>);
  });

  it('creates only the three sample users', async () => {
    await seed.onApplicationBootstrap();

    expect(usersRepository.save).toHaveBeenCalledTimes(3);
    expect(usersRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'instructor@gmail.com',
        role: UserRole.INSTRUCTOR,
      }),
    );
  });

  it('does not overwrite an existing sample user', async () => {
    usersRepository.findOneBy.mockResolvedValue({ id: 'existing-user' });

    await seed.onApplicationBootstrap();

    expect(usersRepository.create).not.toHaveBeenCalled();
    expect(usersRepository.save).not.toHaveBeenCalled();
  });
});
