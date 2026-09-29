import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { from, Observable, of } from 'rxjs';
import { mergeMap, tap } from 'rxjs/operators';
import { CACHE_INVALIDATE_METADATA, CACHE_METADATA } from './redis.constants';
import { CachedOptions } from './redis.decorators';
import { buildKey } from './key.builder';
import { RedisService } from './redis.service';

type RedisRequest = Request & {
  user?: unknown;
  route?: { path?: string };
};

@Injectable()
export class RedisInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const invalidateNamespaces = this.reflector.getAllAndOverride<string[]>(
      CACHE_INVALIDATE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    const cacheOptions = this.reflector.getAllAndOverride<CachedOptions>(
      CACHE_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (cacheOptions) {
      return this.handleCachedRequest(context, next, cacheOptions);
    }

    if (invalidateNamespaces?.length) {
      return next.handle().pipe(
        tap({
          next: () => {
            void this.redisService.invalidateNamespaces(invalidateNamespaces);
          },
        }),
      );
    }

    return next.handle();
  }

  private handleCachedRequest(
    context: ExecutionContext,
    next: CallHandler,
    cacheOptions: CachedOptions,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RedisRequest>();
    const scope = this.resolveScope(request, cacheOptions);

    if (request.method !== 'GET' || !scope) {
      return next.handle();
    }

    return from(this.resolveKey(request, cacheOptions.namespace, scope)).pipe(
      mergeMap(async (key) => {
        const cached = await this.redisService.get<unknown>(key);
        return { cached, key };
      }),
      mergeMap(({ cached, key }) => {
        if (cached !== null) {
          return of(cached);
        }

        return next.handle().pipe(
          tap({
            next: (data) => {
              void this.redisService.set(key, data, cacheOptions.ttl);
            },
          }),
        );
      }),
    );
  }

  private async resolveKey(
    request: RedisRequest,
    namespace: string,
    scope: string,
  ): Promise<string> {
    const version = await this.redisService.getNamespaceVersion(namespace);

    return buildKey({
      namespace,
      version,
      scope,
      method: request.method,
      routePath: request.route?.path ?? request.path,
      params: request.params,
      query: request.query as Record<string, never>,
    });
  }

  private resolveScope(
    request: RedisRequest,
    cacheOptions: CachedOptions,
  ): string | null {
    const scope = cacheOptions.scope ?? 'anonymous';

    if (scope === 'anonymous') {
      return request.user ? null : 'anonymous';
    }

    const userId = this.getUserId(request.user);

    if (scope === 'anonymous-or-user') {
      return userId ? `user:${userId}` : 'anonymous';
    }

    return userId ? `user:${userId}` : null;
  }

  private getUserId(user: unknown): string | null {
    if (!user || typeof user !== 'object' || !('id' in user)) {
      return null;
    }

    const id = (user as { id?: unknown }).id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }
}
