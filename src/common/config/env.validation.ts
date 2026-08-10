const REQUIRED_VARS: { key: string; type: 'string' | 'number' }[] = [
  { key: 'PORT', type: 'number' },
];

export function validateEnv(config: Record<string, unknown>) {
  const missing = REQUIRED_VARS.filter(
    ({ key }) => config[key] === undefined || config[key] === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.map(({ key }) => key).join(', ')}. Check .env (see .env.example)`,
    );
  }

  for (const { key, type } of REQUIRED_VARS) {
    if (type === 'number' && Number.isNaN(Number(config[key]))) {
      throw new Error(`Environment variable ${key} must be a number`);
    }
  }

  return config;
}
