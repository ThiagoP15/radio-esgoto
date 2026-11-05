import { useEffect, useState } from 'react';

export default function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const onToast = (event) => {
      const item = event.detail;
      setItems((list) => [...list.slice(-3), item]);
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== item.id)), 6000);
    };
    window.addEventListener('toast', onToast);
    return () => window.removeEventListener('toast', onToast);
  }, []);

  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((item) => (
        <p key={item.id} className={`toast toast-${item.kind}`}>
          {item.message}
        </p>
      ))}
    </div>
  );
}
