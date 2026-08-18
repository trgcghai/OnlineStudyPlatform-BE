import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET) reports UP with reachable postgres, redis, mongodb and minio', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const body = res.body as {
      success: boolean;
      statusCode: number;
      data: {
        components: Record<string, { status: string }>;
      };
    };

    expect(body.success).toBe(true);
    expect(body.statusCode).toBe(200);
    expect(body.data.components.application.status).toBe('UP');
    expect(body.data.components.postgresql.status).toBe('UP');
    expect(body.data.components.redis.status).toBe('UP');
    expect(body.data.components.mongodb.status).toBe('UP');
    expect(body.data.components.minio.status).toBe('UP');
  });
});
