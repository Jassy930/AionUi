/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createRateLimiter } from '../../../src/process/webserver/middleware/rateLimiter';

function mockReq(overrides?: Partial<Request>): Request {
  return {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    user: undefined,
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _status: number; _body: unknown; _headers: Record<string, string> } {
  const res = {
    _status: 200,
    _body: undefined,
    _headers: {} as Record<string, string>,
    _listeners: {} as Record<string, Array<() => void>>,
    statusCode: 200,
    status(code: number) {
      res._status = code;
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res._body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value;
      return res;
    },
    on(event: string, fn: () => void) {
      if (!res._listeners[event]) res._listeners[event] = [];
      res._listeners[event].push(fn);
      return res;
    },
    emit(event: string) {
      (res._listeners[event] || []).forEach((fn) => fn());
    },
  };
  return res as unknown as Response & { _status: number; _body: unknown; _headers: Record<string, string> };
}

describe('rateLimiter', () => {
  const limiters: Array<{ destroy: () => void }> = [];

  afterEach(() => {
    limiters.forEach((l) => l.destroy());
    limiters.length = 0;
  });

  it('allows requests within the limit', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 3 });
    limiters.push(limiter);

    const req = mockReq();
    const res = mockRes();
    let called = false;
    const next: NextFunction = () => {
      called = true;
    };

    limiter(req, res, next);
    expect(called).toBe(true);
    expect(res._headers['X-RateLimit-Remaining']).toBe('2');
  });

  it('blocks requests exceeding the limit with 429', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
    limiters.push(limiter);

    const req = mockReq();

    // First two requests pass
    for (let i = 0; i < 2; i++) {
      const res = mockRes();
      let called = false;
      limiter(req, res, () => {
        called = true;
      });
      expect(called).toBe(true);
    }

    // Third request is blocked
    const res = mockRes();
    let blocked = true;
    limiter(req, res, () => {
      blocked = false;
    });
    expect(blocked).toBe(true);
    expect(res._status).toBe(429);
    expect(res._headers['Retry-After']).toBeDefined();
  });

  it('sets rate limit headers on every response', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 5 });
    limiters.push(limiter);

    const res = mockRes();
    limiter(mockReq(), res, () => {});

    expect(res._headers['X-RateLimit-Limit']).toBe('5');
    expect(res._headers['X-RateLimit-Remaining']).toBe('4');
    expect(res._headers['X-RateLimit-Reset']).toBeDefined();
  });

  it('tracks different IPs separately', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
    limiters.push(limiter);

    // First IP — allowed
    const res1 = mockRes();
    let called1 = false;
    limiter(mockReq({ ip: '1.1.1.1' }), res1, () => {
      called1 = true;
    });
    expect(called1).toBe(true);

    // Second IP — also allowed (different key)
    const res2 = mockRes();
    let called2 = false;
    limiter(mockReq({ ip: '2.2.2.2' }), res2, () => {
      called2 = true;
    });
    expect(called2).toBe(true);

    // First IP again — blocked
    const res3 = mockRes();
    let blocked = true;
    limiter(mockReq({ ip: '1.1.1.1' }), res3, () => {
      blocked = false;
    });
    expect(blocked).toBe(true);
    expect(res3._status).toBe(429);
  });

  it('supports custom keyGenerator (per-user limiting)', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 1,
      keyGenerator: (req) => (req as unknown as { user?: { id: string } }).user?.id || req.ip || 'unknown',
    });
    limiters.push(limiter);

    const userReq = mockReq({ user: { id: 'user-1' } } as unknown as Partial<Request>);

    // First request — allowed
    let called = false;
    limiter(userReq, mockRes(), () => {
      called = true;
    });
    expect(called).toBe(true);

    // Second request same user — blocked
    const res = mockRes();
    let blocked = true;
    limiter(userReq, res, () => {
      blocked = false;
    });
    expect(blocked).toBe(true);
    expect(res._status).toBe(429);
  });

  it('skips requests when skip function returns true', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 1,
      skip: (req) => req.ip === '10.0.0.1',
    });
    limiters.push(limiter);

    const skipReq = mockReq({ ip: '10.0.0.1' });

    // Skipped requests don't count
    for (let i = 0; i < 5; i++) {
      let called = false;
      limiter(skipReq, mockRes(), () => {
        called = true;
      });
      expect(called).toBe(true);
    }
  });

  it('uses custom error message', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 1,
      message: 'Slow down!',
    });
    limiters.push(limiter);

    limiter(mockReq(), mockRes(), () => {});

    const res = mockRes();
    limiter(mockReq(), res, () => {});
    expect(res._status).toBe(429);
    expect((res._body as { error: string }).error).toBe('Slow down!');
  });

  it('decrements count on successful response when skipSuccessfulRequests is true', () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 1,
      skipSuccessfulRequests: true,
    });
    limiters.push(limiter);

    const res1 = mockRes();
    res1.statusCode = 200;
    limiter(mockReq(), res1, () => {});
    // Simulate response finish
    res1.emit('finish');

    // Should be allowed again since previous was successful
    const res2 = mockRes();
    let called = false;
    limiter(mockReq(), res2, () => {
      called = true;
    });
    expect(called).toBe(true);
  });
});
