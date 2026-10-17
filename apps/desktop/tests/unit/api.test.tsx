// @vitest-environment jsdom
import { listSessions } from '@tassel/shared/api';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider, apiClientFromBridge, useApi } from '../../src/renderer/src/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('apiClientFromBridge', () => {
  it("calls the server with the bridge's device token", async () => {
    const fetch = vi.fn(async (_request: Request) => Response.json({ items: [] }));
    vi.stubGlobal('fetch', fetch);
    const bridge = { getToken: vi.fn(async () => 'token-1'), refreshToken: vi.fn() };
    const api = apiClientFromBridge('http://127.0.0.1:8799', bridge);

    await expect(listSessions(api, 'recent')).resolves.toEqual([]);

    const request = fetch.mock.calls[0][0];
    expect(request.url).toBe('http://127.0.0.1:8799/v1/sessions?sort=recent');
    expect(request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(bridge.refreshToken).not.toHaveBeenCalled();
  });
});

describe('useApi', () => {
  it('returns the client from ApiProvider', () => {
    const api = apiClientFromBridge('http://127.0.0.1:8799', {
      getToken: async () => 't',
      refreshToken: async () => 't',
    });
    function Probe() {
      return <p>{useApi() === api ? 'same client' : 'other client'}</p>;
    }
    render(
      <ApiProvider client={api}>
        <Probe />
      </ApiProvider>,
    );
    expect(screen.getByText('same client')).toBeInTheDocument();
  });

  it('throws a clear error outside ApiProvider', () => {
    function Probe() {
      useApi();
      return null;
    }
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useApi must be used inside <ApiProvider>');
  });
});
