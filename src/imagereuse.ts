/**
 * Keeps the images of a Markdown preview from being downloaded again on every
 * render.
 *
 * rendermime gives every local image a new address on every render: handleAttr
 * appends the time in milliseconds to it ("bust caching for local src attrs").
 * The browser downloads each image again and holds no picture, and so no
 * height, until it arrives, which moves every line below it (DEF-APPLY-116).
 * Each time the renderer sets such an address, this puts back the address the
 * same image last loaded under. The browser takes that picture from the
 * document's list of available images at once, at its size, with no request
 * (HTML Standard, "update the image data").
 *
 * The file may have changed since. After each render the files of the images
 * put back are stat'ed in one request and compared, mtime and size, with a
 * reading taken before their picture was downloaded. A file that moved, or one
 * never read, is downloaded under a new address in a detached image, which is
 * handed to the preview once it is complete, so the preview shows the old
 * picture until then and never an empty one.
 */

import { ServerConnection } from '@jupyterlab/services';
import { IDisposable } from '@lumino/disposable';

import { IStat } from './channel';

/**
 * The time rendermime's handleAttr appends to a local image address: `?` or
 * `&` and the milliseconds since 1970, at the very end.
 */
const CACHE_BUST = /[?&]\d{10,}$/;

/**
 * Answers mtime and size per path: null for a file that is not there, no entry
 * for a path that could not be answered, null for a request that failed.
 */
export type StatPaths = (
  paths: string[]
) => Promise<Record<string, IStat | null> | null>;

/**
 * What the image layer tells the layer that keeps the reader's place.
 */
export interface IImageListener {
  /**
   * New pictures are about to be set on preview images, which will change
   * their size in the same task.
   */
  beforeHandOver(): void;
  /**
   * New pictures were set on preview images. They were complete before the
   * hand-over, so the layout read now already has their size.
   */
  handedOver(): void;
  /**
   * A stat answer came in: an image the layer was still checking is decided.
   */
  checked(): void;
}

/**
 * Options for {@link ImageReuse}.
 */
export interface IImageReuseOptions {
  /**
   * The node the preview renders into.
   */
  host: HTMLElement;
  /**
   * How the files behind the images are stat'ed.
   */
  stat: StatPaths;
  /**
   * Told about hand-overs and stat answers.
   */
  listener: IImageListener;
}

/**
 * The address an image last loaded under, and the reading of its file taken
 * before that download; null where there was none.
 */
interface IEntry {
  url: string;
  reading: string | null;
}

/**
 * A download of a changed file under a new address, not yet handed over.
 */
interface IPending extends IEntry {
  image: HTMLImageElement;
}

/**
 * The address without the time rendermime appended, or null for an address
 * that carries none: an image not from this server, or a data address.
 */
export function imageKey(src: string): string | null {
  return CACHE_BUST.test(src) ? src.replace(CACHE_BUST, '') : null;
}

/**
 * The contents path of a files address of this server, or null for an address
 * elsewhere, which cannot be stat'ed and is downloaded as rendermime asks.
 */
export function imagePath(key: string): string | null {
  let url: URL;
  let files: URL;
  try {
    url = new URL(key, window.location.href);
    files = new URL(
      'files/',
      new URL(ServerConnection.makeSettings().baseUrl, url)
    );
  } catch {
    return null;
  }
  if (url.origin !== files.origin || !url.pathname.startsWith(files.pathname)) {
    return null;
  }
  try {
    return url.pathname
      .slice(files.pathname.length)
      .split('/')
      .map(decodeURIComponent)
      .join('/');
  } catch {
    return null;
  }
}

/**
 * A reading of a file that two readings of the same revision share.
 */
function reading(stat: IStat | null | undefined): string | null {
  return stat ? `${stat.mtime}|${stat.size}` : null;
}

/**
 * Puts back the address a preview image last loaded under, and downloads it
 * anew only when its file changed.
 */
