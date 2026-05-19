/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

const fmt = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const RankBar: React.FC<{ rows: { label: string; value: number }[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-secondary, #86909c)', fontSize: 12, padding: '8px 0' }}>—</div>;
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, margin: '4px 0' }}>
          <span style={{ width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <div style={{ flex: 1, background: 'var(--color-fill, #e5e6eb)', borderRadius: 3 }}>
            <div
              style={{
                width: `${Math.max((r.value / max) * 100, 2)}%`,
                background: 'var(--primary)',
                height: 14,
                borderRadius: 3,
              }}
            />
          </div>
          <span style={{ width: 54, textAlign: 'right' }}>{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default RankBar;
