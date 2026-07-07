/**
 * Client-only pdfjs-dist bootstrap. pdfjs needs its worker script resolved to a
 * real URL the browser can load; the Vite `?url` import emits a hashed asset URL
 * for `pdf.worker.min.mjs` and wires it into `GlobalWorkerOptions.workerSrc`
 * once at module load. The DeckFlipViewer imports `pdfjsLib` from here so every
 * `getDocument` call shares the one configured worker.
 *
 * This module must only ever be imported from a CLIENT component (the viewer is
 * client-mounted in the section layer) — pdfjs + its worker asset have no place
 * in the server bundle.
 */
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
