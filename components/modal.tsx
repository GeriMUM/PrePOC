"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ title, closeLabel, onClose, children, wide = false }: {
  title: string; closeLabel: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const focused = document.activeElement;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
      if (focused instanceof HTMLElement) focused.focus();
    };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? "wide" : ""}`}
    aria-labelledby="modal-title" onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-head"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label={closeLabel}>×</button></div>
    {children}
  </dialog>;
}
