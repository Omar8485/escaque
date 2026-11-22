import { describe, it, expect } from 'vitest';
import { PC_NOTICE_KEY, readPcNoticeSeen, markPcNoticeSeen } from './pcNoticeState';

describe('aviso para PC', () => {
  it('solo recuerda una aceptación explícita', () => {
    const values = new Map();
    const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
    expect(readPcNoticeSeen(storage)).toBe(false);
    markPcNoticeSeen(storage);
    expect(values.get(PC_NOTICE_KEY)).toBe('1');
    expect(readPcNoticeSeen(storage)).toBe(true);
  });
  it('tolera almacenamiento bloqueado', () => {
    const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    expect(readPcNoticeSeen(blocked)).toBe(false);
    expect(() => markPcNoticeSeen(blocked)).not.toThrow();
  });
});
