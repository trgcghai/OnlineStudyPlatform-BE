import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from './../src/app.module';
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
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
      .send({
        name: 'Nguyen Van A',
        email: `  ${email.toUpperCase()}  `,
        password: 'abcd1234!',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      success: true,
      data: {
        name: 'Nguyen Van A',
        email,
        role: 'Learner',
        status: 'Active',
        avatar: null,
      },
    });
    expect(res.body.data).toMatchObject({
      name: 'Nguyen Van A',
      email,
      role: 'Learner',
      status: 'Active',
      avatar: null,
    });
    expect(res.body.data.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.body.data.password).toBeUndefined();

    const row = await dataSource.getRepository(User).findOneByOrFail({ email });
    expect(row.password).not.toBe('abcd1234!');
    expect(row.password).toMatch(/^\$2[ab]\$\d+\$/);
  });

  it('rejects a duplicate email with 409 "Email already registered"', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Another User', email, password: 'xyz98765#' })
      .expect(409);

    expect(res.body.error.message).toBe('Email already registered');
  });

  it('rejects an invalid email with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({
        name: 'Nguyen Van A',
        email: 'not-an-email',
        password: 'abcd1234!',
      })
      .expect(400);

    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('rejects a weak password with 400 and the policy message', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Nguyen Van A', email: `weak-${email}`, password: 'abc12' })
      .expect(400);

    expect(JSON.stringify(res.body.error.details)).toContain(
      'Password must be at least 8 characters and include letters, numbers and a special character',
    );
  });

  it('rejects unknown fields with 400 (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .send({
        name: 'Nguyen Van A',
        email: `extra-${email}`,
        password: 'abcd1234!',
        phone: '123',
      })
      .expect(400);

    expect(JSON.stringify(res.body.error.details)).toContain('phone');
  });
});
