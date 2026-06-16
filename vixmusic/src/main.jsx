import { Capacitor } from '@capacitor/core';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-app');
}

createRoot(document.getElementById('root')).render(<App />);
