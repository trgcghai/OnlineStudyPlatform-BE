import { UserRole } from '../users/entities/user.entity';
import { ConfigService as PaymentConfigService } from './config.service';
import { InstructorBalanceLedgerType } from './entities/instructor-balance-ledger.entity';
import { InstructorBalanceService } from './instructor-balance.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController instructor balance routes', () => {
  let controller: PaymentsController;
  let balanceService: {
    getSummary: jest.Mock;
    listHistory: jest.Mock;
  };

  const currentUser = {
    id: '44444444-4444-4444-8444-444444444444',
    role: UserRole.INSTRUCTOR,
  } as never;

  beforeEach(() => {
    balanceService = {
      getSummary: jest.fn().mockResolvedValue({
        currentBalance: 159200,
        totalEarned: 159200,
        totalWithdrawn: 0,
        currency: 'VND',
      }),
      listHistory: jest.fn().mockResolvedValue({
        items: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            type: InstructorBalanceLedgerType.EARNING_CREDIT,
            amountDelta: 159200,
            currency: 'VND',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    };

    controller = new PaymentsController(
      {} as PaymentsService,
      {} as PaymentConfigService,
      balanceService as unknown as InstructorBalanceService,
    );
  });

  it('delegates instructor balance summary to the balance service', async () => {
    const result = await controller.getInstructorBalanceSummary(currentUser);

    expect(balanceService.getSummary).toHaveBeenCalledWith(currentUser);
    expect(result).toMatchObject({ currentBalance: 159200, currency: 'VND' });
  });

  it('delegates instructor balance history with query pagination', async () => {
    const query = { page: 2, limit: 5 };

    const result = await controller.listInstructorBalanceHistory(
      currentUser,
      query,
    );

    expect(balanceService.listHistory).toHaveBeenCalledWith(currentUser, query);
    expect(result).toMatchObject({ total: 1, page: 1, limit: 10 });
  });
});
