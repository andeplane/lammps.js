import { highlight } from "./highlight";

/**
 * Editable code block: a transparent <textarea> stacked on a highlighted
 * <pre>. The textarea owns input/scroll; the pre mirrors its content.
 */
export interface Editor {
  root: HTMLElement;
  getValue(): string;
  setValue(code: string): void;
}

export function createEditor(initial: string): Editor {
  const root = document.createElement("div");
  root.className = "code-editor";

  const pre = document.createElement("pre");
  pre.setAttribute("aria-hidden", "true");
  const codeEl = document.createElement("code");
  pre.appendChild(codeEl);

  const textarea = document.createElement("textarea");
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("aria-label", "Editable example code");

  root.append(pre, textarea);

  function render() {
    // Trailing newline keeps the pre's height in sync while typing at the end.
    codeEl.innerHTML = highlight(textarea.value) + "\n";
    syncSize();
  }

  function syncSize() {
    // Grow with content up to the CSS max-height, then scroll.
    pre.style.height = "auto";
    const height = Math.min(pre.scrollHeight, 460);
    pre.style.height = `${height}px`;
    textarea.style.height = `${height}px`;
  }

  function syncScroll() {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  }

  textarea.addEventListener("input", render);
  textarea.addEventListener("scroll", syncScroll);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const { selectionStart, selectionEnd, value } = textarea;
      textarea.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
      render();
    }
  });

  textarea.value = initial;
  render();

  // createEditor runs before the block is appended to the document, where
  // scrollHeight is 0 — re-measure once mounted and on any resize.
  const observer = new ResizeObserver(syncSize);
  observer.observe(root);

  return {
    root,
    getValue: () => textarea.value,
    setValue: (code: string) => {
      textarea.value = code;
      render();
    }
  };
}
