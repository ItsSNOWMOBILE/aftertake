import { createRoot } from 'react-dom/client';
import App from './App';
import { initializeTransport } from './transport';
initializeTransport().then(() => createRoot(document.getElementById('root')!).render(<App/>)).catch(() => {
  const root = document.getElementById('root')!;
  root.textContent = 'The browser examples could not load. Reload the page, or get the local studio from github.com/ItsSNOWMOBILE/aftertake.';
});
