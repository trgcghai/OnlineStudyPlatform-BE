import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { WithdrawRequestStatus } from './entities/withdraw-request.entity';
import { WithdrawController } from './withdraw.controller';
import { WithdrawService } from './withdraw.service';

function getMethodRoles(methodName: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    WithdrawController.prototype,
    methodName,
  );
  const method = descriptor?.value as object | undefined;

  return method ? Reflect.getMetadata(ROLES_KEY, method) : undefined;
}

function getMethodPath(methodName: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    WithdrawController.prototype,
    methodName,
  );
  const method = descriptor?.value as object | undefined;

  return method ? Reflect.getMetadata(PATH_METADATA, method) : undefined;
}

function getMethodVerb(methodName: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    WithdrawController.prototype,
    methodName,
  );
  const method = descriptor?.value as object | undefined;

  return method ? Reflect.getMetadata(METHOD_METADATA, method) : undefined;
}

describe('WithdrawController', () => {
  let controller: WithdrawController;
  let withdrawService: jest.Mocked<WithdrawService>;

  const makeUser = (overrides: Partial<User> = {}): User => ({
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Nguyen Van A',
    email: 'instructor@example.com',
    password: 'hashed-password',
    role: UserRole.INSTRUCTOR,
    status: UserStatus.ACTIVE,
    avatar: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    withdrawService = {
      create: jest.fn(),
      listMine: jest.fn(),
      listAdmin: jest.fn(),
      cancel: jest.fn(),
      reject: jest.fn(),
      process: jest.fn(),
      markProcessed: jest.fn(),
    } as unknown as jest.Mocked<WithdrawService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [WithdrawController],
      providers: [
        { provide: WithdrawService, useValue: withdrawService },
        Reflector,
      ],
    }).compile();

    controller = moduleRef.get(WithdrawController);
  });

  it('uses /withdraw prefix and controller-level auth guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WithdrawController)).toBe(
      'withdraw',
    );
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      WithdrawController,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('defines instructor and admin route metadata', () => {
    expect(getMethodPath('create')).toBe('/');
    expect(getMethodVerb('create')).toBe(RequestMethod.POST);
    expect(getMethodRoles('create')).toEqual([UserRole.INSTRUCTOR]);

    expect(getMethodPath('listMine')).toBe('me');
    expect(getMethodVerb('listMine')).toBe(RequestMethod.GET);
    expect(getMethodRoles('listMine')).toEqual([UserRole.INSTRUCTOR]);

    expect(getMethodPath('listAdmin')).toBe('admin');
    expect(getMethodVerb('listAdmin')).toBe(RequestMethod.GET);
    expect(getMethodRoles('listAdmin')).toEqual([UserRole.ADMIN]);

    expect(getMethodPath('cancel')).toBe(':id/cancel');
    expect(getMethodVerb('cancel')).toBe(RequestMethod.POST);
    expect(getMethodRoles('cancel')).toEqual([UserRole.INSTRUCTOR]);

    expect(getMethodPath('reject')).toBe(':id/reject');
    expect(getMethodVerb('reject')).toBe(RequestMethod.POST);
    expect(getMethodRoles('reject')).toEqual([UserRole.ADMIN]);

    expect(getMethodPath('process')).toBe(':id/process');
    expect(getMethodVerb('process')).toBe(RequestMethod.POST);
    expect(getMethodRoles('process')).toEqual([UserRole.ADMIN]);

    expect(getMethodPath('markProcessed')).toBe(':id/mark-processed');
    expect(getMethodVerb('markProcessed')).toBe(RequestMethod.POST);
    expect(getMethodRoles('markProcessed')).toEqual([UserRole.ADMIN]);
  });

  it('delegates create to the withdraw service with current user and dto', async () => {
    const currentUser = makeUser();
    const dto = { amount: 1500000, note: 'Rut tien' };
    const response = {
      id: '66666666-6666-4666-8666-666666666666',
      instructorId: currentUser.id,
      amount: dto.amount,
      currency: 'VND',
      status: WithdrawRequestStatus.PENDING,
      requestedAt: new Date('2026-09-13T09:00:00.000Z'),
      note: dto.note,
      cancelReason: null,
      cancelledAt: null,
      rejectReason: null,
      rejectedAt: null,
      processingAt: null,
      processedAt: null,
      payoutReference: null,
      payoutDescription: null,
      createdAt: new Date('2026-09-13T09:00:00.000Z'),
      updatedAt: new Date('2026-09-13T09:00:00.000Z'),
    };
    withdrawService.create.mockResolvedValue(response);

    await expect(controller.create(currentUser, dto)).resolves.toBe(response);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(withdrawService.create).toHaveBeenCalledWith(currentUser, dto);
  });

  it('delegates instructor list to the withdraw service', async () => {
    const currentUser = makeUser();
    const query = { page: 1, limit: 10 };
    const response = { items: [], total: 0, page: 1, limit: 10, totalPages: 1 };
    withdrawService.listMine.mockResolvedValue(response);

    await expect(controller.listMine(currentUser, query)).resolves.toBe(
      response,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(withdrawService.listMine).toHaveBeenCalledWith(currentUser, query);
  });

  it('delegates admin list to the withdraw service', async () => {
    const query = {
      page: 1,
      limit: 10,
      status: WithdrawRequestStatus.PENDING,
      amountSort: 'desc' as const,
    };
    const response = { items: [], total: 0, page: 1, limit: 10, totalPages: 1 };
    withdrawService.listAdmin.mockResolvedValue(response);

    await expect(controller.listAdmin(query)).resolves.toBe(response);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(withdrawService.listAdmin).toHaveBeenCalledWith(query);
  });

  it('delegates cancel to the withdraw service with current user, id, and dto', async () => {
    const currentUser = makeUser();
    const requestId = '66666666-6666-4666-8666-666666666666';
    const dto = { reason: 'Doi y' };
    const response = {
      id: requestId,
      instructorId: currentUser.id,
      amount: 1500000,
      currency: 'VND',
      status: WithdrawRequestStatus.CANCELLED,
      requestedAt: new Date('2026-09-13T09:00:00.000Z'),
      note: null,
      cancelReason: dto.reason,
      cancelledAt: new Date('2026-09-13T10:00:00.000Z'),
      rejectReason: null,
      rejectedAt: null,
      processingAt: null,
      processedAt: null,
      payoutReference: null,
      payoutDescription: null,
      createdAt: new Date('2026-09-13T09:00:00.000Z'),
      updatedAt: new Date('2026-09-13T10:00:00.000Z'),
    };
    withdrawService.cancel.mockResolvedValue(response);

    await expect(controller.cancel(currentUser, requestId, dto)).resolves.toBe(
      response,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(withdrawService.cancel).toHaveBeenCalledWith(
      currentUser,
      requestId,
      dto,
    );
  });

  it('delegates reject to the withdraw service with id and dto', async () => {
    const requestId = '66666666-6666-4666-8666-666666666666';
    const dto = { reason: 'Sai thong tin' };
    const response = {
      id: requestId,
      amount: 1500000,
      currency: 'VND',
      status: WithdrawRequestStatus.REJECTED,
      requestedAt: new Date('2026-09-13T09:00:00.000Z'),
      note: null,
      cancelReason: null,
      cancelledAt: null,
      rejectReason: dto.reason,
      rejectedAt: new Date('2026-09-13T10:00:00.000Z'),
      processingAt: null,
      processedAt: null,
      payoutReference: null,
      payoutDescription: null,
      createdAt: new Date('2026-09-13T09:00:00.000Z'),
      updatedAt: new Date('2026-09-13T10:00:00.000Z'),
      instructor: {
        name: 'Nguyen Van A',
        email: 'instructor@example.com',
      },
    };
    withdrawService.reject.mockResolvedValue(response);

    await expect(controller.reject(requestId, dto)).resolves.toBe(response);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(withdrawService.reject).toHaveBeenCalledWith(requestId, dto);
  });

  it('delegates process to the withdraw service with id', async () => {
    const requestId = '66666666-6666-4666-8666-666666666666';
    const response = {
      id: requestId,
      amount: 1500000,
      currency: 'VND',
      status: WithdrawRequestStatus.PROCESSING,
      requestedAt: new Date('2026-09-13T09:00:00.000Z'),
      note: null,
      cancelReason: null,
      cancelledAt: null,
      rejectReason: null,
      rejectedAt: null,
      processingAt: new Date('2026-09-13T10:00:00.000Z'),
      processedAt: null,
      payoutReference: null,
      payoutDescription: 'PAYOUT-WD-66666666',
      createdAt: new Date('2026-09-13T09:00:00.000Z'),
      updatedAt: new Date('2026-09-13T10:00:00.000Z'),
      instructor: {
        name: 'Nguyen Van A',
        email: 'instructor@example.com',
      },
      qrImageUrl: 'https://vietqr.app/img?acc=123456789',
      payoutAccount: {
        bankName: 'VCB',
        bankCode: 'VCB',
        bankAccountNumber: '123456789',
        accountHolderName: 'NGUYEN VAN A',
      },
    };
    withdrawService.process.mockResolvedValue(response);

    await expect(controller.process(requestId)).resolves.toBe(response);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(withdrawService.process).toHaveBeenCalledWith(requestId);
  });

  it('delegates markProcessed to the withdraw service with id and dto', async () => {
    const requestId = '66666666-6666-4666-8666-666666666666';
    const dto = { payoutReference: 'FT123456' };
    const response = {
      id: requestId,
      amount: 1500000,
      currency: 'VND',
      status: WithdrawRequestStatus.PROCESSED,
      requestedAt: new Date('2026-09-13T09:00:00.000Z'),
      note: null,
      cancelReason: null,
      cancelledAt: null,
      rejectReason: null,
      rejectedAt: null,
      processingAt: new Date('2026-09-13T10:00:00.000Z'),
      processedAt: new Date('2026-09-13T11:00:00.000Z'),
      payoutReference: 'FT123456',
      payoutDescription: 'PAYOUT-WD-66666666',
      createdAt: new Date('2026-09-13T09:00:00.000Z'),
      updatedAt: new Date('2026-09-13T11:00:00.000Z'),
      instructor: {
        name: 'Nguyen Van A',
        email: 'instructor@example.com',
      },
    };
    withdrawService.markProcessed.mockResolvedValue(response);

    await expect(controller.markProcessed(requestId, dto)).resolves.toBe(
      response,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(withdrawService.markProcessed).toHaveBeenCalledWith(requestId, dto);
  });
});
