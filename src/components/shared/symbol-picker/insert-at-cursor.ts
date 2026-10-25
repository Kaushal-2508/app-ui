export type EditableEl = HTMLInputElement | HTMLTextAreaElement;

const ELIGIBLE_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "",
]);

export function isEligibleEditable(target: EventTarget | null): target is EditableEl {
  if (target instanceof HTMLTextAreaElement) {
    return target.dataset.noSymbolPicker !== "true" && !target.readOnly && !target.disabled;
  }
  if (target instanceof HTMLInputElement) {
    if (target.dataset.noSymbolPicker === "true") return false;
    if (target.readOnly || target.disabled) return false;
    return ELIGIBLE_INPUT_TYPES.has(target.type);
  }
  return false;
}

export function insertAtCursor(el: EditableEl, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const newValue = el.value.slice(0, start) + text + el.value.slice(end);

  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, newValue);
  } else {
    el.value = newValue;
  }

  const newCaret = start + text.length;
  try {
    el.setSelectionRange(newCaret, newCaret);
  } catch {
    // Some input types (number, etc.) reject setSelectionRange — caret will land at end.
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Odd number of `$` delimiters before the caret ⇒ the caret is inside math. */
function isCaretInsideMath(before: string): boolean {
  return ((before.match(/\$/g) || []).length & 1) === 1;
}

function applyValue(el: EditableEl, newValue: string, caret: number) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, newValue);
  } else {
    el.value = newValue;
  }
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    /* some inputs reject setSelectionRange */
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Insert a LaTeX snippet at the caret. If the caret already sits inside a
 * `$...$` region the snippet is inserted bare; otherwise it is wrapped in
 * `$...$` (reusing an immediately-adjacent region rather than creating a second
 * one). The caret is left INSIDE the math region, and inside an empty `{}`
 * placeholder when the command has one (e.g. `\sqrt{}`). Used for fields that
 * opt in with `data-math-input="true"` (the equation builder).
 */
export function insertLatexAtCursor(el: EditableEl, rawLatex: string) {
  const value = el.value;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? start;
  const before = value.slice(0, start);
  const after = value.slice(end);

  // Backslash-word commands (\times, \alpha) need a trailing space so a
  // following letter isn't glued into the command name (\timesx → parse error).
  const needsSpace = /\\[a-zA-Z]+$/.test(rawLatex);
  const latex = needsSpace ? `${rawLatex} ` : rawLatex;
  const placeholder = latex.indexOf("{}"); // empty braces → caret target

  let newValue: string;
  let caret: number;

  if (isCaretInsideMath(before)) {
    newValue = before + latex + after;
    caret = placeholder !== -1 ? start + placeholder + 1 : start + latex.length;
  } else {
    let head = before;
    let tail = after;
    let openDelim = "$";
    let closeDelim = "$";
    if (head.endsWith("$")) {
      head = head.slice(0, -1);
      openDelim = "";
    }
    if (tail.startsWith("$")) {
      tail = tail.slice(1);
      closeDelim = "";
    }
    newValue = head + openDelim + latex + closeDelim + tail;
    const innerStart = head.length + openDelim.length;
    caret =
      placeholder !== -1
        ? innerStart + placeholder + 1
        : innerStart + latex.length; // immediately before the closing `$`
  }

  applyValue(el, newValue, caret);
}
