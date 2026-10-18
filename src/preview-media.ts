type RecordedPreviewSources = {
  clips: { kind?: 'image' | 'video'; url: string }[];
  renders: { output?: string }[];
  templates: { source: string; result: string }[];
};

export async function cacheRecordedVideos(snapshot: RecordedPreviewSources, resolve: (url: string) => string, options: {
  fetch?: (url: string) => Promise<Response>;
  createURL?: (blob: Blob) => string;
  revokeURL?: (url: string) => void;
  progress?: (completed: number, total: number) => void;
} = {}): Promise<Map<string, string>> {
  const urls = [...new Set([
    ...snapshot.clips.filter(clip => clip.kind !== 'image').map(clip => clip.url),
    ...snapshot.renders.map(render => render.output || ''),
    ...snapshot.templates.flatMap(template => [template.source, template.result]),
  ].map(resolve).filter(url => /\.mp4$/i.test(url)))];
  const fetchMedia = options.fetch || (url => fetch(url)), createURL = options.createURL || (blob => URL.createObjectURL(blob)), revokeURL = options.revokeURL || (url => URL.revokeObjectURL(url));
  const cached = new Map<string, string>();
  options.progress?.(0, urls.length);
  try {
    for (let offset = 0; offset < urls.length; offset += 4) {
      const batch = urls.slice(offset, offset + 4);
      const blobs = await Promise.all(batch.map(async url => {
        const response = await fetchMedia(url);
        if (!response.ok) throw Error('Could not download a recorded preview.');
        return new Blob([await response.arrayBuffer()], { type: 'video/mp4' });
      }));
      batch.forEach((url, index) => cached.set(url, createURL(blobs[index])));
      options.progress?.(cached.size, urls.length);
    }
    return cached;
  } catch (error) {
    for (const url of cached.values()) revokeURL(url);
    throw error;
  }
}
