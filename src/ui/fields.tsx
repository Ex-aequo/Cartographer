import { useEffect, useRef, useState } from 'react';

export const hex = (c: [number, number, number]) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
export const rgb = (s: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];

// ------------------------------------------------------------ small fields

export function TextField({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

export function NumField({ value, onCommit, suffix, ...rest }: { value: number; onCommit(v: number): void; suffix?: string; 'aria-label'?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = Number(draft.replace(',', '.'));
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setDraft(String(value));
  };
  return (
    <span className="num">
      <input inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} {...rest} />
      {suffix && <span className="num__suffix">{suffix}</span>}
    </span>
  );
}

/** Colour picker that records one change when the picker closes, not one per drag. */
export function ColorInput({ color, onCommit, label }: { color: [number, number, number]; onCommit(c: [number, number, number]): void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const cb = useRef(onCommit);
  cb.current = onCommit;
  const cur = hex(color);
  useEffect(() => {
    const el = ref.current!;
    el.value = cur;
    const done = () => {
      if (el.value !== cur) cb.current(rgb(el.value));
    };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [cur]);
  return <input ref={ref} type="color" aria-label={label} />;
}
