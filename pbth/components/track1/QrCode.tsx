import React from 'react';

// QR-код ссылки команды. Кодирует библиотека uqr (MIT, без зависимостей,
// версия закреплена) — грузится отдельным куском, только когда капитан
// открыл ссылку команды. Рисуем сами в реальных пикселях: модуль — целое
// число пикселей, viewBox равен размеру, без растяжения.
// ui-kit-allow: QR-код — данные ссылки, не иконка; в ui-kit QR нет, ui-kit в ревизии не подключаем (решение Василия 10.11.2026)

type Matrix = boolean[][];

export const QrCode: React.FC<{ value: string; moduleSize?: number; label?: string }> = ({ value, moduleSize = 6, label }) => {
  const [matrix, setMatrix] = React.useState<Matrix | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void import('uqr').then(({ encode }) => {
      if (cancelled) return;
      setMatrix(encode(value, { ecc: 'M', border: 2 }).data);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!matrix) return <div className="bg-white rounded-xl" style={{ width: 29 * moduleSize, height: 29 * moduleSize }} />;

  const px = matrix.length * moduleSize;
  let d = '';
  matrix.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) d += `M${x * moduleSize} ${y * moduleSize}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
    });
  });
  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${px} ${px}`}
      role="img"
      aria-label={label || 'QR-код ссылки'}
      className="rounded-xl"
      shapeRendering="crispEdges"
    >
      <rect width={px} height={px} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
};
