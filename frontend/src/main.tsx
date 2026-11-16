import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import { App } from './App';
import { applyTheme, readCachedTheme } from './lib/theme';

applyTheme(readCachedTheme()); // before the first paint, so a light theme never flashes dark

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
