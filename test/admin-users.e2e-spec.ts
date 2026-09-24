import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcryptjs';
import type Redis from 'ioredis';
import request from 'supertest';
import { DataSource, In, Repository } from 'typeorm';

import { AppModule } from './../src/app.module';
import { REDIS_CLIENT } from './../src/modules/redis/redis.module';
import {
  User,
  UserRole,
  UserStatus,
} from './../src/modules/users/entities/user.entity';
import { App } from 'supertest/types';

type UserBody = {
  success: boolean;
  statusCode: number;
  data: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    avatar: string | null;
    password?: string;
  };
};

type ListBody = {
  success: boolean;
  data: {
    items: UserBody['data'][];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

describe('Admin user management (e2e)', () => {
  let app: INestApplication;
  let usersRepository: Repository<User>;
  let redis: Redis;
  let createdUserIds: string[] = [];
  const createdViaApi: { id?: string; email: string }[] = [];

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = 'AdminE2e#123';

  const users = {
    admin: {
      name: 'E2E Admin Manager',
      email: `admin-mgmt-admin-${suffix}@example.com`,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
    instructor: {
      name: 'E2E Instructor Existing',
      email: `admin-mgmt-instructor-${suffix}@example.com`,
      role: UserRole.INSTRUCTOR,
      status: UserStatus.ACTIVE,
    },
    learner: {
      name: 'E2E Learner ToDisable',
      email: `admin-mgmt-learner-${suffix}@example.com`,
      role: UserRole.LEARNER,
      status: UserStatus.ACTIVE,
    },
    otherLearner: {
      name: 'E2E Other Learner',
      email: `admin-mgmt-other-learner-${suffix}@example.com`,
      role: UserRole.LEARNER,
      status: UserStatus.INACTIVE,
    },
  };

  beforeAll(async () => {
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
        usersRepository.create({ ...user, password: hashedPassword }),
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

    for (const created of createdViaApi) {
      const existing = await usersRepository.findOneBy({
        email: created.email,
      });

      if (existing) {
        await usersRepository.delete(existing.id);
      }
    }

    if (app) {
      await app.close();
    }
  });

  const login = async (userEmail: string): Promise<string> => {
    const res = await request(app.getHttpServer() as App)
      .post('/auth/login')
      .send({ email: userEmail, password })
      .expect(200);

    return (res.body as { data: { accessToken: string } }).data.accessToken;
  };

  describe('RBAC', () => {
    it('rejects anonymous access with 401', async () => {
      const res = await request(app.getHttpServer() as App)
        .get('/users/admin')
        .expect(401);

      expect(res.body.error.message).toBe('Unauthorized');
    });

    it.each([users.learner, users.instructor])(
      'denies non-admin $role access with 403',
      async (account) => {
        const token = await login(account.email);

        const res = await request(app.getHttpServer() as App)
          .get('/users/admin')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);

        expect(res.body.error.message).toBe('Forbidden');
      },
    );

    it('allows the Admin to list users', async () => {
      const token = await login(users.admin.email);

      const res = await request(app.getHttpServer() as App)
        .get('/users/admin')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as ListBody;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.items)).toBe(true);
      expect(body.data.items.length).toBeGreaterThanOrEqual(3);
      // Admin accounts themselves are out of scope of this console.
      expect(body.data.items.some((item) => item.role === UserRole.ADMIN)).toBe(
        false,
      );
    });
  });

  describe('list filters', () => {
    it('filters by role=Instructor and only returns instructors', async () => {
      const token = await login(users.admin.email);

      const res = await request(app.getHttpServer() as App)
        .get('/users/admin?role=Instructor')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as ListBody;
      expect(body.data.total).toBeGreaterThanOrEqual(1);
      for (const item of body.data.items) {
        expect(item.role).toBe(UserRole.INSTRUCTOR);
      }
    });

    it('filters by status=Inactive', async () => {
      const token = await login(users.admin.email);

      const res = await request(app.getHttpServer() as App)
        .get('/users/admin?status=Inactive')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as ListBody;
      expect(
        body.data.items.some((item) => item.email === users.otherLearner.email),
      ).toBe(true);
      for (const item of body.data.items) {
        expect(item.status).toBe(UserStatus.INACTIVE);
      }
    });

    it('searches by name/email substring', async () => {
      const token = await login(users.admin.email);

      const res = await request(app.getHttpServer() as App)
        .get(`/users/admin?q=${encodeURIComponent(users.learner.name)}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as ListBody;
      expect(body.data.items.map((item) => item.email)).toEqual([
        users.learner.email,
      ]);
    });

    it('rejects an invalid role filter with 400', async () => {
      const token = await login(users.admin.email);

      const res = await request(app.getHttpServer() as App)
        .get('/users/admin?role=Admin')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe('create / edit / disable', () => {
    let adminToken: string;

    beforeAll(async () => {
      adminToken = await login(users.admin.email);
    });

    it('creates an Instructor account (Phase 1 seeding path)', async () => {
      const email = `admin-mgmt-created-instructor-${suffix}@example.com`;
      createdViaApi.push({ email });

      const res = await request(app.getHttpServer() as App)
        .post('/users/admin')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'E2E Created Instructor',
          email: `  ${email.toUpperCase()}  `,
          password: password,
          role: UserRole.INSTRUCTOR,
        })
        .expect(201);

      const body = res.body as UserBody;
      expect(body.data).toMatchObject({
        name: 'E2E Created Instructor',
        email,
        role: UserRole.INSTRUCTOR,
        status: UserStatus.ACTIVE,
      });
      expect(body.data.password).toBeUndefined();
      createdViaApi[0].id = body.data.id;

      const row = await usersRepository.findOneByOrFail({ email });
      expect(row.password).toMatch(/^\$2[ab]\$\d+\$/);
    });

    it('refuses to create an Admin account via the admin endpoint', async () => {
      const res = await request(app.getHttpServer() as App)
        .post('/users/admin')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Escalated Admin',
          email: `admin-mgmt-escalation-${suffix}@example.com`,
          password,
          role: UserRole.ADMIN,
        })
        .expect(400);

      expect(JSON.stringify(res.body.error.details)).toContain('role');
    });

    it('rejects duplicate email creation with 409', async () => {
      const res = await request(app.getHttpServer() as App)
        .post('/users/admin')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Duplicate Instructor',
          email: users.instructor.email,
          password,
          role: UserRole.INSTRUCTOR,
        })
        .expect(409);

      expect(res.body.error.message).toBe('Email already registered');
    });

    it('edits name, role and resets password of an account', async () => {
      const email = `admin-mgmt-edit-learner-${suffix}@example.com`;
      createdViaApi.push({ email });

      const created = await request(app.getHttpServer() as App)
        .post('/users/admin')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'E2E Edit Learner',
          email,
          password,
          role: UserRole.LEARNER,
        })
        .expect(201);

      const userId = (created.body as UserBody).data.id;
      createdViaApi[1].id = userId;

      const res = await request(app.getHttpServer() as App)
        .patch(`/users/admin/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'E2E Promoted Instructor',
          role: UserRole.INSTRUCTOR,
          password: 'ResetPass@123',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        success: true,
        data: {
          id: userId,
          name: 'E2E Promoted Instructor',
          role: UserRole.INSTRUCTOR,
          status: UserStatus.ACTIVE,
        },
      });

      const loginRes = await request(app.getHttpServer() as App)
        .post('/auth/login')
        .send({ email, password: 'ResetPass@123' })
        .expect(200);
      expect(loginRes.body.data.user.role).toBe(UserRole.INSTRUCTOR);
    });

    it('rejects an update with no changes and unknown fields', async () => {
      const userId = createdViaApi[1].id as string;

      await request(app.getHttpServer() as App)
        .patch(`/users/admin/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);

      const res = await request(app.getHttpServer() as App)
        .patch(`/users/admin/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nickname: 'x' })
        .expect(400);
      expect(JSON.stringify(res.body.error.details)).toContain('nickname');
    });

    it('returns 404 when editing a missing user', async () => {
      await request(app.getHttpServer() as App)
        .patch('/users/admin/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Nobody' })
        .expect(404);
    });

    it('disabling an account makes its next login fail with Account disabled (US-010 scenario)', async () => {
      const learnerToken = await login(users.learner.email);
      expect(learnerToken).toEqual(expect.any(String));

      const learner = await usersRepository.findOneByOrFail({
        email: users.learner.email,
      });

      const res = await request(app.getHttpServer() as App)
        .patch(`/users/admin/${learner.id}/disable`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.status).toBe(UserStatus.INACTIVE);

      const loginRes = await request(app.getHttpServer() as App)
        .post('/auth/login')
        .send({ email: users.learner.email, password })
        .expect(403);

      expect(loginRes.body.error.message).toBe('Account disabled');

      // Even the previously issued access token no longer authenticates.
      await request(app.getHttpServer() as App)
        .get('/auth/me')
        .set('Authorization', `Bearer ${learnerToken}`)
        .expect(403);
    });

    it('is idempotent when disabling twice', async () => {
      const learner = await usersRepository.findOneByOrFail({
        email: users.learner.email,
      });

      const res = await request(app.getHttpServer() as App)
        .patch(`/users/admin/${learner.id}/disable`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.status).toBe(UserStatus.INACTIVE);
    });

    it('returns 404 when disabling a missing user', async () => {
      await request(app.getHttpServer() as App)
        .patch('/users/admin/00000000-0000-4000-8000-000000000001/disable')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