export class ImageReuse implements IDisposable {
  constructor(options: IImageReuseOptions) {
    this._host = options.host;
    this._stat = options.stat;
    this._listener = options.listener;
    this._observer = new MutationObserver(this._onRecords);
    this._observer.observe(this._host, {
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
    // A load or an error does not bubble, so they are caught on the way down.
    this._host.addEventListener('load', this._onLoad, true);
    this._host.addEventListener('error', this._onError, true);
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Whether this layer may still change the picture of that image: a stat of
   * its file or a download of its new picture is outstanding.
   */
  busy(img: HTMLImageElement): boolean {
    const key = imageKey(img.getAttribute('src') ?? '');
    return (
      key !== null &&
      ((this._inFlight.get(key) ?? 0) > 0 || this._pending.has(key))
    );
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this._observer.disconnect();
    this._host.removeEventListener('load', this._onLoad, true);
    this._host.removeEventListener('error', this._onError, true);
    for (const pending of this._pending.values()) {
      pending.image.onload = null;
      pending.image.onerror = null;
    }
    this._pending.clear();
    this._entries.clear();
  }

  /**
   * rendermime set addresses on the images of a render: put back the address
   * each one last loaded under, then check their files in one request.
   *
   * This runs at the microtask checkpoint of the task that set them, before
   * the fetch those addresses queued and before any frame is painted, so the
   * browser never starts the download the renderer asked for.
   */
  private _onRecords = (records: MutationRecord[]): void => {
    const keys = new Set<string>();
    for (const record of records) {
      const img = record.target as HTMLImageElement;
      if (img.localName !== 'img') {
        continue;
      }
      const src = img.getAttribute('src') ?? '';
      if (this._own.get(img) === src) {
        continue;
      }
      const key = imageKey(src);
      const entry = key === null ? undefined : this._entries.get(key);
      // Nothing to put back for a picture never loaded, one already at the
      // address it loaded under, or one whose file cannot be stat'ed.
      if (!key || !entry || entry.url === src || imagePath(key) === null) {
        continue;
      }
      this._set(img, entry.url);
      keys.add(key);
    }
    if (keys.size) {
      void this._check([...keys]);
    }
  };

  /**
   * Compare each file with the reading taken before its picture was
   * downloaded, and download the ones that moved under a new address.
   *
   * Answers are applied in the order their requests were made: an answer that
   * comes back after a later one for the same file is dropped.
   */
  private async _check(keys: string[]): Promise<void> {
    const sequence = ++this._sequence;
    for (const key of keys) {
      this._inFlight.set(key, (this._inFlight.get(key) ?? 0) + 1);
    }
    const paths = new Map(keys.map(key => [key, imagePath(key) as string]));
    const answer = await this._stat([...paths.values()]);
    if (this._disposed) {
      return;
    }
    for (const key of keys) {
      this._inFlight.set(key, (this._inFlight.get(key) as number) - 1);
      if (sequence < (this._applied.get(key) ?? 0)) {
        continue;
      }
      this._applied.set(key, sequence);
      const now = answer === null ? null : reading(answer[paths.get(key)!]);
      const entry = this._entries.get(key);
      if (now !== null && entry && entry.reading === now) {
        continue;
      }
      // A file that moved, one never read, or one that could not be read now:
      // its picture is downloaded again, unless that same reading is already
      // on its way.
      const pending = this._pending.get(key);
      if (!pending || now === null || pending.reading !== now) {
        this._download(key, now);
      }
    }
    this._listener.checked();
  }

  /**
   * Download the picture under a new address in a detached image, and hand it
   * to the preview images of that file once it is complete. A download that
   * fails is handed over too, so a file that is gone shows as a broken image,
   * as the renderer would show it.
   */
  private _download(key: string, now: string | null): void {
    const separator = key.includes('?') ? '&' : '?';
    const pending: IPending = {
      url: `${key}${separator}${Date.now()}`,
      reading: now,
      image: new Image()
    };
    this._pending.set(key, pending);
    const done = (loaded: boolean) => {
      if (this._disposed || this._pending.get(key) !== pending) {
        return;
      }
      this._pending.delete(key);
      if (loaded) {
        this._entries.set(key, { url: pending.url, reading: pending.reading });
      } else {
        this._entries.delete(key);
      }
      const targets = this._imagesOf(key).filter(
        img => img.getAttribute('src') !== pending.url
      );
      if (targets.length) {
        this._listener.beforeHandOver();
        for (const img of targets) {
          this._set(img, pending.url);
        }
        this._listener.handedOver();
      }
      this._listener.checked();
    };
    pending.image.onload = () => done(true);
    pending.image.onerror = () => done(false);
    pending.image.src = pending.url;
  }

  /**
   * An image of the preview loaded: remember its address, with no reading,
   * so the next render puts it back and checks its file.
   */
  private _onLoad = (event: Event): void => {
    const img = event.target as HTMLImageElement;
    if (img.localName !== 'img' || img.naturalWidth === 0) {
      return;
    }
    const src = img.getAttribute('src') ?? '';
    const key = imageKey(src);
    if (key === null || this._entries.get(key)?.url === src) {
      return;
    }
    this._entries.set(key, { url: src, reading: null });
  };

  /**
   * An address that failed is not put back.
   */
  private _onError = (event: Event): void => {
    const img = event.target as HTMLImageElement;
    if (img.localName !== 'img') {
      return;
    }
    const src = img.getAttribute('src') ?? '';
    const key = imageKey(src);
    if (key !== null && this._entries.get(key)?.url === src) {
      this._entries.delete(key);
    }
  };

  /**
   * The preview images showing that file.
   */
  private _imagesOf(key: string): HTMLImageElement[] {
    return Array.from(this._host.querySelectorAll('img')).filter(
      img => imageKey(img.getAttribute('src') ?? '') === key
    );
  }

  /**
   * Set an address this layer chose, so its own mutation record is passed by.
   */
  private _set(img: HTMLImageElement, url: string): void {
    this._own.set(img, url);
    img.setAttribute('src', url);
  }

  private _host: HTMLElement;
  private _stat: StatPaths;
  private _listener: IImageListener;
  private _observer: MutationObserver;
  private _entries = new Map<string, IEntry>();
  private _pending = new Map<string, IPending>();
  private _inFlight = new Map<string, number>();
  private _applied = new Map<string, number>();
  private _own = new WeakMap<HTMLImageElement, string>();
  private _sequence = 0;
  private _disposed = false;
}
