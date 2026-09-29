import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Client as MinioClient } from 'minio';
import { DataSource, In } from 'typeorm';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { User } from './../src/modules/users/entities/user.entity';
import { MINIO_CLIENT } from '../src/common/constants/file.constant';
import { App } from 'supertest/types';

type ErrorBody = {
  success: false;
  statusCode: number;
  data: null;
  error: {
    message: string;
    details: string[];
  };
};

type UserBody = {
  success: boolean;
  statusCode: number;
  data: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    avatar: string | null;
    password?: string;
  };
};

describe('Users (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const email = `e2e-register-${Date.now()}@example.com`;

  const profileUser = {
    name: 'E2E Profile User',
    email: `e2e-profile-${Date.now()}@example.com`,
    password: 'Profile@123',
  };
  const otherUser = {
    name: 'E2E Profile Other',
    email: `e2e-profile-other-${Date.now()}@example.com`,
    password: 'Other@1234',
  };
  let profileUserId = '';
  // The profile tests mutate the account (password change);
  // track the current credentials so later logins keep working.
  const currentProfileEmail = profileUser.email;
  let currentProfilePassword = profileUser.password;

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
    await dataSource.getRepository(User).delete({
      email: In([profileUser.email, otherUser.email]),
    });

    if (app) {
      await app.close();
    }
  });

  const loginAndGetToken = async (
    userEmail: string,
    password: string,
  ): Promise<string> => {
    const res = await request(app.getHttpServer() as App)
      .post('/auth/login')
      .send({ email: userEmail, password })
      .expect(200);

    return (res.body as { data: { accessToken: string } }).data.accessToken;
  };

  it('creates a Learner with status Active and never returns the password', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/users')
      .send({
        name: 'Nguyen Van A',
        email: `  ${email.toUpperCase()}  `,
        password: 'abcd1234!',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      success: true,
      statusCode: 201,
      data: {
        name: 'Nguyen Van A',
        email,
        role: 'Learner',
        status: 'Active',
        avatar: null,
      },
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
    const res = await request(app.getHttpServer() as App)
      .post('/users')
      .send({ name: 'Another User', email, password: 'xyz98765#' })
      .expect(409);

    expect(res.body.error.message).toBe('Email already registered');
    expect(res.body.statusCode).toBe(409);
  });

  it('rejects an invalid email with 400', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/users')
      .send({
        name: 'Nguyen Van A',
        email: 'not-an-email',
        password: 'abcd1234!',
      })
      .expect(400);

    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.statusCode).toBe(400);
  });

  it('rejects a weak password with 400 and the policy message', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/users')
      .send({ name: 'Nguyen Van A', email: `weak-${email}`, password: 'abc12' })
      .expect(400);

    expect(JSON.stringify(res.body.error.details)).toContain(
      'Password must be at least 8 characters and include letters, numbers and a special character',
    );
    expect(res.body.statusCode).toBe(400);
  });

  it('rejects unknown fields with 400 (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/users')
      .send({
        name: 'Nguyen Van A',
        email: `extra-${email}`,
        password: 'abcd1234!',
        phone: '123',
      })
      .expect(400);

    expect(JSON.stringify(res.body.error.details)).toContain('phone');
    expect(res.body.statusCode).toBe(400);
  });

  describe('profile management (T0-07)', () => {
    beforeAll(async () => {
      const created = await request(app.getHttpServer() as App)
        .post('/users')
        .send(profileUser)
        .expect(201);
      profileUserId = (created.body as UserBody).data.id;

      await request(app.getHttpServer() as App)
        .post('/users')
        .send(otherUser)
        .expect(201);
    });

    it('GET /users/me without token returns 401', async () => {
      const res = await request(app.getHttpServer() as App)
        .get('/users/me')
        .expect(401);

      expect((res.body as ErrorBody).error.message).toBe('Unauthorized');
    });

    it('GET /users/me with token returns the full profile without the password hash', async () => {
      const token = await loginAndGetToken(
        currentProfileEmail,
        currentProfilePassword,
      );
      const res = await request(app.getHttpServer() as App)
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as UserBody;
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        id: profileUserId,
        name: profileUser.name,
        email: profileUser.email,
        role: 'Learner',
        status: 'Active',
        avatar: null,
      });
      expect(body.data.password).toBeUndefined();
    });

    it('PATCH /users/me updates the name and keeps the email unchanged', async () => {
      const token = await loginAndGetToken(
        currentProfileEmail,
        currentProfilePassword,
      );
      const newName = 'E2E Renamed User';

      const res = await request(app.getHttpServer() as App)
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `  ${newName}  ` })
        .expect(200);

      expect(res.body).toMatchObject({
        success: true,
        statusCode: 200,
        data: { id: profileUserId, name: newName, email: profileUser.email },
      });
      expect(res.body.data.password).toBeUndefined();

      const meRes = await request(app.getHttpServer() as App)
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(meRes.body.data).toMatchObject({
        name: newName,
        email: profileUser.email,
      });
    });

    it('PATCH /users/me rejects an email change with 400 (email is immutable)', async () => {
      const token = await loginAndGetToken(
        currentProfileEmail,
        currentProfilePassword,
      );

      const res = await request(app.getHttpServer() as App)
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'E2E Renamed User', email: otherUser.email })
        .expect(400);

      expect((res.body as ErrorBody).error.details).toEqual(
        expect.arrayContaining([
          expect.stringContaining('email should not exist'),
        ]),
      );

      const meRes = await request(app.getHttpServer() as App)
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(meRes.body.data.email).toBe(profileUser.email);
    });

    it('PATCH /users/me/password rejects a wrong current password and keeps the old one working', async () => {
      const token = await loginAndGetToken(
        currentProfileEmail,
        currentProfilePassword,
      );

      const res = await request(app.getHttpServer() as App)
        .patch('/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'WrongPass@1', newPassword: 'Changed@456' })
        .expect(400);

      expect((res.body as ErrorBody).error.message).toBe(
        'Current password is incorrect',
      );

      // Old password must still be valid.
      await loginAndGetToken(currentProfileEmail, currentProfilePassword);
    });

    it('PATCH /users/me/password rejects a weak new password with the policy message', async () => {
      const token = await loginAndGetToken(
        currentProfileEmail,
        currentProfilePassword,
      );

      const res = await request(app.getHttpServer() as App)
        .patch('/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: currentProfilePassword, newPassword: 'weak' })
        .expect(400);

      expect(JSON.stringify((res.body as ErrorBody).error.details)).toContain(
        'Password must be at least 8 characters and include letters, numbers and a special character',
      );
    });

    it('PATCH /users/me/password changes the password on success', async () => {
      const token = await loginAndGetToken(
        currentProfileEmail,
        currentProfilePassword,
      );
      const newPassword = 'Changed@456';

      const res = await request(app.getHttpServer() as App)
        .patch('/users/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: currentProfilePassword, newPassword })
        .expect(200);

      expect(res.body).toMatchObject({
        success: true,
        statusCode: 200,
        data: { passwordChanged: true },
      });

      // Old password rejected...
      await request(app.getHttpServer() as App)
        .post('/auth/login')
        .send({ email: currentProfileEmail, password: currentProfilePassword })
        .expect(401);

      // ...and the new one accepted.
      await loginAndGetToken(currentProfileEmail, newPassword);

      currentProfilePassword = newPassword;
    });

    it('POST /users/me/avatar rejects a missing file with 400', async () => {
      const token = await loginAndGetToken(
        currentProfileEmail,
        currentProfilePassword,
      );

      const res = await request(app.getHttpServer() as App)
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect((res.body as ErrorBody).error.message).toBe(
        'Avatar image is required',
      );
    });

    it('POST /users/me/avatar rejects a non-image file with 400', async () => {
      const token = await loginAndGetToken(
        currentProfileEmail,
        currentProfilePassword,
      );

      const res = await request(app.getHttpServer() as App)
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('avatar', Buffer.from('not an image'), {
          filename: 'notes.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      expect((res.body as ErrorBody).error.message).toContain('Avatar');
    });

    it('POST /users/me/avatar stores the image in MinIO and returns the public URL', async () => {
      const token = await loginAndGetToken(
        currentProfileEmail,
        currentProfilePassword,
      );
      // 1x1 transparent PNG.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      );

      const res = await request(app.getHttpServer() as App)
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('avatar', png, {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(200);

      const body = res.body as UserBody;
      expect(body.data.avatar).toEqual(expect.stringContaining('/avatars/'));
      expect(body.data.avatar).toMatch(/^http:\/\/.+\/avatars\/.+\.png$/);

      const meRes = await request(app.getHttpServer() as App)
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(meRes.body.data.avatar).toBe(body.data.avatar);

      // Best-effort cleanup of the uploaded object.
      const avatarUrl = body.data.avatar as string;
      const key = avatarUrl.split(`/avatars/`)[1];
      if (key) {
        try {
          const configService = app.get(ConfigService);
          const minioClient = app.get<MinioClient>(MINIO_CLIENT);
          await minioClient.removeObject(
            configService.getOrThrow<string>('MINIO_BUCKET'),
            `avatars/${key}`,
          );
        } catch {
          // ignore cleanup failures
        }
      }
    });

    it('POST /users/me/avatar rejects files larger than 5MB with 400', async () => {
      const token = await loginAndGetToken(
        currentProfileEmail,
        currentProfilePassword,
      );
      const bigPng = Buffer.concat([
        Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
        Buffer.alloc(6 * 1024 * 1024, 0),
      ]);

      const res = await request(app.getHttpServer() as App)
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('avatar', bigPng, {
          filename: 'big.png',
          contentType: 'image/png',
        })
        .expect(413);

      // Nest maps multer's LIMIT_FILE_SIZE to 413 Payload Too Large,
      // keeping multer's "File too large" message.
      expect((res.body as ErrorBody).error.message).toBe('File too large');
    });
  });
});
