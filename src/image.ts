/**
 * A picture in a Markdown preview as Copy image puts it on the clipboard
 * (ACC-COPY-198).
 *
 * The system clipboard takes a picture from a page only as PNG, so the picture
 * is drawn on a canvas at the size of its file and read back out as PNG.
 */

/**
 * Whether the picture can be copied: it has loaded, it is a raster picture,
 * and its address is the lab's own or a data address. A picture from another
 * site blocks the read of any canvas it is drawn on.
 *
 * An SVG picture, a drawn Mermaid diagram among them, is left to Copy as PNG
 * and Save as PNG of jupyterlab_export_svg_as_png_extension, which reads it by
 * the same two addresses (DEF-COPY-126).
 */
export function copiesAsImage(image: HTMLImageElement): boolean {
  const address = new URL(image.currentSrc || image.src, document.baseURI);
  const data = address.protocol === 'data:';
  const svg = data
    ? address.pathname.startsWith('image/svg+xml')
    : /\.svg$/i.test(address.pathname);
  return (
    image.naturalWidth > 0 &&
    !svg &&
    (data || address.origin === window.location.origin)
  );
}

/** The picture as PNG, at the size of its file. */
export function imageAsPng(image: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')?.drawImage(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      blob =>
        blob ? resolve(blob) : reject(new Error('the picture was not drawn')),
      'image/png'
    )
  );
}
