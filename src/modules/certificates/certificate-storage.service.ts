import {
  Inject,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { MINIO_CLIENT } from '../../common/constants/file.constant';

@Injectable()
export class CertificateStorageService implements OnModuleInit {
  private readonly bucket: string;

  constructor(
    @Inject(MINIO_CLIENT) private readonly client: Client,
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
    if (!(await this.client.bucketExists(this.bucket)))
      await this.client.makeBucket(this.bucket, 'us-east-1');
    await this.client.setBucketPolicy(this.bucket, '');
  }

  async upload(objectKey: string, pdf: Buffer): Promise<void> {
    await this.client.putObject(this.bucket, objectKey, pdf, pdf.length, {
      'Content-Type': 'application/pdf',
    });
  }

  async download(objectKey: string) {
    try {
      return await this.client.getObject(this.bucket, objectKey);
    } catch (error) {
      throw new ServiceUnavailableException(
        'Chưa thể tải chứng chỉ. Vui lòng thử lại sau.',
        { cause: error },
      );
    }
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey);
  }
}
