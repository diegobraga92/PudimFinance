import ReactDOM from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import { Providers } from '@/app/providers';
import { App } from '@/App';
import '@/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <Providers>
    <App />
  </Providers>,
);
