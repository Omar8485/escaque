import { describe, it, expect } from 'vitest';
import { viewportInfo, sameViewport, DESKTOP_MIN_WIDTH, PHONE_MAX_WIDTH, MOBILE_QUERY } from './viewport.js';
import { boardSizeFor, sumReserved, BOARD_MARGIN, MIN_BOARD_SIDE } from './boardSize.js';

describe('viewportInfo', () => {
  it('los viewports de prueba de la ronda M', () => {
    expect(viewportInfo({ width: 360, height: 740 })).toEqual({ mobile: true, phone: true, landscape: false, width: 360, height: 740 });
    expect(viewportInfo({ width: 390, height: 844 })).toMatchObject({ mobile: true, phone: true, landscape: false });
    expect(viewportInfo({ width: 412, height: 915 })).toMatchObject({ mobile: true, phone: true, landscape: false });
    // Teléfono girado: sigue siendo móvil, ya no "teléfono" por ancho, y horizontal.
    expect(viewportInfo({ width: 740, height: 360 })).toEqual({ mobile: true, phone: false, landscape: true, width: 740, height: 360 });
  });

  it('el escritorio empieza en 1024 (lg de Tailwind) y no cambia', () => {
    expect(viewportInfo({ width: 1023, height: 700 }).mobile).toBe(true);
    expect(viewportInfo({ width: DESKTOP_MIN_WIDTH, height: 700 }).mobile).toBe(false);
    expect(viewportInfo({ width: 1004, height: 508 }).mobile).toBe(true); // portátil al 125 %: tablet/móvil
    expect(viewportInfo({ width: 1500, height: 950 })).toMatchObject({ mobile: false, phone: false, landscape: true });
  });

  it('el límite de teléfono es 640 (sm)', () => {
    expect(viewportInfo({ width: PHONE_MAX_WIDTH - 1, height: 900 }).phone).toBe(true);
    expect(viewportInfo({ width: PHONE_MAX_WIDTH, height: 900 }).phone).toBe(false);
  });

  it('redondea y tolera valores inválidos (SSR, ventana sin medir)', () => {
    expect(viewportInfo({ width: 390.4, height: 843.6 })).toMatchObject({ width: 390, height: 844 });
    expect(viewportInfo({ width: 0, height: NaN })).toMatchObject({ mobile: false, width: DESKTOP_MIN_WIDTH, height: 768 });
  });

  it('cuadrado: no es horizontal', () => {
    expect(viewportInfo({ width: 600, height: 600 }).landscape).toBe(false);
  });

  it('sameViewport compara por valor', () => {
    const a = viewportInfo({ width: 360, height: 740 });
    expect(sameViewport(a, viewportInfo({ width: 360, height: 740 }))).toBe(true);
    expect(sameViewport(a, viewportInfo({ width: 360, height: 741 }))).toBe(false);
    expect(sameViewport(a, null)).toBe(false);
  });

  it('MOBILE_QUERY coincide con el corte de 1024', () => {
    expect(MOBILE_QUERY).toBe('(max-width: 1023.98px)');
  });
});

describe('boardSizeFor', () => {
  it('vertical: manda el ancho (menos 8 px de margen)', () => {
    // Pixel 7: 412 de ancho, mucho alto libre.
    expect(boardSizeFor({ width: 412, height: 839, reserved: [32, 32, 44, 56] })).toBe(412 - BOARD_MARGIN);
    expect(boardSizeFor({ width: 360, height: 740, reserved: 200 })).toBe(352);
  });

  it('A2: a 360×740 el tablero ocupa ≥ 94 % del ancho con barras, coach y barra inferior', () => {
    const side = boardSizeFor({ width: 360, height: 740, reserved: [48, 32, 32, 56, 56, 24] });
    expect(side / 360).toBeGreaterThanOrEqual(0.94);
  });

  it('horizontal: manda el alto disponible menos lo reservado', () => {
    expect(boardSizeFor({ width: 740, height: 360, reserved: [48, 24] })).toBe(288);
  });

  it('suma la lista de reservados ignorando huecos', () => {
    expect(sumReserved([32, null, undefined, false, -5, 10])).toBe(42);
    expect(sumReserved(15)).toBe(15);
    expect(sumReserved([])).toBe(0);
  });

  it('nunca baja del mínimo, ni devuelve decimales', () => {
    expect(boardSizeFor({ width: 120, height: 100 })).toBe(MIN_BOARD_SIDE);
    expect(boardSizeFor({ width: 300, height: 1000, reserved: 0, margin: 0, min: 0 })).toBe(300);
    expect(Number.isInteger(boardSizeFor({ width: 333.7, height: 1000 }))).toBe(true);
    expect(boardSizeFor({ width: 100, height: 100, min: 0 })).toBe(92);
  });

  it('margen y mínimo configurables; entradas inválidas no rompen', () => {
    expect(boardSizeFor({ width: 400, height: 1000, margin: 0 })).toBe(400);
    expect(boardSizeFor({ width: NaN, height: 500, min: 0 })).toBe(0);
  });
});
