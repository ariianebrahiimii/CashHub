export interface TransactionData {
    bank_name: string;
    account_number: string;
    transaction_type: 'withdrawal' | 'deposit';
    withdrawal_amount: number | null;
    deposit_amount: number | null;
    transaction_method: string;
    branch_code: string | null;
    balance: number;
    date: string;
    time: string;
    location: string;
    tag: string;
    timestamp: number;
  }
  
  export class ParseError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ParseError';
    }
  }
  
  export function parseTransactionData(rawData: string): TransactionData {
    if (!rawData || typeof rawData !== 'string') {
      throw new ParseError('Invalid input: rawData must be a non-empty string');
    }
  
    const lines = rawData.split('\n').map(line => line.trim()).filter(line => line);
    if (lines.length < 4) {
      throw new ParseError('Invalid data format: insufficient number of lines');
    }
  
    try {
      const isFormat1 = lines[0].includes('بانک') || !lines[0].startsWith('حساب');
      const isDeposit = lines.some(line => line.includes('واریز'));
  
      if (isFormat1) {
        return isDeposit ? parsePattern2(lines) : parseFormat1(lines);
      } else {
        return isDeposit ? parsePattern1(lines) : parseFormat2(lines);
      }
    } catch (error) {
      if (error instanceof ParseError) {
        throw error;
      }
      throw new ParseError(`خطا در تجزیه تراکنش: ${error.message}`);
    }
  }
  
  function parseFormat1(lines: string[]): TransactionData {
    if (lines.length < 7) {
      throw new ParseError('Invalid Format 1: requires at least 7 lines');
    }
  
    const bankName = validateBankName(lines[0]);
    const accountNumber = validateAccountNumber(lines[1].split(':')[1]?.trim());
    const withdrawalAmount = parseAmount(lines[2].split(':')[1]?.trim(), true);
    const transactionMethod = validateTransactionMethod(lines[3].split(':')[1]?.trim());
    const balance = parseAmount(lines[4].split(':')[1]?.trim(), true);
    const { date, time } = parseDateTime(lines[5], lines[6]);
    const { location, tag } = lines[7] ? parseLocationAndTag(lines[7]) : { location: 'Unknown', tag: '' };
  
    return {
      bank_name: bankName,
      account_number: accountNumber,
      transaction_type: 'withdrawal',
      withdrawal_amount: withdrawalAmount,
      deposit_amount: null,
      transaction_method: transactionMethod,
      branch_code: null,
      balance,
      date,
      time,
      location,
      tag,
      timestamp: Date.now(),
    };
  }
  
  function parseFormat2(lines: string[]): TransactionData {
    if (lines.length < 5) {
      throw new ParseError('Invalid Format 2: requires at least 5 lines');
    }
  
    const accountNumber = validateAccountNumber(lines[0].replace('حساب', '').trim());
    const withdrawalAmount = parseAmount(lines[1].replace('برداشت', '').trim(), false);
    const balance = parseAmount(lines[2].replace('مانده', '').trim(), false);
    const { date, time } = parseCompactDateTime(lines[3]);
    const { location, tag } = parseLocationAndTag(lines[4]);
  
    return {
      bank_name: 'Unknown',
      account_number: accountNumber,
      transaction_type: 'withdrawal',
      withdrawal_amount: withdrawalAmount,
      deposit_amount: null,
      transaction_method: 'Unknown',
      branch_code: null,
      balance,
      date,
      time,
      location,
      tag,
      timestamp: Date.now(),
    };
  }
  
  function parsePattern1(lines: string[]): TransactionData {
    if (lines.length < 4) {
      throw new ParseError('Invalid Pattern 1: requires at least 4 lines');
    }
  
    const accountNumber = validateAccountNumber(lines[0].replace('حساب', '').trim());
    const depositAmount = parseAmount(lines[1].replace('واریز', '').trim(), false);
    const balance = parseAmount(lines[2].replace('مانده', '').trim(), false);
    const { date, time } = parseCompactDateTime(lines[3]);
    const { location, tag } = lines[4] ? parseLocationAndTag(lines[4]) : { location: 'Unknown', tag: '' };
  
    return {
      bank_name: 'Unknown',
      account_number: accountNumber,
      transaction_type: 'deposit',
      withdrawal_amount: null,
      deposit_amount: depositAmount,
      transaction_method: 'Unknown',
      branch_code: null,
      balance,
      date,
      time,
      location,
      tag,
      timestamp: Date.now(),
    };
  }
  
  function parsePattern2(lines: string[]): TransactionData {
    if (lines.length < 8) {
      throw new ParseError('Invalid Pattern 2: requires at least 8 lines');
    }
  
    const bankName = validateBankName(lines[0]);
    const accountNumber = validateAccountNumber(lines[1].split(':')[1]?.trim());
    const depositAmount = parseAmount(lines[2].split(':')[1]?.trim(), true);
    const transactionMethod = validateTransactionMethod(lines[3].split(':')[1]?.trim());
    const branchCode = validateBranchCode(lines[4].split(':')[1]?.trim());
    const balance = parseAmount(lines[5].split(':')[1]?.trim(), true);
    const { date, time } = parseDateTime(lines[6], lines[7]);
    const { location, tag } = lines[8] ? parseLocationAndTag(lines[8]) : { location: 'Unknown', tag: '' };
  
    return {
      bank_name: bankName,
      account_number: accountNumber,
      transaction_type: 'deposit',
      withdrawal_amount: null,
      deposit_amount: depositAmount,
      transaction_method: transactionMethod,
      branch_code: branchCode,
      balance,
      date,
      time,
      location,
      tag,
      timestamp: Date.now(),
    };
  }
  
  export function parseLocationAndTag(line: string): { location: string; tag: string } {
    if (!line) {
      return { location: 'Unknown', tag: '' };
    }
  
    const parts = line.trim().split(' ').filter(part => part);
    if (parts.length === 0) {
      return { location: 'Unknown', tag: '' };
    }
  
    // If the last part starts with '#', it's the tag
    if (parts[parts.length - 1].startsWith('#')) {
      const tag = parts[parts.length - 1].slice(1); // Remove '#'
      const location = parts.slice(0, -1).join(' ') || 'Unknown';
      return { location, tag };
    }
  
    // If no '#' is found, assume the entire line is the tag and location is Unknown
    const tag = parts[0].startsWith('#') ? parts[0].slice(1) : parts[0];
    const location = parts[0].startsWith('#') ? 'Unknown' : parts.join(' ');
  
    return { location: location || 'Unknown', tag };
  }
  
  function parseAmount(amountStr: string | undefined, expectCurrency: boolean): number {
    if (!amountStr) {
      throw new ParseError('Invalid amount format');
    }
  
    let cleaned = amountStr.replace(/,/g, '').trim();
    if (expectCurrency) {
      cleaned = cleaned.replace(' ریال', '');
    }
  
    const amount = parseInt(cleaned, 10);
  
    if (isNaN(amount) || amount < 0) {
      throw new ParseError('Invalid amount: must be a positive number');
    }
  
    return amount;
  }
  
  function parseDateTime(dateStr: string, timeStr: string): { date: string; time: string } {
    const date = dateStr.trim();
    const time = timeStr.trim();
  
    if (!/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(date)) {
      throw new ParseError('Invalid date format: expected YYYY-MM-DD or YYYY/MM/DD');
    }
  
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
      throw new ParseError('Invalid time format: expected HH:MM or HH:MM:SS');
    }
  
    const normalizedTime = time.length === 5 ? `${time}:00` : time;
    return { date, time: normalizedTime };
  }
  
  function parseCompactDateTime(dateTimeStr: string): { date: string; time: string } {
    const trimmed = dateTimeStr.trim();
    if (!/^\d{2}\/\d{2}\/\d{2}-\d{2}:\d{2}$/.test(trimmed)) {
      throw new ParseError('Invalid date-time format: expected YY/MM/DD-HH:MM');
    }
  
    const [datePart, timePart] = trimmed.split('-');
    const [year, month, day] = datePart.split('/');
  
    const fullYear = `14${year}`;
    const normalizedDate = `${fullYear}/${month}/${day}`;
    const normalizedTime = `${timePart}:00`;
  
    return { date: normalizedDate, time: normalizedTime };
  }
  
  function validateBankName(bankName: string | undefined): string {
    if (!bankName?.trim()) {
      throw new ParseError('Bank name is required');
    }
    return bankName.trim();
  }
  
  function validateAccountNumber(accountNumber: string | undefined): string {
    if (!accountNumber?.trim()) {
      throw new ParseError('Account number is required');
    }
    return accountNumber.trim();
  }
  
  function validateTransactionMethod(method: string | undefined): string {
    if (!method?.trim()) {
      throw new ParseError('Transaction method is required');
    }
    return method.trim();
  }
  
  function validateBranchCode(branchCode: string | undefined): string {
    if (!branchCode?.trim()) {
      throw new ParseError('Branch code is required');
    }
    return branchCode.trim();
  }