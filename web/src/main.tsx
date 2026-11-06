import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './extra.css';

// Tema: el guardado, o el del sistema
let saved: string | null = null;
try { saved = localStorage.getItem('theme'); } catch { /* sin almacenamiento */ }
document.documentElement.dataset.theme = saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
