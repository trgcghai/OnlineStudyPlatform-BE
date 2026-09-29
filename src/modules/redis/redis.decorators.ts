import { SetMetadata } from '@nestjs/common';
import { CACHE_INVALIDATE_METADATA, CACHE_METADATA } from './redis.constants';

export type CacheScope = 'anonymous' | 'user' | 'anonymous-or-user';

export type CachedOptions = {
  namespace: string;
  ttl: number;
  scope?: CacheScope;
};

export type ResolvedCachedOptions = Required<CachedOptions>;

export const Cached = (options: CachedOptions) =>
  SetMetadata(CACHE_METADATA, {
    ...options,
    scope: options.scope ?? 'anonymous',
  } satisfies ResolvedCachedOptions);

export const InvalidateCache = (namespaces: string[]) =>
  SetMetadata(CACHE_INVALIDATE_METADATA, namespaces);
