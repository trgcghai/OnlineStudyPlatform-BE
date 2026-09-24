export const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';
export const REFRESH_SESSION_KEY_PREFIX = 'auth:refresh';
export const ACCESS_TOKEN_BLACKLIST_KEY_PREFIX = 'auth:access:blacklist';
export const EMAIL_VERIFICATION_OTP_KEY_PREFIX = 'auth:email-verification:otp';
export const EMAIL_VERIFICATION_COOLDOWN_KEY_PREFIX =
  'auth:email-verification:cooldown';
export const EMAIL_VERIFICATION_RATE_LIMIT_KEY_PREFIX =
  'auth:email-verification:rate';
export const PASSWORD_RESET_OTP_KEY_PREFIX = 'auth:password-reset:otp';
export const PASSWORD_RESET_COOLDOWN_KEY_PREFIX =
  'auth:password-reset:cooldown';
export const PASSWORD_RESET_RATE_LIMIT_KEY_PREFIX = 'auth:password-reset:rate';
export const PASSWORD_RESET_TOKEN_KEY_PREFIX = 'auth:password-reset:token';
export const JWT_STRATEGY_NAME = 'jwt';
export const ROLES_KEY = 'roles';

export const OTP_TTL_SECONDS = 10 * 60;
export const RESEND_COOLDOWN_SECONDS = 60;
export const RESEND_RATE_LIMIT_SECONDS = 60 * 60;
export const MAX_RESENDS_PER_WINDOW = 5;
export const OTP_SALT_ROUNDS = 10;
export const RESET_TOKEN_TTL_SECONDS = 10 * 60;
