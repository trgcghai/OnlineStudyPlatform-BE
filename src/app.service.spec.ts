import { ServiceUnavailableException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { AppService, ComponentHealth } from './app.service';

describe('AppService', () => {
  let dataSource: { query: jest.Mock };
  let redisClient: { ping: jest.Mock; status: string };
  let mongooseConnection: { db: { admin: jest.Mock }; readyState: number };
  let s3Client: { send: jest.Mock };
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
    s3Client = { send: jest.fn().mockResolvedValue({}) };

    service = new AppService(
      dataSource as unknown as DataSource,
      redisClient as unknown as Redis,
      mongooseConnection as unknown as Connection,
      s3Client as unknown as S3Client,
      new ConfigService({ MINIO_BUCKET: 'assets' }),
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
    s3Client.send.mockRejectedValue(new Error('connection refused'));

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
    expect(s3Client.send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
    expect(s3Client.send.mock.calls[0][0].input).toEqual({ Bucket: 'assets' });
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
      s3Client.send.mockReturnValue(new Promise(() => {}));

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
