import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../store';
import { Modal } from './Modal';
import { PinPad } from './PinPad';

// Aviso flotante (con acción opcional) y diálogo global de autorización por PIN.
export function Toast() {
  const toast = useStore((s) => s.toast);
  return (
    <AnimatePresence>
      {toast && (
        <motion.div key={toast.id} className={`toast ${toast.err ? 'err' : ''}`} role="status"
          initial={{ opacity: 0, y: 16, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 16, x: '-50%' }} transition={{ duration: 0.2 }}>
          {toast.msg}
          {toast.action && <button onClick={() => { useStore.setState({ toast: null }); toast.action!.fn(); }}>{toast.action.label}</button>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PinDialog() {
  const req = useStore((s) => s.pinRequest);
  const finish = (pin: string | null) => { req?.resolve(pin); useStore.setState({ pinRequest: null }); };
  return (
    <Modal open={!!req} onClose={() => finish(null)} className="pin">
      <h2>Autorización</h2>
      <p className="muted" style={{ textAlign: 'center' }}>{req?.message}</p>
      <PinPad onSubmit={(pin) => finish(pin)} />
      <button type="button" className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => finish(null)}>Cancelar</button>
    </Modal>
  );
}
