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

  it('/health (GET) reports UP with reachable postgres, redis and mongodb', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const body = res.body as {
      components: Record<string, { status: string }>;
    };

    expect(body.components.application.status).toBe('UP');
    expect(body.components.postgresql.status).toBe('UP');
    expect(body.components.redis.status).toBe('UP');
    expect(body.components.mongodb.status).toBe('UP');
    expect(body.components.minio.status).toBe('developing');
  });
});
