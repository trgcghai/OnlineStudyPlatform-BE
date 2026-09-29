import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import {
  CACHE_DEFAULT_VERSION,
  CACHE_VERSION_PREFIX,
  REDIS_CLIENT,
} from './redis.constants';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getNamespaceVersion(namespace: string): Promise<string> {
    try {
      return (
        (await this.redis.get(this.getVersionKey(namespace))) ??
        CACHE_DEFAULT_VERSION
      );
    } catch (error) {
      this.logger.warn(
        `Cache version lookup failed for namespace ${namespace}: ${this.formatError(error)}`,
      );
      return CACHE_DEFAULT_VERSION;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      this.logger.warn(
        `Cache get failed for key ${key}: ${this.formatError(error)}`,
      );
      return null;
    }
  }

  async set(key: string, value: unknown, ttl: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      this.logger.warn(
        `Cache set failed for key ${key}: ${this.formatError(error)}`,
      );
    }
  }

  async invalidateNamespaces(namespaces: string[]): Promise<void> {
    await Promise.all(
      namespaces.map(async (namespace) => {
        try {
          await this.redis.incr(this.getVersionKey(namespace));
        } catch (error) {
          this.logger.warn(
            `Cache invalidation failed for namespace ${namespace}: ${this.formatError(error)}`,
          );
        }
      }),
    );
  }

  private getVersionKey(namespace: string): string {
    return `${CACHE_VERSION_PREFIX}:${namespace}`;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
