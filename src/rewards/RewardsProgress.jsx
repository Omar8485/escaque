import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Isolated mount inside Progress, without coupling to its concurrent screen work. */
export default function RewardsProgress({ activeTab, children }) {
  const [target, setTarget] = useState(null);
  useEffect(() => {
    if (activeTab !== 'progress') return;
    const find = () => {
      const node = document.querySelector('[data-testid=progress-screen]');
      if (node) setTarget((previous) => previous === node ? previous : node);
    };
    queueMicrotask(find);
    const observer = new MutationObserver(find);
    observer.observe(document.querySelector('main') ?? document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [activeTab]);
  return activeTab === 'progress' && target?.isConnected ? createPortal(children, target) : null;
}
