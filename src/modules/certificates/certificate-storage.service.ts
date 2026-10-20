import {
  Inject,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { MINIO_S3_CLIENT } from '../../common/constants/file.constant';

@Injectable()
export class CertificateStorageService implements OnModuleInit {
  private readonly bucket: string;

  constructor(
    @Inject(MINIO_S3_CLIENT) private readonly client: S3Client,
    config: ConfigService,
  ) {
    const publicBucket = config.getOrThrow<string>('MINIO_BUCKET');
    this.bucket =
      config.get<string>('CERTIFICATES_BUCKET') ||
      `${publicBucket}-certificates`;
    if (this.bucket === publicBucket)
      throw new Error('Certificates require a separate private MinIO bucket');
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const candidate = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        candidate.$metadata?.httpStatusCode !== 404 &&
        candidate.name !== 'NotFound' &&
        candidate.name !== 'NoSuchBucket'
      ) {
        throw error;
      }
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
    // A bucket without a policy is private. Remove any stale policy left by a
    // previous configuration that may have made this bucket public.
    await this.client.send(
      new DeleteBucketPolicyCommand({ Bucket: this.bucket }),
    );
  }

  async upload(objectKey: string, pdf: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: pdf,
        ContentLength: pdf.length,
        ContentType: 'application/pdf',
      }),
    );
  }

  async download(objectKey: string) {
    try {
      const { Body } = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      if (!Body) throw new Error('Certificate object has no response body');
      return Body as Readable;
    } catch (error) {
      throw new ServiceUnavailableException(
        'Chưa thể tải chứng chỉ. Vui lòng thử lại sau.',
        { cause: error },
      );
    }
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }
}
