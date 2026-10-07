import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { Readable } from 'node:stream';
import { CertificateStorageService } from './certificate-storage.service';

describe('CertificateStorageService', () => {
  const client = {
    bucketExists: jest.fn(),
    makeBucket: jest.fn(),
    setBucketPolicy: jest.fn(),
    putObject: jest.fn(),
    getObject: jest.fn(),
    removeObject: jest.fn(),
  };
  const config = new ConfigService({ MINIO_BUCKET: 'public-assets' });
  const storage = new CertificateStorageService(
    client as unknown as Client,
    config,
  );

  beforeEach(() => jest.clearAllMocks());

  it('creates a separate bucket and clears public policies', async () => {
    client.bucketExists.mockResolvedValue(false);
    await storage.onModuleInit();
    expect(client.makeBucket).toHaveBeenCalledWith(
      'public-assets-certificates',
      'us-east-1',
    );
    expect(client.setBucketPolicy).toHaveBeenCalledWith(
      'public-assets-certificates',
      '',
    );
  });

  it('keeps an existing private bucket', async () => {
    client.bucketExists.mockResolvedValue(true);
    await storage.onModuleInit();
    expect(client.makeBucket).not.toHaveBeenCalled();
  });

  it('rejects using the public asset bucket', () => {
    expect(
      () =>
        new CertificateStorageService(
          client as unknown as Client,
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
    expect(client.putObject).toHaveBeenCalledWith(
      'public-assets-certificates',
      'key',
      pdf,
      4,
      { 'Content-Type': 'application/pdf' },
    );
    const stream = Readable.from(pdf);
    client.getObject.mockResolvedValue(stream);
    expect(await storage.download('key')).toBe(stream);
    await storage.remove('key');
    expect(client.removeObject).toHaveBeenCalledWith(
      'public-assets-certificates',
      'key',
    );
  });

  it('reports an unavailable download as a retryable HTTP error', async () => {
    client.getObject.mockRejectedValue(new Error('unavailable'));
    await expect(storage.download('key')).rejects.toMatchObject({
      status: 503,
    });
  });
});
