import { describe, it, expect } from 'vitest';
import { buildBackendHeaders } from '../../../packages/web-host/src/static-server.js';

describe('buildBackendHeaders', () => {
  it('injects webui-remote=1 when allowRemote and strips client-forged header', () => {
    const h = buildBackendHeaders({ host: 'evil', 'x-aionui-webui-remote': '0' }, 9999, true);
    expect(h['x-aionui-webui-remote']).toBe('1');
    expect(h.host).toBe('127.0.0.1:9999');
  });
  it('strips header entirely when not remote (local Electron path)', () => {
    const h = buildBackendHeaders({ 'x-aionui-webui-remote': '1' }, 9999, false);
    expect(h['x-aionui-webui-remote']).toBeUndefined();
  });
});
