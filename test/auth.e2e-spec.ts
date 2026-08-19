import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcryptjs';
import type Redis from 'ioredis';
import request from 'supertest';
import { DataSource, In, Repository } from 'typeorm';

import { AppModule } from './../src/app.module';
import { REFRESH_TOKEN_COOKIE_NAME } from '../src/common/constants/auth.constant';
import { REDIS_CLIENT } from './../src/modules/redis/redis.module';
import {
  User,
  UserRole,
  UserStatus,
} from './../src/modules/users/entities/user.entity';

type AuthBody = {
  success: boolean;
  statusCode: number;
  data: {
    accessToken: string;
    refreshToken?: string;
    user: {
      id: string;
      email: string;
      role: UserRole;
      status: UserStatus;
    };
  };
};

type ErrorBody = {
  success: false;
  statusCode: number;
  data: null;
  error: {
    message: string;
  };
};

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let usersRepository: Repository<User>;
  let redis: Redis;
  let createdUserIds: string[] = [];
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL,
    JWT_REFRESH_TTL: process.env.JWT_REFRESH_TTL,
  };

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = 'AuthE2e#123';
  const users = {
    learner: {
      name: 'E2E Active Learner',
      email: `auth-active-learner-${suffix}@example.com`,
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
    },
    inactiveLearner: {
      name: 'E2E Inactive Learner',
      email: `auth-inactive-learner-${suffix}@example.com`,
      role: UserRole.LEARNER,
      status: UserStatus.INACTIVE,
    },
    admin: {
      name: 'E2E Active Admin',
      email: `auth-active-admin-${suffix}@example.com`,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
    instructor: {
      name: 'E2E Active Instructor',
      email: `auth-active-instructor-${suffix}@example.com`,
      role: UserRole.INSTRUCTOR,
      status: UserStatus.ACTIVE,
    },
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.JWT_ACCESS_TTL = '15m';
    process.env.JWT_REFRESH_TTL = '7d';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    usersRepository = app.get(DataSource).getRepository(User);
    redis = app.get<Redis>(REDIS_CLIENT);
    const hashedPassword = await bcrypt.hash(password, 10);
    const createdUsers = await usersRepository.save(
      Object.values(users).map((user) =>
        usersRepository.create({
          ...user,
          password: hashedPassword,
        }),
      ),
    );
    createdUserIds = createdUsers.map((user) => user.id);
  });

  afterAll(async () => {
    if (redis && createdUserIds.length > 0) {
      for (const userId of createdUserIds) {
        const keys = await redis.keys(`auth:refresh:${userId}:*`);

        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    }

    if (usersRepository) {
      await usersRepository.delete({
        email: In(Object.values(users).map((user) => user.email)),
      });
    }

    if (app) {
      await app.close();
    }

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const getRefreshCookie = (setCookie: string[] | undefined): string => {
    const cookie = setCookie?.find((value) =>
      value.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`),
    );

    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/auth');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=604800');
    expect(cookie).not.toContain('Secure');

    return cookie!.split(';')[0];
  };

  const expectErrorBody = (
    body: ErrorBody,
    statusCode: number,
    message: string,
  ): void => {
    expect(body).toMatchObject({
      success: false,
      statusCode,
      data: null,
      error: {
        message,
      },
    });
  };

  const login = async (
    email: string,
  ): Promise<{ token: string; cookie: string }> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const body = res.body as AuthBody;

    return {
      token: body.data.accessToken,
      cookie: getRefreshCookie(res.headers['set-cookie']),
    };
  };

  it('POST /auth/login succeeds for active Learner and stores refresh token in an HttpOnly cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: users.learner.email, password })
      .expect(200);
    const body = res.body as AuthBody;

    expect(body).toMatchObject({
      success: true,
      statusCode: 200,
      data: {
        user: {
          email: users.learner.email,
          role: UserRole.LEARNER,
          status: UserStatus.ACTIVE,
        },
      },
    });
    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.refreshToken).toBeUndefined();

    getRefreshCookie(res.headers['set-cookie']);
  });

  it('POST /auth/login rejects wrong password with Invalid email or password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: users.learner.email, password: 'wrong-password' })
      .expect(401);

    expectErrorBody(res.body as ErrorBody, 401, 'Invalid email or password');
  });

  it('POST /auth/login rejects inactive account with Account disabled', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: users.inactiveLearner.email, password })
      .expect(403);

    expectErrorBody(res.body as ErrorBody, 403, 'Account disabled');
  });

  it('GET /auth/me without token returns 401', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').expect(401);

    expectErrorBody(res.body as ErrorBody, 401, 'Unauthorized');
  });

  it('GET /auth/me with token returns current user', async () => {
    const { token } = await login(users.learner.email);
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({
      success: true,
      statusCode: 200,
      timestamp: expect.any(String),
      data: {
        email: users.learner.email,
        role: UserRole.LEARNER,
        status: UserStatus.ACTIVE,
      },
    });
    expect(res.body.data).toEqual(expect.any(Object));
  });

  it('POST /auth/refresh returns a new access token from refresh cookie without exposing refreshToken', async () => {
    const { token, cookie } = await login(users.learner.email);
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookie)
      .expect(200);
    const body = res.body as AuthBody;

    expect(body).toMatchObject({
      success: true,
      statusCode: 200,
      timestamp: expect.any(String),
      data: expect.any(Object),
    });
    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.accessToken).not.toBe(token);
    expect(body.data.refreshToken).toBeUndefined();
    const rotatedCookie = getRefreshCookie(res.headers['set-cookie']);
    expect(rotatedCookie).not.toBe(cookie);
  });

  it('POST /auth/logout invalidates refresh session and blacklists current access token', async () => {
    const { token, cookie } = await login(users.learner.email);

    const logoutRes = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(logoutRes.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: {
        loggedOut: true,
      },
    });

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookie)
      .expect(401);
    expectErrorBody(refreshRes.body as ErrorBody, 401, 'Unauthorized');

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expectErrorBody(meRes.body as ErrorBody, 401, 'Unauthorized');
  });

  it('GET /auth/admin allows Admin and rejects Learner', async () => {
    const admin = await login(users.admin.email);
    const learner = await login(users.learner.email);

    const adminRes = await request(app.getHttpServer())
      .get('/auth/admin')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    expect(adminRes.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: {
        role: UserRole.ADMIN,
      },
    });
    const learnerRes = await request(app.getHttpServer())
      .get('/auth/admin')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(403);
    expectErrorBody(learnerRes.body as ErrorBody, 403, 'Forbidden');
  });

  it('GET /auth/instructor allows Instructor and rejects Learner', async () => {
    const instructor = await login(users.instructor.email);
    const learner = await login(users.learner.email);

    const instructorRes = await request(app.getHttpServer())
      .get('/auth/instructor')
      .set('Authorization', `Bearer ${instructor.token}`)
      .expect(200);
    expect(instructorRes.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: {
        role: UserRole.INSTRUCTOR,
      },
    });
    const learnerRes = await request(app.getHttpServer())
      .get('/auth/instructor')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(403);
    expectErrorBody(learnerRes.body as ErrorBody, 403, 'Forbidden');
  });

  it('GET /auth/learner allows Learner and rejects Admin or Instructor', async () => {
    const learner = await login(users.learner.email);
    const admin = await login(users.admin.email);
    const instructor = await login(users.instructor.email);

    const learnerRes = await request(app.getHttpServer())
      .get('/auth/learner')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(200);
    expect(learnerRes.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: {
        role: UserRole.LEARNER,
      },
    });
    const adminRes = await request(app.getHttpServer())
      .get('/auth/learner')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(403);
    expectErrorBody(adminRes.body as ErrorBody, 403, 'Forbidden');
    const instructorRes = await request(app.getHttpServer())
      .get('/auth/learner')
      .set('Authorization', `Bearer ${instructor.token}`)
      .expect(403);
    expectErrorBody(instructorRes.body as ErrorBody, 403, 'Forbidden');
  });
});
