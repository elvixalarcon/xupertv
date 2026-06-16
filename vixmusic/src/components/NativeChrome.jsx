import { createPortal } from 'react-dom';
import { isNativeApp } from '../lib/platform';

/** Fija la barra inferior fuera del árbol que hace scroll (evita que se mueva en iOS). */
export default function NativeChrome({ children }) {
  if (!isNativeApp()) return children;
  return createPortal(<div className="native-chrome">{children}</div>, document.body);
}
