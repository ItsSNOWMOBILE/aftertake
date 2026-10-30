import type { Server } from 'node:http';

export function routeOf(pathname: string): string;

export function parseCookies(header?: string): Record<string, string>;

export function createShareGateway(options: {
  studioPort: number;
  token: string;
  rendersPerVisitor?: number;
  rendersPerDay?: number;
  now?: () => number;
  log?: (message: string) => void;
  /** Told when someone opens the link, comes back or starts a render. */
  notify?: (message: string) => unknown;
}): Server;
export function storyboardWeight(body: Buffer): number;
export function takeSetWeight(body: Buffer): number;
