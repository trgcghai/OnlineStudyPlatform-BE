import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Connection, ConnectionStates } from 'mongoose';
import { DataSource } from 'typeorm';
import { MINIO_S3_CLIENT } from './common/constants/file.constant';
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
    @Inject(MINIO_S3_CLIENT) private readonly s3Client: S3Client,
    private readonly configService: ConfigService,
  ) {}

  async getHealth() {
    const [postgresql, redis, mongodb, minio] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkMongo(),
      this.checkMinio(),
    ]);

    const payload = {
      components: {
        application: { status: 'UP' },
        postgresql,
        redis,
        mongodb,
        minio,
      },
    };

    const infraDown = [postgresql, redis, mongodb, minio].some(
      (component) => component.status !== 'UP',
    );

    if (infraDown) {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }

  private readonly HEALTH_CHECK_TIMEOUT_MS = 3000;

  private async check(
    name: string,
    run: () => Promise<unknown>,
  ): Promise<ComponentHealth> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${name} health check timed out`)),
        this.HEALTH_CHECK_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([run(), timeout]);
      return { status: 'UP' };
    } catch (error) {
      return {
        status: 'DOWN',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private checkPostgres(): Promise<ComponentHealth> {
    return this.check('postgresql', () => this.dataSource.query('SELECT 1'));
  }

  private checkRedis(): Promise<ComponentHealth> {
    if (this.redisClient.status !== 'ready') {
      return Promise.resolve({
        status: 'DOWN',
        details: {
          error: `redis not connected (status: ${this.redisClient.status})`,
        },
      });
    }
    return this.check('redis', () => this.redisClient.ping());
  }

  private checkMongo(): Promise<ComponentHealth> {
    if (this.mongooseConnection.readyState !== ConnectionStates.connected) {
      return Promise.resolve({
        status: 'DOWN',
        details: {
          error: `mongodb not connected (readyState: ${this.mongooseConnection.readyState})`,
        },
      });
    }
    return this.check('mongodb', async () => {
      await this.mongooseConnection.db?.admin().command({ ping: 1 });
    });
  }

  private checkMinio(): Promise<ComponentHealth> {
    return this.check('minio', () =>
      this.s3Client.send(
        new HeadBucketCommand({
          Bucket: this.configService.getOrThrow<string>('MINIO_BUCKET'),
        }),
      ),
    );
  }
}
