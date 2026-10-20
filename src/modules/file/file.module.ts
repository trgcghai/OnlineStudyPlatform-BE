import { Global, Module, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  MINIO_PUBLIC_S3_CLIENT,
  MINIO_S3_CLIENT,
} from '../../common/constants/file.constant';
import { ExcelService } from './excel.service';
import { ZipService } from './zip.service';

function createS3Client(configService: ConfigService, endpoint: string) {
  return new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: configService.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretAccessKey: configService.getOrThrow<string>('MINIO_SECRET_KEY'),
    },
  });
}

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [],
  providers: [
    ExcelService,
    ZipService,
    {
      provide: MINIO_S3_CLIENT,
      useFactory: (configService: ConfigService) =>
        createS3Client(
          configService,
          configService.getOrThrow<string>('MINIO_ENDPOINT'),
        ),
      inject: [ConfigService],
    },
    {
      provide: MINIO_PUBLIC_S3_CLIENT,
      useFactory: (configService: ConfigService) =>
        createS3Client(
          configService,
          configService.get<string>('MINIO_PUBLIC_ENDPOINT') ??
            configService.getOrThrow<string>('MINIO_ENDPOINT'),
        ),
      inject: [ConfigService],
    },
  ],
  exports: [ExcelService, ZipService, MINIO_S3_CLIENT, MINIO_PUBLIC_S3_CLIENT],
})
export class FileModule implements OnModuleInit {
  private readonly logger = new Logger(FileModule.name);

  constructor(
    @Inject(MINIO_S3_CLIENT) private readonly s3Client: S3Client,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');

    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
      this.logger.log(`Minio bucket "${bucket}" found`);
    } catch (error) {
      const candidate = error as {
        name?: string;
        Code?: string;
        code?: string;
        $metadata?: { httpStatusCode?: number };
      };
      const isMissing =
        candidate.$metadata?.httpStatusCode === 404 ||
        ['NotFound', 'NoSuchBucket'].includes(
          candidate.name ?? candidate.Code ?? candidate.code ?? '',
        );
      if (!isMissing) throw error;

      // Omitting LocationConstraint creates the bucket in the us-east-1 region.
      await this.s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
      this.logger.log(`Minio bucket "${bucket}" created`);
    }

    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucket}/*`],
        },
      ],
    };
    await this.s3Client.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify(policy),
      }),
    );
    this.logger.log(`Public read policy applied to bucket "${bucket}"`);
  }
}
