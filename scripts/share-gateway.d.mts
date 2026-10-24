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
}): Server;
export function storyboardWeight(body: Buffer): number;
export function takeSetWeight(body: Buffer): number;
