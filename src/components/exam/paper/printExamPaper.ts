import { printHtml } from "@/lib/native";
import { toastError } from "@/lib/toast";

/**
 * Hands the given HTML to `printHtml` (popup on the web, iframe when the popup
 * is blocked, PDF in the native shell) and triggers the print dialog. The
 * popup is left open so the user can re-trigger from its Print menu.
 *
 * `html` must be a complete HTML document (DOCTYPE through </html>). Use
 * `buildExamPaperHtml(data, opts)` from the sibling module to produce it.
 */
export function printExamPaper(html: string): void {
  printHtml(html, { closeAfter: false }).catch((err: unknown) => {
    toastError(err, {
      fallback: "Couldn't open the print window.",
      context: "printExamPaper",
    });
  });
}
