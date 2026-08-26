import { describe, it, expect } from 'bun:test';
import { extractAmount } from './index.js';

// ─── Amount parsing, against REAL bank messages ──────────────────────────────
//
// The model read "تم استلام3.500 دينار" as 3500 — a thousandfold error, and the
// worst possible failure in something that adds up money. The digits are in the
// text, so they are taken from the text and the model is used only for meaning.

describe('extractAmount: real messages', () => {
  it('reads an English outgoing transfer', () => {
    expect(
      extractAmount(
        'An amount of 51.19 JOD has been transferred from your account xxxx to MOHAMMAD K M MOHAMMADTAHA. Available Balance: 0.004 JOD.'
      )
    ).toBe(51.19);
  });

  it('reads an Arabic incoming CliQ transfer', () => {
    expect(
      extractAmount(
        'حوالة كليك واردة بمبلغ 3.0 دينار اردني لحسابكم xxxxxxx- xxx من ABDALLAH NIDAL KHAMEES GHANNAM الرصيد المتوفر 3.17 دينار اردني'
      )
    ).toBe(3);
  });

  it('reads an Arabic receipt with no space before the number', () => {
    // The exact case the model got wrong by a factor of 1000.
    expect(
      extractAmount('تم استلام3.500 دينار من xxxxxxxxxxxx الرصيد الحالي JOD4.187 دينار.')
    ).toBe(3.5);
  });
});

describe('extractAmount: shapes and edges', () => {
  it('takes the amount, not the balance that follows it', () => {
    // Both are currency figures; the first one is the transaction.
    expect(extractAmount('Purchase of 12.500 JOD. Available Balance: 980.250 JOD')).toBe(12.5);
  });

  it('handles the currency before the number', () => {
    expect(extractAmount('Received JOD4.187 today')).toBe(4.187);
  });

  it('keeps all three decimals', () => {
    expect(extractAmount('Balance charge of 0.004 JOD')).toBe(0.004);
  });

  it('handles thousands separators', () => {
    expect(extractAmount('Salary of 1,250.500 JOD credited')).toBe(1250.5);
  });

  it('accepts JD as well as JOD', () => {
    expect(extractAmount('Paid 7.25 JD at the shop')).toBe(7.25);
  });

  it('returns null when there is no currency figure', () => {
    expect(extractAmount('Your PIN was changed successfully.')).toBeNull();
    expect(extractAmount('')).toBeNull();
  });

  it('ignores a bare number with no currency word', () => {
    // Reference numbers and dates must not be mistaken for amounts.
    expect(extractAmount('Reference 55123 processed on 26/08')).toBeNull();
  });
});
