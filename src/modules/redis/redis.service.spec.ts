import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    incr: jest.Mock;
  };
  let service: RedisService;

  beforeEach(() => {
    redis = {
      get: jest.fn(),
      set: jest.fn(),
      incr: jest.fn(),
    };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new RedisService(redis as unknown as Redis);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns default version when namespace version is missing', async () => {
    redis.get.mockResolvedValue(null);

    await expect(
      service.getNamespaceVersion('courses:public:list'),
    ).resolves.toBe('1');
    expect(redis.get).toHaveBeenCalledWith('cache-version:courses:public:list');
  });

  it('returns null and fails open when cache get fails', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));

    await expect(service.get('cache:key')).resolves.toBeNull();
  });

  it('parses cached JSON values', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ items: [] }));

    await expect(service.get('cache:key')).resolves.toEqual({ items: [] });
  });

  it('sets cache values with TTL and fails open on set errors', async () => {
    redis.set.mockRejectedValue(new Error('redis down'));

    await expect(
      service.set('cache:key', { ok: true }, 60),
    ).resolves.toBeUndefined();
    expect(redis.set).toHaveBeenCalledWith(
      'cache:key',
      JSON.stringify({ ok: true }),
      'EX',
      60,
    );
  });

  it('invalidates namespaces with INCR and fails open on errors', async () => {
    redis.incr.mockRejectedValue(new Error('redis down'));

    await expect(
      service.invalidateNamespaces(['courses:public:list']),
    ).resolves.toBeUndefined();
    expect(redis.incr).toHaveBeenCalledWith(
      'cache-version:courses:public:list',
    );
  });
});
