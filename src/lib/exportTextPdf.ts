import { printHtml } from "@/lib/native";

/**
 * Export HTML content as a text-based PDF using browser print.
 * This produces PDFs with selectable/searchable text (not images).
 *
 * Builds a self-contained document (the page's stylesheets plus the print
 * rules below) and hands it to `printHtml`, which owns the popup, the
 * blocked-popup iframe fallback, and the native-shell PDF path.
 */
export function exportAsTextPdf(element: HTMLDivElement, filename: string): Promise<void> {
  const styles = gatherStyles();
  const content = element.innerHTML;

  const doc = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>${filename}</title>
          <style>
            ${styles}

            @page {
              size: A4;
              margin: 15mm;
            }

            @media print {
              body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                font-family: Georgia, 'Times New Roman', serif;
                color: #111;
                background: white;
              }

              table {
                page-break-inside: avoid;
              }

              h1, h2, h3, h4 {
                page-break-after: avoid;
              }

              section {
                page-break-inside: avoid;
              }
            }

            body {
              font-family: Georgia, 'Times New Roman', serif;
              color: #111;
              background: white;
              max-width: 210mm;
              margin: 0 auto;
              padding: 10mm;
              font-size: 11pt;
              line-height: 1.5;
            }

            table {
              border-collapse: collapse;
              width: 100%;
              margin-bottom: 1em;
              font-size: 10pt;
            }

            th, td {
              border: 1px solid #ccc;
              padding: 6px 8px;
              text-align: left;
            }

            th {
              background-color: #f5f5f5;
              font-weight: bold;
            }

            h1 { font-size: 22pt; margin-bottom: 8pt; }
            h2 { font-size: 16pt; margin-top: 16pt; margin-bottom: 8pt; border-bottom: 1px solid #ddd; padding-bottom: 4pt; }
            h3 { font-size: 13pt; margin-top: 12pt; margin-bottom: 6pt; }
            h4 { font-size: 11pt; margin-top: 10pt; margin-bottom: 4pt; }

            p { margin-bottom: 8pt; }

            ul, ol { margin-bottom: 8pt; padding-left: 20pt; }
            li { margin-bottom: 4pt; }

            pre, code {
              font-family: 'Courier New', monospace;
              font-size: 9pt;
              background: #f8f8f8;
              padding: 2px 4px;
              border-radius: 2px;
            }

            pre {
              padding: 8px;
              overflow-x: auto;
              white-space: pre-wrap;
              word-wrap: break-word;
            }

            .bg-blue-50, .bg-green-50, .bg-yellow-50, .bg-red-50, .bg-purple-50, .bg-orange-50, .bg-gray-50 {
              padding: 8px;
              margin-bottom: 8pt;
              border-radius: 4px;
            }
          </style>
        </head>
        <body>
          ${content}
        </body>
        </html>
      `;

  return printHtml(doc, { width: 800, height: 600 });
}

function gatherStyles(): string {
  let styles = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.cssRules) {
        for (const rule of Array.from(sheet.cssRules)) {
          styles += rule.cssText + '\n';
        }
      }
    } catch {
      // Cross-origin stylesheets can't be read - skip them
    }
  }
  return styles;
}
