/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tooltip } from '@arco-design/web-react';
import { formatTokens } from './chartMath';

type RankRow = { id?: string; label: string; value: number; tag?: string };

const RankBar: React.FC<{ rows: RankRow[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-secondary, #86909c)', fontSize: 12, padding: '8px 0' }}>—</div>;
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div
          key={r.id ?? r.label}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, margin: '4px 0' }}
        >
          <Tooltip content={r.tag ? `${r.tag} · ${r.label}` : r.label} position='top'>
            <span
              style={{
                width: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'default',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {r.tag && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '0 4px',
                    borderRadius: 2,
                    background: 'var(--color-fill, #e5e6eb)',
                    color: 'var(--text-secondary, #86909c)',
                    flexShrink: 0,
                  }}
                >
                  {r.tag}
                </span>
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
            </span>
          </Tooltip>
          <div style={{ flex: 1, background: 'var(--color-fill, #e5e6eb)', borderRadius: 3 }}>
            <div
              style={{
                width: `${Math.max((r.value / max) * 100, 2)}%`,
                background: 'var(--primary, #165dff)',
                height: 14,
                borderRadius: 3,
              }}
            />
          </div>
          <span style={{ width: 54, textAlign: 'right' }}>{formatTokens(r.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default RankBar;
