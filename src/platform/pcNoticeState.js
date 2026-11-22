export const PC_NOTICE_KEY = 'escaque:pcNoticeSeen';

export function readPcNoticeSeen(storage) {
  try { return (storage ?? globalThis.localStorage)?.getItem(PC_NOTICE_KEY) === '1'; } catch { return false; }
}
export function markPcNoticeSeen(storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(PC_NOTICE_KEY, '1'); } catch { /* La sesión actual sigue recordándolo. */ }
}
