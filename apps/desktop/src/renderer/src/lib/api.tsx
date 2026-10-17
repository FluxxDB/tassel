// The API client for the renderer: the shared typed client, authenticated through the preload
// bridge's device token, and handed to components through context.
import { type ApiClient, createApiClient } from '@tassel/shared/api';
import { createContext, type ReactNode, useContext } from 'react';
import type { TasselBridge } from '../../../shared/bridge';

/** A client for the server at `serverUrl` (absolute), carrying the bridge's device token. */
export function apiClientFromBridge(
  serverUrl: string,
  bridge: Pick<TasselBridge, 'getToken' | 'refreshToken'> = window.tassel,
): ApiClient {
  return createApiClient({
    baseUrl: serverUrl,
    getToken: () => bridge.getToken(),
    refreshToken: () => bridge.refreshToken(),
  });
}

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext value={client}>{children}</ApiContext>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>');
  return client;
}
