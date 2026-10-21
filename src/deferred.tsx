import { lazy, Suspense, type ComponentProps, type ComponentType } from 'react';

const loaders: (() => Promise<unknown>)[] = [];

/** A component whose code loads on first render, inside its own Suspense boundary. */
export function deferred<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  const Lazy = lazy(load);
  loaders.push(load);
  return function Deferred(props: ComponentProps<T>) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

/** Fetch every deferred component once the page is idle, so opening one stays instant. */
export function preloadDeferred() {
  const start = () => loaders.forEach((load) => void load().catch(() => {}));
  if ('requestIdleCallback' in window) {
    const handle = window.requestIdleCallback(start, { timeout: 4000 });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = setTimeout(start, 2000);
  return () => clearTimeout(timer);
}
