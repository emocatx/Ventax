import { getToken } from '../api';

export function Title({ text, sub }: { text: string; sub?: string }) {
  return <div className="titlerow"><h1>{text}</h1>{sub && <p className="muted">{sub}</p>}</div>;
}

// Pantallas que todavía no se pasaron a la versión nueva: se abren en la clásica con la misma sesión.
export function Placeholder({ title }: { title: string }) {
  const open = () => window.open(`/legacy/#t=${getToken()}`, '_blank');
  return (
    <>
      <Title text={title} />
      <div className="card narrow">
        <p>Esta pantalla aún está en la versión clásica. Sigue funcionando igual: se abre en una pestaña nueva con tu misma sesión.</p>
        <button className="primary" onClick={open}>Abrir en la versión clásica</button>
      </div>
    </>
  );
}
