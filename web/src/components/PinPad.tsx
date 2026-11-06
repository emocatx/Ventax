import { useEffect, useRef, useState } from 'react';

// Teclado numérico de PIN (4 dígitos): táctil y con teclado físico. Entra solo al completar los 4.
export function PinPad({ onSubmit, error, disabled = false }: { onSubmit: (pin: string) => void; error?: string; disabled?: boolean }) {
  const [pin, setPin] = useState('');
  const pinRef = useRef('');
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  const press = (k: string) => {
    if (disabled) return;
    let next = pinRef.current;
    if (k === 'back') next = next.slice(0, -1);
    else if (next.length < 4) next += k;
    else return;
    pinRef.current = next;
    setPin(next);
    if (next.length === 4) {
      window.setTimeout(() => { pinRef.current = ''; setPin(''); submitRef.current(next); }, 120);
    }
  };
  const pressRef = useRef(press);
  pressRef.current = press;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) pressRef.current(e.key);
      else if (e.key === 'Backspace') pressRef.current('back');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div>
      <div className="pindots" aria-live="polite">{[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
      <div className="pinhint">PIN de 4 dígitos</div>
      <div className="pinmsg" role="alert">{error}</div>
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => <button type="button" key={n} onClick={() => press(n)}>{n}</button>)}
        <button type="button" aria-label="Borrar" onClick={() => press('back')}>⌫</button>
        <button type="button" onClick={() => press('0')}>0</button>
        <span />
      </div>
    </div>
  );
}
