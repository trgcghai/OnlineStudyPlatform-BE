import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

export class ConfiguredSocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly allowedOrigins: readonly string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Record<string, unknown>): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.allowedOrigins,
        credentials: true,
        allowedHeaders: ['Authorization', 'Content-Type'],
      },
    });
  }
}
