const CREDIT_CARD_IFSCS = new Set([
  'ICIC0000104',
  'ICIC0000105',
  'ICIC0000106',
  'HDFC0000207',
  'HDFC0000208',
  'SBIN0003833',
  'UTIB0000450',
  'YESB0000001',
  'KKBK0000801',
  'KKBK0000802',
  'SCBL0032001',
  'BARB0VIPCARD',
  'CIUB0000001',
]);

export function isCreditCardIfsc(ifsc: string): boolean {
  return CREDIT_CARD_IFSCS.has(ifsc.toUpperCase().trim());
}

export function looksLikeCreditCardNumber(accountNumber: string): boolean {
  const digits = accountNumber.replace(/[\s-]/g, '');
  if (!/^\d{15,16}$/.test(digits)) return false;
  const first = digits[0];
  if (first === '4') return true;
  if (first === '5' && digits.length === 16) return true;
  if (first === '6' && digits.length === 16) return true;
  return false;
}

export function isSelfAccountName(beneficiaryName: string, userName: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalize(beneficiaryName) === normalize(userName);
}
