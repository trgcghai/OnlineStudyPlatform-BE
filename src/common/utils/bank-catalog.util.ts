import { BankOption } from '../../modules/users/schemas/bank-catalog.schema';

const MAX_BANKS = 200;
const BANK_CODE_PATTERN = /^[A-Z0-9]{2,20}$/;
const BANK_BIN_PATTERN = /^[0-9]{3,12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSafeString(
  value: unknown,
  maxLength: number,
  fieldName: string,
): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid bank catalog item: ${fieldName}`);
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new Error(`Invalid bank catalog item: ${fieldName}`);
  }

  return trimmed;
}

function sortBanks(banks: BankOption[]): BankOption[] {
  return [...banks].sort((a, b) => {
    const shortNameCompare = a.shortName.localeCompare(b.shortName, 'vi');

    return shortNameCompare || a.name.localeCompare(b.name, 'vi');
  });
}

export function validateBankOptions(value: unknown): BankOption[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BANKS) {
    throw new Error('Invalid bank catalog response');
  }

  const seenCodes = new Set<string>();
  const banks = value.map((item) => {
    if (!isRecord(item)) {
      throw new Error('Invalid bank catalog item');
    }

    const name = requireSafeString(item.name, 200, 'name');
    const code = requireSafeString(item.code, 20, 'code');
    const bin = requireSafeString(item.bin, 12, 'bin');
    const shortName = requireSafeString(item.shortName, 80, 'shortName');

    if (!BANK_CODE_PATTERN.test(code)) {
      throw new Error('Invalid bank catalog item: code');
    }

    if (!BANK_BIN_PATTERN.test(bin)) {
      throw new Error('Invalid bank catalog item: bin');
    }

    if (seenCodes.has(code)) {
      throw new Error(`Duplicate bank code: ${code}`);
    }
    seenCodes.add(code);

    return { name, code, bin, shortName };
  });

  return sortBanks(banks);
}

export function normalizeVietQrBankResponse(response: unknown): BankOption[] {
  if (!isRecord(response) || !Array.isArray(response.data)) {
    throw new Error('Invalid bank catalog response');
  }

  const normalized = response.data.map((item) => {
    if (!isRecord(item)) {
      throw new Error('Invalid bank catalog item');
    }

    return {
      name: item.name,
      code: item.code,
      bin: item.bin,
      shortName: item.short_name,
    };
  });

  return validateBankOptions(normalized);
}
