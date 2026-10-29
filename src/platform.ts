/**
 * The few things that differ between the web app and the desktop app:
 * saving files (a download in the browser, a native Save dialog on desktop)
 * and offline support (a service worker on the web only).
 */

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function saveFile(blob: Blob, name: string): Promise<boolean> {
  if (isDesktop) {
    const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
    const path = await save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined });
    if (!path) return false;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/** Offline support for the installed web app. */
export function registerServiceWorker(): void {
  if (isDesktop || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is optional */
    });
  });
}
