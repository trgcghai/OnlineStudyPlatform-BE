import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Connection } from 'mongoose';
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
    @InjectConnection() private readonly mongooseConnection: Connection,
  ) {}

  async getHealth() {
    const [postgresql, redis, mongodb] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkMongo(),
    ]);

    return {
      components: {
        application: { status: 'UP' },
        postgresql,
        redis,
        mongodb,
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

  private async checkMongo(): Promise<ComponentHealth> {
    try {
      await this.mongooseConnection.db?.admin().command({ ping: 1 });
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
