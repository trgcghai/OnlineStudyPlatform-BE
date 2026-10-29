export function parseFrontendOrigins(
  configuredOrigins: string | undefined,
): string[] {
  const origins = configuredOrigins
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!origins?.length) {
    throw new Error('FRONTEND_URLS must contain at least one allowed origin');
  }

  return origins;
}
