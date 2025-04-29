import { describe, it, expect } from 'vitest';
import { parseTransactionData, TransactionData, ParseError } from '../src/parser';

describe('Transaction Parser', () => {
  // Test cases for Template 1
  describe('Template 1 (Format 1 and Pattern 2)', () => {
    it('parses Template 1 Withdrawal (Format 1) correctly', () => {
      const input = `
        *بانک تجارت*
        حساب: 0177018376691
        برداشت: 640,000 ریال
        از طریق: پایانه فروش
        مانده: 204,285,600 ریال
        1404/02/02
        12:06
        Cigarettes #ciggaret
      `.trim();

      const expected: TransactionData = {
        bank_name: '*بانک تجارت*',
        account_number: '0177018376691',
        transaction_type: 'withdrawal',
        withdrawal_amount: 640000,
        deposit_amount: null,
        transaction_method: 'پایانه فروش',
        branch_code: null,
        balance: 204285600,
        date: '1404/02/02',
        time: '12:06:00',
        location: 'Cigarettes',
        tag: 'ciggaret',
        timestamp: expect.any(Number),
      };

      const result = parseTransactionData(input);
      expect(result).toEqual(expected);
    });

    it('parses Template 1 Deposit (Pattern 2) correctly', () => {
      const input = `
        *بانک تجارت*
        حساب: 0177018376691
        واریز حقوق: 148,792,250 ریال
        از طریق: شعبه
        کدشعبه: 2080
        مانده: 204,925,600 ریال
        1404/02/02
        11:58
        Hooghoogh #hooghoogh
      `.trim();

      const expected: TransactionData = {
        bank_name: '*بانک تجارت*',
        account_number: '0177018376691',
        transaction_type: 'deposit',
        withdrawal_amount: null,
        deposit_amount: 148792250,
        transaction_method: 'شعبه',
        branch_code: '2080',
        balance: 204925600,
        date: '1404/02/02',
        time: '11:58:00',
        location: 'Hooghoogh',
        tag: 'hooghoogh',
        timestamp: expect.any(Number),
      };

      const result = parseTransactionData(input);
      expect(result).toEqual(expected);
    });
  });

  // Test cases for Template 2
  describe('Template 2 (Format 2 and Pattern 1)', () => {
    it('parses Template 2 Withdrawal (Format 2) correctly', () => {
      const input = `
        حساب2328262050
        برداشت2,007,200
        مانده4,715,425
        04/02/08-20:17
        Ichil #ichil
      `.trim();

      const expected: TransactionData = {
        bank_name: 'Unknown',
        account_number: '2328262050',
        transaction_type: 'withdrawal',
        withdrawal_amount: 2007200,
        deposit_amount: null,
        transaction_method: 'Unknown',
        branch_code: null,
        balance: 4715425,
        date: '1404/02/08',
        time: '20:17:00',
        location: 'Ichil',
        tag: 'ichil',
        timestamp: expect.any(Number),
      };

      const result = parseTransactionData(input);
      expect(result).toEqual(expected);
    });

    it('parses Template 2 Deposit (Pattern 1) correctly', () => {
      const input = `
        حساب2328262050
        واریز20,000,000
        مانده20,483,825
        04/02/08-10:20
        CardCard #moneymanagement
      `.trim();

      const expected: TransactionData = {
        bank_name: 'Unknown',
        account_number: '2328262050',
        transaction_type: 'deposit',
        withdrawal_amount: null,
        deposit_amount: 20000000,
        transaction_method: 'Unknown',
        branch_code: null,
        balance: 20483825,
        date: '1404/02/08',
        time: '10:20:00',
        location: 'CardCard',
        tag: 'moneymanagement',
        timestamp: expect.any(Number),
      };

      const result = parseTransactionData(input);
      expect(result).toEqual(expected);
    });
  });

  // Edge cases
  describe('Edge Cases and Error Handling', () => {
    it('throws ParseError for empty input', () => {
      expect(() => parseTransactionData('')).toThrow(ParseError);
      expect(() => parseTransactionData('')).toThrow('Invalid input: rawData must be a non-empty string');
    });

    it('throws ParseError for insufficient lines', () => {
      const input = `
        *بانک تجارت*
        حساب: 0177018376691
      `.trim();
      expect(() => parseTransactionData(input)).toThrow(ParseError);
      expect(() => parseTransactionData(input)).toThrow('Invalid data format: insufficient number of lines');
    });

    it('throws ParseError for invalid amount', () => {
      const input = `
        *بانک تجارت*
        حساب: 0177018376691
        برداشت: invalid ریال
        از طریق: پایانه فروش
        مانده: 204,285,600 ریال
        1404/02/02
        12:06
        Cigarettes #ciggaret
      `.trim();
      expect(() => parseTransactionData(input)).toThrow(ParseError);
      expect(() => parseTransactionData(input)).toThrow('Invalid amount: must be a positive number');
    });

    it('throws ParseError for invalid date format', () => {
      const input = `
        *بانک تجارت*
        حساب: 0177018376691
        برداشت: 640,000 ریال
        از طریق: پایانه فروش
        مانده: 204,285,600 ریال
        invalid-date
        12:06
        Cigarettes #ciggaret
      `.trim();
      expect(() => parseTransactionData(input)).toThrow(ParseError);
      expect(() => parseTransactionData(input)).toThrow('Invalid date format: expected YYYY-MM-DD or YYYY/MM/DD');
    });

    it('handles missing location and tag', () => {
      const input = `
        *بانک تجارت*
        حساب: 0177018376691
        برداشت: 640,000 ریال
        از طریق: پایانه فروش
        مانده: 204,285,600 ریال
        1404/02/02
        12:06
      `.trim();

      const result = parseTransactionData(input);
      expect(result.location).toBe('Unknown');
      expect(result.tag).toBe('');
    });

    it('handles empty location and tag line', () => {
      const input = `
        *بانک تجارت*
        حساب: 0177018376691
        برداشت: 640,000 ریال
        از طریق: پایانه فروش
        مانده: 204,285,600 ریال
        1404/02/02
        12:06
        
      `.trim();

      const result = parseTransactionData(input);
      expect(result.location).toBe('Unknown');
      expect(result.tag).toBe('');
    });

    it('handles tag-only input for location', () => {
      const input = `
        حساب2328262050
        واریز20,000,000
        مانده20,483,825
        04/02/08-10:20
        #moneymanagement
      `.trim();

      const result = parseTransactionData(input);
      expect(result.location).toBe('Unknown');
      expect(result.tag).toBe('moneymanagement');
    });
  });
});