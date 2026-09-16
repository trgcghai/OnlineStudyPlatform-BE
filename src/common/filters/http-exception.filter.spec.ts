import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  it('passes through explicit bad request details', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;
    const filter = new HttpExceptionFilter();

    filter.catch(
      new BadRequestException({
        message: 'Amount is below minimum withdrawal amount',
        details: ['minimumWithdrawalAmount=1000000', 'currency=VND'],
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: 'Amount is below minimum withdrawal amount',
          details: ['minimumWithdrawalAmount=1000000', 'currency=VND'],
        }),
      }),
    );
  });
});
