import { toastError } from "@/lib/toast";

import { saveBlob } from "./download";
import { isNativePlatform } from "./platform";

type Html2PdfChain = {
  set(opts: Record<string, unknown>): Html2PdfChain;
  from(source: string, type: "string"): Html2PdfChain;
  outputPdf(kind: "blob"): Promise<Blob>;
};

/** Native: no window.print(), so the document becomes a PDF and goes to the share sheet. */
async function printAsPdf(html: string, filename: string): Promise<void> {
  try {
    const mod = (await import("html2pdf.js")) as unknown as { default: () => Html2PdfChain };
    const blob = await mod
      .default()
      .set({
        margin: 10,
        filename,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(html, "string")
      .outputPdf("blob");
    saveBlob(blob, filename);
  } catch (err) {
    toastError(err, { fallback: "Couldn't prepare the PDF.", context: "printHtml.native" });
  }
}

/**
 * Print a self-contained HTML document (receipts, salary slips, exam papers,
 * timetables, flyers).
 *
 * Web: a popup window that prints itself, falling back to a hidden iframe
 * when the popup is blocked. Native (Phase 2): the document is rendered to a
 * PDF (lazy html2pdf) and handed to `saveBlob`, because WebViews implement
 * neither `window.print()` nor `window.open("", "_blank")`.
 *
 * `html` is the FULL document (`<!DOCTYPE html>...`), as every call site
 * already builds. Resolves when the print dialog has been handed off; the
 * user may still cancel it.
 */
export interface PrintOptions {
  /** File name used when the document is delivered as a PDF (native shell). */
  filename?: string;
  /** Popup size hint; ignored by the iframe fallback. */
  width?: number;
  height?: number;
  /**
   * Delay before calling print() once the document has loaded and its images
   * have settled, for fonts that need a moment. Defaults to 500ms, the value
   * the call sites converged on.
   */
  settleMs?: number;
  /**
   * Upper bound on waiting for images. Question diagrams and logos are network
   * images, and printing before they decode gives blank figure slots, so the
   * document waits for every <img> to load or fail, but never longer than
   * this. Defaults to 5000ms (what printExamPaper used to do on its own).
   */
  imageTimeoutMs?: number;
  /** Close the popup after printing (default true). */
  closeAfter?: boolean;
}

const DEFAULTS = { width: 800, height: 600, settleMs: 500, imageTimeoutMs: 5000, closeAfter: true };

export function printHtml(html: string, options: PrintOptions = {}): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  if (isNativePlatform()) {
    const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
    return printAsPdf(html, options.filename ?? `${title || "document"}.pdf`);
  }

  const opts = { ...DEFAULTS, ...options };
  const win = window.open("", "_blank", `width=${opts.width},height=${opts.height}`);
  if (!win) return printViaIframe(html, opts);
  return printInWindow(win, html, opts);
}

/** A print whose window is already open, waiting for its document. */
export interface PendingPrint {
  /** Writes the document into the waiting window and prints it. */
  print: (html: string, options?: PrintOptions) => Promise<void>;
  /** Closes the waiting window, e.g. when building the document failed. */
  cancel: () => void;
}

const PREPARING_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preparing your report</title></head>
<body style="margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;color:#475569;background:#f8fafc">
<p style="font-size:15px">Preparing your report...</p></body></html>`;

/**
 * For a document that is built AFTER an await (a slow fetch). Call this inside
 * the click handler: the popup opens now, while the browser still counts the
 * click as a user gesture, shows a "Preparing" note, and receives the document
 * once it is ready. Opened after a multi-second fetch instead, the popup is
 * blocked and printHtml falls back to its hidden 800px iframe, which some
 * documents (the school performance report paginates itself) do not survive.
 *
 * Native: nothing to open; `print` goes straight through printHtml.
 */
export function preparePrint(options: PrintOptions = {}): PendingPrint {
  if (typeof window === "undefined" || isNativePlatform()) {
    return { print: (html, more) => printHtml(html, { ...options, ...more }), cancel: () => {} };
  }
  const opts = { ...DEFAULTS, ...options };
  const win = window.open("", "_blank", `width=${opts.width},height=${opts.height}`);
  if (win) {
    win.document.open();
    win.document.write(PREPARING_HTML);
    win.document.close();
  }
  return {
    print: (html, more) => {
      const all = { ...opts, ...more };
      // Blocked anyway: the same iframe fallback printHtml uses.
      if (!win) return printViaIframe(html, all);
      // The reader closed the waiting window: they no longer want it.
      if (win.closed) return Promise.resolve();
      return printInWindow(win, html, all);
    },
    cancel: () => {
      if (win && !win.closed) win.close();
    },
  };
}

function printInWindow(win: Window, html: string, opts: typeof DEFAULTS): Promise<void> {
  return new Promise((resolve) => {
    win.document.open();
    win.document.write(html);
    win.document.close();

    // print() must fire exactly once: the onload hook and the fallback timer
    // below are two independent triggers for the same call.
    let printed = false;
    const fire = () => {
      if (printed) return;
      printed = true;
      if (!win.closed) {
        try {
          win.focus();
          win.print();
          if (opts.closeAfter) win.close();
        } catch {
          // The user can still print from the popup's own menu.
        }
      }
      resolve();
    };
    const go = () => {
      void waitForImages(win.document, opts.imageTimeoutMs).then(() => {
        window.setTimeout(fire, opts.settleMs);
      });
    };
    // Some browsers fire load before the write settles, others never fire it
    // for a document.write()n page: run once on whichever comes first.
    let started = false;
    const once = () => {
      if (started) return;
      started = true;
      go();
    };
    win.onload = once;
    window.setTimeout(once, opts.settleMs + 300);
  });
}

/** Resolves when every <img> in `doc` has loaded or failed, or after `timeoutMs`. */
function waitForImages(doc: Document, timeoutMs: number): Promise<void> {
  const pending = Array.from(doc.images).filter((img) => !img.complete);
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let remaining = pending.length;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const settle = () => {
      remaining -= 1;
      if (remaining <= 0) finish();
    };
    pending.forEach((img) => {
      img.addEventListener("load", settle, { once: true });
      img.addEventListener("error", settle, { once: true });
    });
    window.setTimeout(finish, timeoutMs);
  });
}

function printViaIframe(html: string, opts: typeof DEFAULTS): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    // Off-screen, not display:none: a hidden iframe does not print in Safari.
    iframe.setAttribute("aria-hidden", "true");
    iframe.className = "fixed -left-[9999px] top-0 h-[600px] w-[800px]";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) {
      document.body.removeChild(iframe);
      reject(new Error("Couldn't open the print view."));
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    void waitForImages(doc, opts.imageTimeoutMs).then(() => {
      window.setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        window.setTimeout(() => {
          document.body.removeChild(iframe);
          resolve();
        }, 1000);
      }, opts.settleMs);
    });
  });
}
