import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import PremiumLock from './PremiumLock.jsx';

const { usePremium } = vi.hoisted(() => ({ usePremium: vi.fn() }));
vi.mock('./planStore.js', () => ({ usePremium, openPremium: vi.fn() }));
afterEach(() => usePremium.mockReset());

const render = () => renderToStaticMarkup(<PremiumLock feature="test" preview={<span>Ejemplo de apertura</span>}>
  <span>Apertura real del jugador</span>
</PremiumLock>);

it('shows only the example and unlock button for the free plan', () => {
  usePremium.mockReturnValue(false);
  expect(render()).toContain('premium-lock-test');
  expect(render()).toContain('Ejemplo de apertura');
  expect(render()).toContain('Desbloquear con Premium');
  expect(render()).not.toContain('Apertura real del jugador');
});

it('shows only real content with Premium', () => {
  usePremium.mockReturnValue(true);
  expect(render()).toBe('<span>Apertura real del jugador</span>');
});

it('the note under the button never shows a raw {placeholder} (trial from the Polar cache, or a generic note)', () => {
  usePremium.mockReturnValue(false);
  const html = render();
  expect(html).not.toMatch(/\{\w+\}/);
  expect(html).toMatch(/Prueba Premium: \d+ días? gratis|Mira los planes de Premium/);
});
