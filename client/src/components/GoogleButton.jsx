import { useEffect, useRef, useState } from 'react';
import { effectiveTheme } from '../theme.js';

const SRC = 'https://accounts.google.com/gsi/client';
let loading;

function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => {
      loading = undefined;
      reject(new Error('Could not load Google sign-in. Check your internet connection or ad blocker.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Official "Sign in with Google" button (Google Identity Services). On success it hands the signed
 * ID token to `onCredential`; the server verifies it. Used for both sign-in and sign-up.
 */
export default function GoogleButton({ clientId, onCredential, onError, text = 'continue_with' }) {
  const box = useRef(null);
  const [failed, setFailed] = useState(false);
  const cb = useRef(onCredential);
  const errCb = useRef(onError);
  cb.current = onCredential;
  errCb.current = onError;

  useEffect(() => {
    let alive = true;
    loadGoogle()
      .then(() => {
        if (!alive || !box.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => resp.credential && cb.current(resp.credential),
          ux_mode: 'popup',
        });
        const dark = effectiveTheme() === 'dark';
        box.current.innerHTML = '';
        window.google.accounts.id.renderButton(box.current, {
          type: 'standard',
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          logo_alignment: 'left',
          width: Math.min(360, box.current.clientWidth || 320),
        });
      })
      .catch((e) => {
        if (!alive) return;
        setFailed(true);
        errCb.current?.(e);
      });
    return () => {
      alive = false;
    };
  }, [clientId, text]);

  return failed ? null : <div ref={box} className="google-btn" />;
}
