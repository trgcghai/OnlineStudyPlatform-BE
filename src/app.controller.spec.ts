import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { AppController } from './app.controller';

describe('AppController rate limiting', () => {
  const handlerOf = (methodName: keyof AppController): object =>
    Object.getOwnPropertyDescriptor(AppController.prototype, methodName)!
      .value as object;

  it('skips throttling for health checks', () => {
    expect(
      Reflect.getMetadata(`${THROTTLER_SKIP}default`, handlerOf('getHealth')),
    ).toBe(true);
  });
});
