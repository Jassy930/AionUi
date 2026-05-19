/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { TrendPoint } from '@/common/types/agentUsage';

// Arco Design official categorical sequence. Bright, saturated hues with high
// contrast on BOTH light and dark backgrounds (avoids the muted blue-grey
// #7583b2 and dim #165dff that were hard to read). Adjacent colors are
// hue-distinct (blue → green → orange ...) so stacked segments separate
// clearly even with only two segments.
const SEGMENT_PALETTE = ['#3491FA', '#00B42A', '#FF7D00', '#F53F3F', '#722ED1', '#14C9C9', '#F7BA1E', '#D91AD9'];

const TrendChart: React.FC<{ points: TrendPoint[] }> = ({ points }) => {
  const { t } = useTranslation();

  // Build stable sorted list of all distinct segment names across all points
  const allSegments = React.useMemo(() => {
    const nameSet = new Set<string>();
    for (const p of points) {
      for (const name of Object.keys(p.bySegment)) {
        nameSet.add(name);
      }
    }
    return Array.from(nameSet).toSorted();
  }, [points]);

  // Map segment name → color (stable, cycles if > palette length)
  const segmentColor = React.useMemo(
    () => new Map(allSegments.map((name, i) => [name, SEGMENT_PALETTE[i % SEGMENT_PALETTE.length]])),
    [allSegments]
  );

  const max = Math.max(1, ...points.map((p) => Object.values(p.bySegment).reduce((s, v) => s + v, 0)));

  if (points.length === 0) {
    return (
      <Card title={t('usageStats.trend.title')} bordered style={{ marginBottom: 16 }}>
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>—</span>
        </div>
      </Card>
    );
  }

  return (
    <Card title={t('usageStats.trend.title')} bordered style={{ marginBottom: 16 }}>
      {/* Legend */}
      {allSegments.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 12px',
            marginBottom: 10,
          }}
        >
          {allSegments.map((name) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: segmentColor.get(name),
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Bar chart */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130, overflowX: 'auto' }}>
        {points.map((p) => {
          const total = Object.values(p.bySegment).reduce((s, v) => s + v, 0);
          // Clamp on whole bar; individual segments share the clamped height proportionally
          const barHeight = total > 0 ? Math.max((total / max) * 130, 4) : 0;

          // Sort segments by value desc for tooltip display
          const sortedSegments = Object.entries(p.bySegment)
            .filter(([, v]) => v > 0)
            .toSorted(([, a], [, b]) => b - a);

          const tooltipContent = (
            <div style={{ minWidth: 120, maxWidth: 240 }}>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>{p.bucket}</div>
              <div style={{ marginBottom: 4, fontSize: 12 }}>
                {t('usageStats.trend.tooltipTotal')}: {total.toLocaleString()}
              </div>
              {sortedSegments.map(([name, val]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, marginTop: 2 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: 1,
                      background: segmentColor.get(name),
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 160,
                    }}
                  >
                    {name}
                  </span>
                  <span style={{ marginLeft: 'auto', paddingLeft: 8, flexShrink: 0 }}>{val.toLocaleString()}</span>
                </div>
              ))}
            </div>
          );

          return (
            <div key={p.bucket} style={{ textAlign: 'center', minWidth: 28 }}>
              <Tooltip content={tooltipContent} mini>
                {/* Stacked bar: each segment is a sub-rect */}
                <div
                  style={{
                    height: `${barHeight}px`,
                    display: 'flex',
                    flexDirection: 'column-reverse',
                    borderRadius: 2,
                    overflow: 'hidden',
                    cursor: 'default',
                  }}
                >
                  {total > 0
                    ? sortedSegments.map(([name, val]) => {
                        const segHeight = (val / total) * barHeight;
                        return (
                          <div
                            key={name}
                            style={{
                              height: `${segHeight}px`,
                              background: segmentColor.get(name),
                              flexShrink: 0,
                            }}
                          />
                        );
                      })
                    : null}
                </div>
              </Tooltip>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-secondary)',
                  marginTop: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                {p.bucket.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default TrendChart;
