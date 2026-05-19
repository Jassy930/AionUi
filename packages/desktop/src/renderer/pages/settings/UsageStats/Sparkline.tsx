/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

const SEGMENT_PALETTE = ['#3491FA', '#00B42A', '#FF7D00', '#F53F3F', '#722ED1', '#14C9C9', '#F7BA1E', '#D91AD9'];

const Sparkline: React.FC<{ values: number[]; color?: string }> = ({ values, color }) => {
  if (values.length === 0) {
    return <svg width='100%' height='32' aria-hidden='true' />;
  }
  const max = Math.max(1, ...values);
  const stroke = color ?? SEGMENT_PALETTE[0];
  const n = values.length;
  const pts = values
    .map((v, i) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * 120;
      const y = 32 - (v / max) * 28 - 2; // 留 2px 边距，最高点贴顶
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width='100%' height='32' viewBox='0 0 120 32' preserveAspectRatio='none'>
      <polyline fill='none' stroke={stroke} strokeWidth='2' points={pts} />
    </svg>
  );
};

export { SEGMENT_PALETTE };
export default Sparkline;
