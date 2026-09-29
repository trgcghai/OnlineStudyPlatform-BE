import {
  CACHE_INVALIDATE_METADATA,
  CACHE_METADATA,
} from '../redis/redis.constants';
import {
  LessonDetailController,
  LessonsController,
} from './lessons.controller';

describe('LessonsController cache metadata', () => {
  const lessonsHandlerOf = (methodName: keyof LessonsController): object =>
    Object.getOwnPropertyDescriptor(LessonsController.prototype, methodName)!
      .value as object;
  const detailHandlerOf = (methodName: keyof LessonDetailController): object =>
    Object.getOwnPropertyDescriptor(
      LessonDetailController.prototype,
      methodName,
    )!.value as object;

  it('caches instructor lesson reads by current user', () => {
    expect(
      Reflect.getMetadata(CACHE_METADATA, lessonsHandlerOf('listByCourse')),
    ).toEqual({
      namespace: 'instructor:lessons:list',
      ttl: 60,
      scope: 'user',
    });
    expect(
      Reflect.getMetadata(CACHE_METADATA, detailHandlerOf('findOne')),
    ).toEqual({
      namespace: 'instructor:lessons:detail',
      ttl: 60,
      scope: 'user',
    });
  });

  it.each([
    ['create', lessonsHandlerOf('create')],
    ['completeImport', lessonsHandlerOf('completeImport')],
    ['reorder', lessonsHandlerOf('reorder')],
    ['update', detailHandlerOf('update')],
    ['remove', detailHandlerOf('remove')],
  ])('invalidates instructor lesson cache on %s', (_handlerName, handler) => {
    expect(Reflect.getMetadata(CACHE_INVALIDATE_METADATA, handler)).toEqual([
      'courses:public:detail',
      'instructor:courses:detail',
      'instructor:lessons:list',
      'instructor:lessons:detail',
      'learning:course',
      'learning:lesson',
    ]);
  });
});
