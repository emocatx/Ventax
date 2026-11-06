import { useEffect, useRef, type ReactNode } from 'react';

// Diálogo nativo (<dialog>): foco atrapado, Esc para cerrar y fondo bloqueado sin dependencias extra.
export function Modal({ open, onClose, children, wide = false, className = '' }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`${wide ? 'wide' : ''} ${className}`} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open ? children : null}
    </dialog>
  );
}
