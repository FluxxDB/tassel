import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

// A placeholder until Task 10 adds the app shell.
createRoot(root).render(
  <StrictMode>
    <h1>Tassel</h1>
  </StrictMode>,
);
