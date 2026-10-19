import type { ComponentProps } from 'react';
import { useMediaSource } from './use-media-source';
import './preview-media.css';

export default function PreviewVideo({
  mediaSrc,
  ...props
}: Omit<ComponentProps<'video'>, 'src'> & { mediaSrc?: string }) {
  const source = useMediaSource(mediaSrc);
  return (
    <>
      <video {...props} src={source.src} aria-busy={source.status === 'loading' || undefined} />
      {source.status === 'loading' && (
        <div className="recorded-media-status" role="status">
          Loading video preview…
        </div>
      )}
      {source.status === 'error' && (
        <div className="recorded-media-status recorded-media-error" role="status">
          <span>{source.error}</span>
          <button type="button" onClick={source.retry}>
            Retry video preview
          </button>
        </div>
      )}
    </>
  );
}
