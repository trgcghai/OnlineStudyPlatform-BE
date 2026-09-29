export const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';
export const REFRESH_SESSION_KEY_PREFIX = 'auth:refresh';
export const ACCESS_TOKEN_BLACKLIST_KEY_PREFIX = 'auth:access:blacklist';
export const EMAIL_VERIFICATION_OTP_KEY_PREFIX = 'auth:email-verification:otp';
export const PASSWORD_RESET_OTP_KEY_PREFIX = 'auth:password-reset:otp';
export const PASSWORD_RESET_TOKEN_KEY_PREFIX = 'auth:password-reset:token';
export const JWT_STRATEGY_NAME = 'jwt';
export const ROLES_KEY = 'roles';

export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_SALT_ROUNDS = 10;
export const RESET_TOKEN_TTL_SECONDS = 10 * 60;
