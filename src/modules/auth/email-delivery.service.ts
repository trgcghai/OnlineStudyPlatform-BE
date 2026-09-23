import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

export interface EmailDeliveryResult {
  delivered: boolean;
}

@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendVerificationOtp(
    email: string,
    otp: string,
  ): Promise<EmailDeliveryResult> {
    return this.sendOtpEmail({
      email,
      otp,
      subject: 'Verify your Online Study Platform account',
      text: `Your verification code is ${otp}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`,
      logLabel: 'verification',
    });
  }

  async sendPasswordResetOtp(
    email: string,
    otp: string,
  ): Promise<EmailDeliveryResult> {
    return this.sendOtpEmail({
      email,
      otp,
      subject: 'Reset your Online Study Platform password',
      text: `Your password reset code is ${otp}. It expires in 10 minutes.`,
      html: `<p>Your password reset code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`,
      logLabel: 'password reset',
    });
  }

  private async sendOtpEmail(options: {
    email: string;
    otp: string;
    subject: string;
    text: string;
    html: string;
    logLabel: string;
  }): Promise<EmailDeliveryResult> {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = this.configService.get<string>('SMTP_PORT');
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    const smtpFrom = this.configService.get<string>('SMTP_FROM');
    const smtpSecure = this.configService.get<string>('SMTP_SECURE') === 'true';

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !smtpFrom) {
      return { delivered: false };
    }

    const port = Number(smtpPort);

    if (!Number.isInteger(port) || port <= 0) {
      throw new ServiceUnavailableException('Email delivery is unavailable');
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    try {
      const info = (await transporter.sendMail({
        from: smtpFrom,
        to: options.email,
        subject: options.subject,
        text: options.text,
        html: options.html,
      })) as unknown;

      if (!this.isRecipientAccepted(info, options.email)) {
        throw new ServiceUnavailableException('Email delivery is unavailable');
      }

      this.logger.log(
        `SMTP ${options.logLabel} email accepted: ${this.formatDeliveryInfo(info)}`,
      );
    } catch (error) {
      this.logger.warn(
        `SMTP ${options.logLabel} email delivery failed: ${this.formatSmtpError(error)}`,
      );
      throw new ServiceUnavailableException('Email delivery is unavailable');
    }

    return { delivered: true };
  }

  private isRecipientAccepted(info: unknown, email: string): boolean {
    if (!info || typeof info !== 'object') {
      return true;
    }

    const deliveryInfo = info as {
      accepted?: unknown[];
      rejected?: unknown[];
    };
    const normalizedEmail = email.trim().toLowerCase();
    const accepted = this.normalizeRecipientList(deliveryInfo.accepted);
    const rejected = this.normalizeRecipientList(deliveryInfo.rejected);

    if (rejected.includes(normalizedEmail)) {
      return false;
    }

    return accepted.length === 0 || accepted.includes(normalizedEmail);
  }

  private normalizeRecipientList(recipients: unknown): string[] {
    if (!Array.isArray(recipients)) {
      return [];
    }

    return recipients
      .map((recipient) => {
        if (typeof recipient === 'string') {
          return recipient.trim().toLowerCase();
        }

        if (
          recipient &&
          typeof recipient === 'object' &&
          'address' in recipient &&
          typeof recipient.address === 'string'
        ) {
          return recipient.address.trim().toLowerCase();
        }

        return null;
      })
      .filter((recipient): recipient is string => Boolean(recipient));
  }

  private formatSmtpError(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return 'unknown error';
    }

    const smtpError = error as {
      code?: unknown;
      command?: unknown;
      responseCode?: unknown;
      message?: unknown;
    };
    const parts = [
      typeof smtpError.code === 'string' ? `code=${smtpError.code}` : null,
      typeof smtpError.command === 'string'
        ? `command=${smtpError.command}`
        : null,
      typeof smtpError.responseCode === 'number'
        ? `responseCode=${smtpError.responseCode}`
        : null,
      typeof smtpError.message === 'string'
        ? `message=${smtpError.message}`
        : null,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(' ') : 'unknown error';
  }

  private formatDeliveryInfo(info: unknown): string {
    if (!info || typeof info !== 'object') {
      return 'accepted=unknown rejected=unknown';
    }

    const deliveryInfo = info as {
      messageId?: unknown;
      accepted?: unknown;
      rejected?: unknown;
    };
    const messageId =
      typeof deliveryInfo.messageId === 'string'
        ? deliveryInfo.messageId
        : 'unknown';
    const accepted = this.normalizeRecipientList(deliveryInfo.accepted).join(
      ',',
    );
    const rejected = this.normalizeRecipientList(deliveryInfo.rejected).join(
      ',',
    );

    return `messageId=${messageId} accepted=${accepted || 'none'} rejected=${rejected || 'none'}`;
  }
}
