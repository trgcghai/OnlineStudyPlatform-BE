import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/common/configure-app';
import { User } from './../src/modules/users/entities/user.entity';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const email = `e2e-register-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await dataSource.getRepository(User).delete({ email });
    await app.close();
  });

  it('creates a Learner with status Active and never returns the password', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Nguyen Van A', email, password: 'abcd1234!' })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'Nguyen Van A',
      email,
      role: 'Learner',
      status: 'Active',
      avatar: null,
    });
    expect(res.body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.body.password).toBeUndefined();

    const row = await dataSource
      .getRepository(User)
      .findOneByOrFail({ email });
    expect(row.password).not.toBe('abcd1234!');
    expect(row.password).toMatch(/^\$2[ab]\$\d+\$/);
  });

  it('rejects a duplicate email with 409 "Email already registered"', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Another User', email, password: 'xyz98765#' })
      .expect(409);

    expect(res.body.message).toBe('Email already registered');
  });

  it('rejects an invalid email with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Nguyen Van A', email: 'not-an-email', password: 'abcd1234!' })
      .expect(400);

    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it('rejects a weak password with 400 and the policy message', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Nguyen Van A', email: `weak-${email}`, password: 'abc12' })
      .expect(400);

    expect(JSON.stringify(res.body.message)).toContain(
      'Password must be at least 8 characters and include letters, numbers and a special character',
    );
  });

  it('rejects unknown fields with 400 (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Nguyen Van A', email: `extra-${email}`, password: 'abcd1234!', phone: '123' })
      .expect(400);

    expect(JSON.stringify(res.body.message)).toContain('phone');
  });
});
