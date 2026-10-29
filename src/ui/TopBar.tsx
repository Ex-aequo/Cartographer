import { useEffect, useRef, useState } from 'react';
import type { Quality } from '../render/MapRenderer';

export interface ExportItem {
  label: string;
  hint: string;
  run(): void;
  disabled?: boolean;
}

interface Props {
  quality: Quality;
  onQuality(q: Quality): void;
  name: string;
  hasMap: boolean;
  onOpen(file: File): void;
  onSave(): void;
  exports: ExportItem[];
}

export function TopBar({ quality, onQuality, name, hasMap, onOpen, onSave, exports }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  return (
    <header className="topbar">
      <div className="wordmark">
        <svg viewBox="0 0 32 32" aria-hidden className="wordmark__rose">
          <path d="M16 1.5l3 11.5 11.5 3-11.5 3-3 11.5-3-11.5L1.5 16 13 13z" />
          <circle cx="16" cy="16" r="2.2" />
        </svg>
        <span>Cartographer</span>
        {hasMap && <em className="wordmark__map">{name}</em>}
      </div>
      <div className="topbar__actions">
        <label className="quality" title="Lower quality draws faster on slower graphics cards">
          <span>Quality</span>
          <select value={quality} onChange={(e) => onQuality(e.target.value as Quality)}>
            <option value="high">High</option>
            <option value="balanced">Balanced</option>
            <option value="fast">Fast</option>
          </select>
        </label>
        <button className="btn btn--ghost" onClick={() => fileInput.current?.click()}>
          Open
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".cartomap,.json,application/json,application/gzip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onOpen(f);
            e.target.value = '';
          }}
        />
        <button className="btn btn--ghost" onClick={onSave} disabled={!hasMap}>
          Save
        </button>
        <div className="menu" ref={menuRef}>
          <button className="btn btn--ghost" onClick={() => setMenu(!menu)} disabled={!hasMap} aria-expanded={menu} aria-haspopup="menu">
            Export
          </button>
          {menu && (
            <div className="menu__list" role="menu">
              {exports.map((x) => (
                <button
                  key={x.label}
                  role="menuitem"
                  disabled={x.disabled}
                  onClick={() => {
                    setMenu(false);
                    x.run();
                  }}
                >
                  {x.label}
                  <small>{x.hint}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
