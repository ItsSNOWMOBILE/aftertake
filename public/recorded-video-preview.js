// Static hosts may serve an MP4 without byte ranges. A local blob restores
// normal seeking while preserving the recorded file's bytes.
for (const video of document.querySelectorAll('video')) {
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.hidden = true;
  status.style.cssText = 'font-size:12px;line-height:1.6;color:#bfd19f;margin:10px 0';
  video.after(status);
  let prepared = false,
    pending;
  function prepare() {
    if (pending) return pending;
    const source = video.currentSrc || video.querySelector('source')?.src;
    status.hidden = false;
    status.textContent = 'Preparing video preview…';
    pending = (async () => {
      const response = await fetch(source);
      if (!response.ok) throw Error('Could not load the video. Reload to retry.');
      const blob = new Blob([await response.arrayBuffer()], { type: 'video/mp4' });
      await new Promise((resolve, reject) => {
        const done = () => {
          video.removeEventListener('error', failed);
          resolve();
        };
        const failed = () => {
          video.removeEventListener('loadedmetadata', done);
          reject(Error('The video could not be decoded. Download the MP4 instead.'));
        };
        video.addEventListener('loadedmetadata', done, { once: true });
        video.addEventListener('error', failed, { once: true });
        video.src = URL.createObjectURL(blob);
        video.load();
      });
      prepared = true;
      status.hidden = true;
    })();
    return pending;
  }
  video.addEventListener('play', () => {
    if (prepared) return;
    video.pause();
    prepare()
      .then(() => video.play())
      .catch((error) => {
        status.hidden = false;
        status.textContent = prepared ? 'Preview ready. Press Play to continue.' : error.message;
      });
  });
}
