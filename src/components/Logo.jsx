import React from 'react';

// Logo de Escaque: un escaque (casilla) girado, partido en cuatro como un mini tablero.
const Logo = ({ size = 36 }) => (
  <svg viewBox="0 0 40 40" width={size} height={size} role="img" aria-label="Escaque" className="flex-shrink-0">
    <g transform="rotate(45 20 20)">
      <rect x="7" y="7" width="26" height="26" rx="4" fill="#7f321e" />
      <rect x="9" y="9" width="11" height="11" rx="1.5" fill="#f2e3c9" />
      <rect x="20" y="9" width="11" height="11" rx="1.5" fill="#d65f36" />
      <rect x="9" y="20" width="11" height="11" rx="1.5" fill="#d65f36" />
      <rect x="20" y="20" width="11" height="11" rx="1.5" fill="#f2e3c9" />
    </g>
  </svg>
);

export default Logo;
