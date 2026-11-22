import React, { useState } from 'react';
import BottomSheet from '../layout/BottomSheet';
import { useI18n } from '../i18n/useI18n';
import { readPcNoticeSeen, markPcNoticeSeen } from './pcNoticeState';

export function PcNote({ testId, premium = false }) {
  const { t } = useI18n();
  return <p data-testid={testId} className="text-xs leading-relaxed text-ink-600 dark:text-ink-300">
    {t(premium ? 'pcNotice.premium' : 'pcNotice.message')}{' '}
    <a href={t('pcNotice.termsHref')} target="_blank" rel="noopener noreferrer" className="underline text-brand-700 dark:text-brand-300">{t('pcNotice.terms')}</a>
  </p>;
}

export default function PcNotice() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => !readPcNoticeSeen());
  const acknowledge = () => { markPcNoticeSeen(); setOpen(false); };
  return <BottomSheet open={open} onClose={acknowledge} dismissible={false} backdrop={false} title={t('pcNotice.title')} testId="pc-notice" footer={<button type="button" data-testid="pc-notice-ok" onClick={acknowledge} className="min-h-11 w-full rounded-xl bg-brand-600 px-4 py-2 font-bold text-white">{t('pcNotice.ok')}</button>}>
    <PcNote />
  </BottomSheet>;
}
