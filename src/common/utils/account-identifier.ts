const PHONE_PRESENTATION_CHARACTERS = /[\s().-]/g;

export const normalizeEmail = (value: string): string =>
  value.trim().toLocaleLowerCase('en-US');

export const normalizeVietnamPhone = (value: string): string => {
  const compact = value.trim().replace(PHONE_PRESENTATION_CHARACTERS, '');
  if (!/^\+?\d+$/.test(compact)) {
    throw new Error('INVALID_VIETNAM_PHONE');
  }

  let normalized = compact;
  if (normalized.startsWith('+84')) normalized = `0${normalized.slice(3)}`;
  else if (normalized.startsWith('84')) normalized = `0${normalized.slice(2)}`;

  if (!/^0\d{9,10}$/.test(normalized)) {
    throw new Error('INVALID_VIETNAM_PHONE');
  }
  return normalized;
};

/** PostgreSQL expression for comparing canonical input with legacy phone rows. */
export const legacyNormalizedPhoneSql = (column: string): string => {
  const digits = `regexp_replace(${column}, '[^0-9]', '', 'g')`;
  return `(CASE WHEN ${digits} LIKE '84%' THEN '0' || substring(${digits} FROM 3) ELSE ${digits} END)`;
};

