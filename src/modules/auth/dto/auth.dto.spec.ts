import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResetPasswordDto } from './auth.dto';

describe('Auth DTOs', () => {
  it('enforces the existing password policy for password reset', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      resetToken: 'reset-token',
      newPassword: 'weakpass',
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'newPassword',
          constraints: expect.objectContaining({ matches: expect.any(String) }),
        }),
      ]),
    );
  });

  it('accepts strong reset passwords', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      resetToken: 'reset-token',
      newPassword: 'NewPassword123!',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
