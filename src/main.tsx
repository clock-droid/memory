import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installVisualViewport } from './views/installVisualViewport';
import './styles.css';

installVisualViewport();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
