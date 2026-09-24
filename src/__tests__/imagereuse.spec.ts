import { IStat } from '../channel';
import { ImageReuse, imageKey, imagePath } from '../imagereuse';

/**
 * jsdom loads no picture, so a load is an event this spec dispatches on an
 * image given a width, and the detached image the layer downloads into is
 * handed back to the test to finish.
 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const originalImage = window.Image;

const FIRST = '/files/doc/fig%201.png?1690000000001';
const RENDER = '/files/doc/fig%201.png?1690000000002';
const KEY = '/files/doc/fig%201.png';
const PATH = 'doc/fig 1.png';
const AT: IStat = { mtime: 1, size: 10 };
const MOVED: IStat = { mtime: 2, size: 12 };

function makeLayer() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const answers: ((value: Record<string, IStat | null> | null) => void)[] = [];
  const stat = jest.fn(
    () =>
      new Promise<Record<string, IStat | null> | null>(resolve =>
        answers.push(resolve)
      )
  );
  const listener = {
    beforeHandOver: jest.fn(),
    handedOver: jest.fn(),
    checked: jest.fn()
  };
  const downloads: HTMLImageElement[] = [];
  (window as any).Image = function () {
    const img = document.createElement('img');
    downloads.push(img);
    return img;
  };
  const layer = new ImageReuse({ host, stat, listener });
  const img = document.createElement('img');
  host.appendChild(img);
  return {
    host,
    img,
    stat,
    listener,
    downloads,
    layer,
    /** Answer the oldest stat still waiting. */
    answer: async (value: Record<string, IStat | null> | null) => {
      answers.shift()!(value);
      await flush();
    },
    /** Answer the stat waiting at that place in the queue. */
    answerAt: async (
      index: number,
      value: Record<string, IStat | null> | null
    ) => {
      answers.splice(index, 1)[0](value);
      await flush();
    },
    /** The picture at this address arrived. */
    load: (src: string) => {
      img.setAttribute('src', src);
      Object.defineProperty(img, 'naturalWidth', {
        configurable: true,
        value: 10
      });
      img.dispatchEvent(new Event('load'));
    },
    /** What rendermime does on every render. */
    render: async (src: string) => {
      img.setAttribute('src', src);
      await flush();
    }
  };
}

type Layer = ReturnType<typeof makeLayer>;

describe('imageKey', () => {
  it('takes away the time rendermime appends, after ? or &', () => {
    expect(imageKey('/files/a.png?1690000000001')).toBe('/files/a.png');
    expect(imageKey('/files/a.png?_xsrf=x&1690000000001')).toBe(
      '/files/a.png?_xsrf=x'
    );
  });

  it('answers null for an address with no time on it', () => {
    expect(imageKey('/files/a.png')).toBeNull();
    expect(imageKey('data:image/png;base64,AAAA')).toBeNull();
    expect(imageKey('/files/a.png?v=1690000000001')).toBeNull();
  });
});

describe('imagePath', () => {
  it('reads the contents path of a files address of this server', () => {
    expect(imagePath(KEY)).toBe(PATH);
    expect(imagePath('/files/a.png?_xsrf=x')).toBe('a.png');
  });

  it('answers null for an address elsewhere', () => {
    expect(imagePath('http://other.example/files/a.png')).toBeNull();
    expect(imagePath('/api/contents/a.png')).toBeNull();
  });
});

