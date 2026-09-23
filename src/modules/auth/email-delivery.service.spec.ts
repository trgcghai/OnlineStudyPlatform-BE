import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { EmailDeliveryService } from './email-delivery.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

describe('EmailDeliveryService', () => {
  let service: EmailDeliveryService;
  let configService: { get: jest.Mock };
  let sendMail: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    const env: Record<string, string> = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'mailer@example.com',
      SMTP_PASS: 'secret',
      SMTP_FROM: 'Online Study <mailer@example.com>',
    };
    configService = {
      get: jest.fn((key: string) => env[key]),
    };
    sendMail = jest.fn().mockResolvedValue({
      messageId: 'message-id',
      accepted: ['learner@example.com'],
      rejected: [],
    });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    service = new EmailDeliveryService(
      configService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sends verification OTP through SMTP configuration', async () => {
    await expect(
      service.sendVerificationOtp('learner@example.com', '123456'),
    ).resolves.toEqual({ delivered: true });

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: {
        user: 'mailer@example.com',
        pass: 'secret',
      },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Online Study <mailer@example.com>',
        to: 'learner@example.com',
        subject: 'Verify your Online Study Platform account',
      }),
    );
  });

  it('reports unavailable when SMTP configuration is incomplete', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'SMTP_PASS' ? undefined : 'value',
    );

    await expect(
      service.sendVerificationOtp('learner@example.com', '123456'),
    ).resolves.toEqual({ delivered: false });
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('wraps SMTP send failures as service unavailable', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.sendVerificationOtp('learner@example.com', '123456'),
    ).rejects.toEqual(
      new ServiceUnavailableException('Email delivery is unavailable'),
    );
  });

  it('rejects delivery when SMTP rejects the recipient', async () => {
    sendMail.mockResolvedValue({
      messageId: 'message-id',
      accepted: [],
      rejected: ['learner@example.com'],
    });

    await expect(
      service.sendVerificationOtp('learner@example.com', '123456'),
    ).rejects.toEqual(
      new ServiceUnavailableException('Email delivery is unavailable'),
    );
  });
});
