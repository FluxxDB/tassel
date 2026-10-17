// The server's API for the app. `pnpm gen:api` regenerates openapi.json and schema.d.ts from
// the server, and `pnpm check:api` fails when they are stale.
export * from './client';
export type { components, paths } from './schema';