describe('ImageReuse', () => {
  let l: Layer;

  beforeEach(() => {
    l = makeLayer();
    l.load(FIRST);
  });

  afterEach(() => {
    l.layer.dispose();
    document.body.innerHTML = '';
    window.Image = originalImage;
  });

  it('puts back the address the picture last loaded under (ACC-APPLY-191)', async () => {
    await l.render(RENDER);
    expect(l.img.getAttribute('src')).toBe(FIRST);
    expect(l.stat).toHaveBeenCalledWith([PATH]);
  });

  it('checks every file of a render in one request', async () => {
    const second = document.createElement('img');
    l.host.appendChild(second);
    second.setAttribute('src', '/files/b.png?1690000000001');
    Object.defineProperty(second, 'naturalWidth', { value: 10 });
    second.dispatchEvent(new Event('load'));
    l.img.setAttribute('src', RENDER);
    second.setAttribute('src', '/files/b.png?1690000000002');
    await flush();
    expect(l.stat).toHaveBeenCalledTimes(1);
    expect([...(l.stat.mock.calls[0] as any)[0]].sort()).toEqual(
      [PATH, 'b.png'].sort()
    );
  });

  it('downloads a picture never checked once, then keeps it while its file stays', async () => {
    await l.render(RENDER);
    expect(l.layer.busy(l.img)).toBe(true);
    await l.answer({ [PATH]: AT });
    expect(l.downloads).toHaveLength(1);
    expect(l.layer.busy(l.img)).toBe(true);
    l.downloads[0].onload!(new Event('load'));
    const fresh = l.downloads[0].getAttribute('src');
    expect(l.img.getAttribute('src')).toBe(fresh);
    expect(l.listener.beforeHandOver).toHaveBeenCalledTimes(1);
    expect(l.listener.handedOver).toHaveBeenCalledTimes(1);
    expect(l.layer.busy(l.img)).toBe(false);

    // The next render puts that address back, and the same file downloads
    // nothing (ACC-APPLY-191).
    await l.render('/files/doc/fig%201.png?1690000000003');
    expect(l.img.getAttribute('src')).toBe(fresh);
    await l.answer({ [PATH]: AT });
    expect(l.downloads).toHaveLength(1);
    expect(l.listener.checked).toHaveBeenCalled();
  });

  it('downloads the picture again when its file changed (ACC-APPLY-188)', async () => {
    await l.render(RENDER);
    await l.answer({ [PATH]: AT });
    l.downloads[0].onload!(new Event('load'));
    await l.render('/files/doc/fig%201.png?1690000000003');
    await l.answer({ [PATH]: MOVED });
    expect(l.downloads).toHaveLength(2);
    l.downloads[1].onload!(new Event('load'));
    expect(l.img.getAttribute('src')).toBe(l.downloads[1].getAttribute('src'));
  });

  it('hands over a download that failed, so a file that is gone shows broken (ACC-APPLY-193)', async () => {
    await l.render(RENDER);
    await l.answer({ [PATH]: null });
    expect(l.downloads).toHaveLength(1);
    l.downloads[0].onerror!(new Event('error'));
    const failed = l.downloads[0].getAttribute('src');
    expect(l.img.getAttribute('src')).toBe(failed);
    // The failed address is not put back on the next render.
    await l.render('/files/doc/fig%201.png?1690000000004');
    expect(l.img.getAttribute('src')).toBe(
      '/files/doc/fig%201.png?1690000000004'
    );
  });

  it('downloads again when the stat itself failed', async () => {
    await l.render(RENDER);
    await l.answer(null);
    expect(l.downloads).toHaveLength(1);
  });

  it('drops an answer that comes back after a later one for the same file', async () => {
    await l.render(RENDER);
    await l.render('/files/doc/fig%201.png?1690000000003');
    expect(l.stat).toHaveBeenCalledTimes(2);
    // The later request is answered first and starts the one download; the
    // earlier answer, which reads differently, comes after it and is dropped.
    await l.answerAt(1, { [PATH]: AT });
    await l.answerAt(0, { [PATH]: MOVED });
    expect(l.downloads).toHaveLength(1);
  });

  it('leaves an address of another server as rendermime set it', async () => {
    l.load('http://other.example/files/a.png?1690000000001');
    await l.render('http://other.example/files/a.png?1690000000002');
    expect(l.img.getAttribute('src')).toBe(
      'http://other.example/files/a.png?1690000000002'
    );
    expect(l.stat).not.toHaveBeenCalled();
  });

  it('does nothing once disposed', async () => {
    l.layer.dispose();
    await l.render(RENDER);
    expect(l.img.getAttribute('src')).toBe(RENDER);
    expect(l.stat).not.toHaveBeenCalled();
  });
});
