import { createRoot } from 'react-dom/client';
import '@fontsource/im-fell-english-sc/400.css';
import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import './styles.css';
import { App } from './App';
import { registerServiceWorker } from './platform';

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <App />,
);
