import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { FileModule } from './file.module';

describe('FileModule', () => {
  const bucket = 'public-assets';
  let s3Client: { send: jest.Mock };
  let module: FileModule;

  beforeEach(() => {
    s3Client = { send: jest.fn().mockResolvedValue({}) };
    module = new FileModule(
      s3Client as unknown as S3Client,
      new ConfigService({ MINIO_BUCKET: bucket }),
    );
  });

  it('applies public read policy to an existing bucket', async () => {
    await module.onModuleInit();

    expect(s3Client.send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
    expect(s3Client.send.mock.calls[0][0].input).toEqual({ Bucket: bucket });
    expect(s3Client.send.mock.calls[1][0]).toBeInstanceOf(
      PutBucketPolicyCommand,
    );
    expect(s3Client.send.mock.calls[1][0].input).toEqual({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucket}/*`],
          },
        ],
      }),
    });
  });

  it('creates a missing bucket before applying public read policy', async () => {
    const missing = Object.assign(new Error('missing'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    s3Client.send.mockRejectedValueOnce(missing);

    await module.onModuleInit();

    expect(s3Client.send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
    expect(s3Client.send.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);
    expect(s3Client.send.mock.calls[1][0].input).toEqual({ Bucket: bucket });
    expect(s3Client.send.mock.calls[2][0]).toBeInstanceOf(
      PutBucketPolicyCommand,
    );
  });

  it('propagates bucket check failures that do not mean missing', async () => {
    const denied = Object.assign(new Error('access denied'), {
      name: 'Forbidden',
      $metadata: { httpStatusCode: 403 },
    });
    s3Client.send.mockRejectedValue(denied);

    await expect(module.onModuleInit()).rejects.toBe(denied);
    expect(s3Client.send).toHaveBeenCalledTimes(1);
  });
});
