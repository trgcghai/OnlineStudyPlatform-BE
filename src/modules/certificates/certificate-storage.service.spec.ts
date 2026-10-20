import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CertificateStorageService } from './certificate-storage.service';

describe('CertificateStorageService', () => {
  const client = {
    send: jest.fn(),
  };
  const config = new ConfigService({ MINIO_BUCKET: 'public-assets' });
  const storage = new CertificateStorageService(
    client as unknown as S3Client,
    config,
  );

  beforeEach(() => jest.clearAllMocks());

  it('creates a separate bucket and clears public policies', async () => {
    client.send.mockRejectedValueOnce(
      Object.assign(new Error('missing'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await storage.onModuleInit();
    expect(client.send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
    expect(client.send.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);
    expect(client.send.mock.calls[2][0]).toBeInstanceOf(
      DeleteBucketPolicyCommand,
    );
  });

  it('keeps an existing private bucket', async () => {
    await storage.onModuleInit();
    expect(client.send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
    expect(client.send.mock.calls[1][0]).toBeInstanceOf(
      DeleteBucketPolicyCommand,
    );
  });

  it('rejects using the public asset bucket', () => {
    expect(
      () =>
        new CertificateStorageService(
          client as unknown as S3Client,
          new ConfigService({
            MINIO_BUCKET: 'public',
            CERTIFICATES_BUCKET: 'public',
          }),
        ),
    ).toThrow('separate private');
  });

  it('uploads PDFs and streams downloads without a public URL', async () => {
    const pdf = Buffer.from('%PDF');
    await storage.upload('key', pdf);
    expect(client.send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(client.send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'public-assets-certificates',
      Key: 'key',
      Body: pdf,
      ContentLength: 4,
      ContentType: 'application/pdf',
    });
    const stream = Readable.from(pdf);
    client.send.mockResolvedValueOnce({ Body: stream });
    expect(await storage.download('key')).toBe(stream);
    expect(client.send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
    await storage.remove('key');
    expect(client.send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('reports an unavailable download as a retryable HTTP error', async () => {
    client.send.mockRejectedValueOnce(new Error('unavailable'));
    await expect(storage.download('key')).rejects.toMatchObject({
      status: 503,
    });
  });
});
