import { describe, expect, it } from 'vitest';
import { fixedPrice, yearlyDeal } from './pricing.js';

const product = (amount, { currency = 'usd', amountType = 'fixed' } = {}) => ({ prices: [{ amountType, amount, currency }] });

describe('precios de la pantalla Premium', () => {
  it('2,99 al mes y 19,99 al año → 1,67 al mes y ahorro del 44 %', () => {
    const deal = yearlyDeal(product(299), product(1999));
    expect(deal.savingsPct).toBe(44);
    expect(deal.currency).toBe('usd');
    expect((deal.perMonthCents / 100).toFixed(2)).toBe('1.67');
  });

  it('el ahorro se redondea hacia abajo (no se exagera)', () => {
    // 1 − 1000/1200 = 16,67 % → 16 %
    expect(yearlyDeal(product(100), product(1000)).savingsPct).toBe(16);
  });

  it('sin ahorro real, precios no fijos o monedas distintas: no hay oferta', () => {
    expect(yearlyDeal(product(299), product(3588))).toBeNull();
    expect(yearlyDeal(product(299), product(4000))).toBeNull();
    expect(yearlyDeal(product(299), product(1999, { currency: 'eur' }))).toBeNull();
    expect(yearlyDeal(product(299), product(null, { amountType: 'custom' }))).toBeNull();
    expect(yearlyDeal(undefined, product(1999))).toBeNull();
    expect(fixedPrice({ prices: [] })).toBeNull();
  });
});
