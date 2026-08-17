import { ServiceUnavailableException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import type * as Minio from 'minio';
import { AppService, ComponentHealth } from './app.service';

describe('AppService', () => {
  let dataSource: { query: jest.Mock };
  let redisClient: { ping: jest.Mock; status: string };
  let mongooseConnection: { db: { admin: jest.Mock }; readyState: number };
  let minioClient: { listBuckets: jest.Mock };
  let service: AppService;

  beforeEach(() => {
    dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    redisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
      status: 'ready',
    };
    mongooseConnection = {
      db: {
        admin: jest.fn().mockReturnValue({
          command: jest.fn().mockResolvedValue({ ok: 1 }),
        }),
      },
      readyState: 1,
    };
    minioClient = { listBuckets: jest.fn().mockResolvedValue([]) };

    service = new AppService(
      dataSource as unknown as DataSource,
      redisClient as unknown as Redis,
      mongooseConnection as unknown as Connection,
      minioClient as unknown as Minio.Client,
    );
  });

  it('reports all five components UP when every dependency is reachable', async () => {
    const health = await service.getHealth();

    expect(health.components.application.status).toBe('UP');
    expect(health.components.postgresql.status).toBe('UP');
    expect(health.components.redis.status).toBe('UP');
    expect(health.components.mongodb.status).toBe('UP');
    expect(health.components.minio.status).toBe('UP');
  });

  it('throws ServiceUnavailableException carrying the payload when minio is down', async () => {
    minioClient.listBuckets.mockRejectedValue(new Error('connection refused'));

    await expect(service.getHealth()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    const error = await service.getHealth().catch((e: unknown) => e);
    const payload = (error as ServiceUnavailableException).getResponse() as {
      components: Record<string, ComponentHealth>;
    };
    expect(payload.components.application.status).toBe('UP');
    expect(payload.components.minio.status).toBe('DOWN');
    expect(payload.components.minio.details?.error).toBe('connection refused');
  });

  it('reports redis DOWN immediately when the client is not ready', async () => {
    redisClient.status = 'reconnecting';

    await expect(service.getHealth()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const error = await service.getHealth().catch((e: unknown) => e);
    const payload = (error as ServiceUnavailableException).getResponse() as {
      components: Record<string, ComponentHealth>;
    };
    expect(payload.components.redis.status).toBe('DOWN');
    expect(payload.components.redis.details?.error).toContain(
      'redis not connected',
    );
    expect(redisClient.ping).not.toHaveBeenCalled();
  });

  it('reports mongodb DOWN immediately when the connection is not established', async () => {
    mongooseConnection.readyState = 0;

    await expect(service.getHealth()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    const error = await service.getHealth().catch((e: unknown) => e);
    const payload = (error as ServiceUnavailableException).getResponse() as {
      components: Record<string, ComponentHealth>;
    };
    expect(payload.components.mongodb.status).toBe('DOWN');
    expect(payload.components.mongodb.details?.error).toContain(
      'mongodb not connected',
    );
  });

  it('reports DOWN with a timed-out error when a check never settles', async () => {
    jest.useFakeTimers();
    try {
      minioClient.listBuckets.mockReturnValue(new Promise(() => {}));

      const errorPromise = service.getHealth().catch((e: unknown) => e);
      jest.advanceTimersByTime(3001);
      const error = await errorPromise;

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const payload = (error as ServiceUnavailableException).getResponse() as {
        components: Record<string, ComponentHealth>;
      };
      expect(payload.components.minio.status).toBe('DOWN');
      expect(payload.components.minio.details?.error).toBe(
        'minio health check timed out',
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
