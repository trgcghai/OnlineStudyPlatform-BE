import { Global, Module, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { MINIO_CLIENT } from 'src/common/constants/file.constant';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [],
  providers: [
    {
      provide: MINIO_CLIENT,
      useFactory: (configService: ConfigService) => {
        const endpoint = configService.getOrThrow<string>('MINIO_ENDPOINT');
        const accessKey = configService.getOrThrow<string>('MINIO_ACCESS_KEY');
        const secretKey = configService.getOrThrow<string>('MINIO_SECRET_KEY');

        const url = new URL(endpoint);
        return new Minio.Client({
          endPoint: url.hostname,
          port: Number(url.port),
          useSSL: url.protocol === 'https:',
          accessKey,
          secretKey,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [MINIO_CLIENT],
})
export class FileModule implements OnModuleInit {
  private readonly logger = new Logger(FileModule.name);

  constructor(
    @Inject(MINIO_CLIENT) private readonly minioClient: Minio.Client,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const bucket = this.configService.getOrThrow<string>('MINIO_BUCKET');

    const exists = await this.minioClient.bucketExists(bucket);

    if (exists) {
      this.logger.log(`Minio bucket "${bucket}" found`);
    } else {
      await this.minioClient.makeBucket(bucket, 'us-east-1');
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
    await this.minioClient.setBucketPolicy(bucket, JSON.stringify(policy));
    this.logger.log(`Public read policy applied to bucket "${bucket}"`);
  }
}
