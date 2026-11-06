import { useEffect } from 'react';
import { useStore } from './store';
import { Gate } from './components/Gate';
import { Shell } from './components/Shell';
import { PinDialog, Toast } from './components/Overlays';

export default function App() {
  const ready = useStore((s) => s.ready);
  const user = useStore((s) => s.user);
  useEffect(() => { void useStore.getState().boot(); }, []);
  if (!ready) return null;
  return (
    <>
      {user ? <Shell /> : <Gate />}
      <PinDialog />
      <Toast />
    </>
  );
}
