'use client';

import { useEffect, useRef } from 'react';

/**
 * A dialog over the dashboard.
 *
 * The tabs used to be a numbered walkthrough — six steps, each unlocking the next. That reads
 * well once and badly every time after, because somebody returning already knows what they came
 * to change and has to walk past everything else to reach it. A table shows what exists; a
 * dialog is where one row gets edited.
 *
 * Escape closes it, the backdrop closes it, and focus moves inside on open so a keyboard never
 * ends up somewhere invisible behind it.
 */
export function Overlay({
  title,
  note,
  error,
  onClose,
  children,
}: {
  title: string;
  /** One line under the title, when the dialog needs a sentence rather than a form. */
  note?: string;
  /**
   * Whatever just failed, shown *inside* the dialog.
   *
   * It used to be rendered on the page behind this one, which meant a refused Freighter prompt
   * looked like nothing at all had happened: the button simply stopped saying "signing…". The
   * commonest failure in the whole app was also the most invisible.
   */
  error?: string | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const problem = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // Focus the first thing worth typing into, rather than leaving it on whatever opened this.
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, button');
    first?.focus();

    // The page behind must not scroll under the dialog.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // A long dialog can put its action well above the fold, so the message about that action has
  // to come to the reader rather than wait to be scrolled to.
  useEffect(() => {
    if (error) problem.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8"
      onMouseDown={(event) => {
        // Only a click that both starts and ends on the backdrop closes it, so a drag that began
        // inside the dialog does not dismiss the thing being edited.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="panel w-full max-w-[520px] p-6 pt-8 my-auto"
      >
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="text-base font-medium">{title}</h2>
          <button
            onClick={onClose}
            aria-label="close"
            className="text-[color:var(--faint)] hover:text-[color:var(--text)] cursor-pointer leading-none text-lg"
          >
            ×
          </button>
        </div>

        {note && (
          <p className="text-sm text-[color:var(--muted)] mb-5 max-w-[46ch] leading-relaxed">
            {note}
          </p>
        )}

        <div className={note ? '' : 'mt-5'}>{children}</div>

        {error && (
          <p
            ref={problem}
            role="alert"
            className="text-sm mt-5 pt-4 border-t border-[color:var(--line)] leading-relaxed"
            style={{ color: 'var(--drained)' }}
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** A labelled input. Every form in both dashboards is a stack of these. */
export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block mb-4">
      <span className="label block mb-1.5">{label}</span>
      <input
        {...input}
        className="w-full bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] px-3 py-2.5 text-sm num disabled:opacity-50"
      />
      {hint && <span className="label block mt-1.5 leading-relaxed">{hint}</span>}
    </label>
  );
}
