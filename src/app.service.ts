import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface ComponentHealth {
  status: string;
  details?: { error: string };
}

@Injectable()
export class AppService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getHealth() {
    const postgresql = await this.checkPostgres();

    return {
      status: postgresql.status === 'UP' ? 'UP' : 'DOWN',
      components: {
        application: { status: 'UP' },
        postgresql,
        redis: { status: 'developing' },
        mongodb: { status: 'developing' },
        minio: { status: 'developing' },
      },
    };
  }

  private async checkPostgres(): Promise<ComponentHealth> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'UP' };
    } catch (error) {
      return {
        status: 'DOWN',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
