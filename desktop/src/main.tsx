import ReactDOM from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import { Providers } from '@/app/providers';
import { App } from '@/App';
import { installLogCapture } from '@/lib/app-log';
import '@/index.css';

// Capture console/global errors before React renders so the diagnostics screen
// can show what happened in a release build.
installLogCapture();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <Providers>
    <App />
  </Providers>,
);
