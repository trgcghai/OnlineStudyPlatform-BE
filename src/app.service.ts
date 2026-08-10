import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from './modules/redis/redis.module';

export interface ComponentHealth {
  status: string;
  details?: { error: string };
}

@Injectable()
export class AppService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {}

  async getHealth() {
    const [postgresql, redis] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
    ]);

    return {
      components: {
        application: { status: 'UP' },
        postgresql,
        redis,
        mongodb: { status: 'developing' },
        minio: { status: 'developing' },
      },
    };
  }

  private async checkPostgres(): Promise<ComponentHealth> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'UP' };
    } catch (error) {
      return {
        status: 'DOWN',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async checkRedis(): Promise<ComponentHealth> {
    try {
      await this.redisClient.ping();
      return { status: 'UP' };
    } catch (error) {
      return {
        status: 'DOWN',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
