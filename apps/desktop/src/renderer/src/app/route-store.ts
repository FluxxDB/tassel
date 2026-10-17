// Which screen is showing. Two screens don't need a router: the library, or one session.
import { create } from 'zustand';

export type Route = { name: 'library' } | { name: 'session'; sessionId: string };

interface RouteStore {
  route: Route;
  goLibrary(): void;
  openSession(id: string): void;
}

export const useRoute = create<RouteStore>()((set) => ({
  route: { name: 'library' },
  goLibrary: () => set({ route: { name: 'library' } }),
  openSession: (sessionId) => set({ route: { name: 'session', sessionId } }),
}));
