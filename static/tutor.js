/* Render tutor markdown.
   Math is lifted out before Markdown runs. Otherwise "_" becomes emphasis,
   "\\" becomes a line break, and "\," loses its backslash, so KaTeX never
   sees a real equation. Chemistry uses KaTeX mhchem (\ce, \pu). */
(function () {
  const SECTIONS = {
    "given": { label: "Given", kind: "given" },
    "दिया गया": { label: "Given", kind: "given" },
    "दिया": { label: "Given", kind: "given" },
    "concept": { label: "Concept", kind: "concept" },
    "अवधारणा": { label: "Concept", kind: "concept" },
    "equations": { label: "Equations", kind: "equations" },
    "equation": { label: "Equations", kind: "equations" },
    "समीकरण": { label: "Equations", kind: "equations" },
    "substitution": { label: "Substitution", kind: "substitution" },
    "working": { label: "Substitution", kind: "substitution" },
    "प्रतिस्थापन": { label: "Substitution", kind: "substitution" },
    "answer": { label: "Answer", kind: "answer" },
    "उत्तर": { label: "Answer", kind: "answer" },
    "common trap": { label: "Common trap", kind: "trap" },
    "common traps": { label: "Common trap", kind: "trap" },
    "trap": { label: "Common trap", kind: "trap" },
    "traps": { label: "Common trap", kind: "trap" },
    "why students miss this": { label: "Common trap", kind: "trap" },
    "सामान्य गलती": { label: "Common trap", kind: "trap" },
    "hint": { label: "Hint", kind: "hint" },
    "संकेत": { label: "Hint", kind: "hint" },
    "question": { label: "Question", kind: "question" },
    "restatement": { label: "Question", kind: "question" },
    "प्रश्न": { label: "Question", kind: "question" },
    "options": { label: "Options", kind: "options" },
    "विकल्प": { label: "Options", kind: "options" },
    "idea": { label: "Idea", kind: "concept" },
    "example": { label: "Example", kind: "example" },
    "उदाहरण": { label: "Example", kind: "example" },
    "check": { label: "Check", kind: "check" },
    "formulae": { label: "Formulae", kind: "equations" },
    "formulas": { label: "Formulae", kind: "equations" },
    "सूत्र": { label: "Formulae", kind: "equations" },
    "when to use": { label: "When to use", kind: "concept" },
  };

  const MODE_LABEL = {
    solve: "Worked solution",
    hint: "Hint",
    practice: "Practice",
    concept: "Concept",
    revision: "Revision",
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function normalize(title) {
    return String(title || "")
      .replace(/[*_`]/g, "")
      .replace(/[:：]\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function headingOf(line) {
    const hashed = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (hashed) return hashed[2].replace(/[*_`]/g, "").trim();
    const bare = line.match(/^(?:\*\*|__)?([^*_#\n]{2,48}?)(?:\*\*|__)?\s*:?\s*$/);
    if (bare && SECTIONS[normalize(bare[1])]) return bare[1].trim();
    return null;
  }

  function pullFinal(src) {
    const lines = String(src || "").split("\n");
    let answer = null;
    const kept = [];
    const re = /^\s*(?:\*\*|__)?(?:final answer|अंतिम उत्तर)\s*:?\s*(?:\*\*|__)?\s*(.+?)\s*$/i;
    for (const line of lines) {
      const match = line.match(re);
      if (match && match[1].trim()) {
        answer = match[1].replace(/^(?:\*\*|__)|(?:\*\*|__)$/g, "").trim();
        continue;
      }
      kept.push(line);
    }
    return { answer, text: kept.join("\n").trim() };
  }

  function splitSections(src) {
    const sections = [];
    const preamble = [];
    let current = null;
    String(src || "").split("\n").forEach((line) => {
      const title = headingOf(line);
      if (title) {
        if (current) sections.push(current);
        current = { title, lines: [] };
        return;
      }
      if (current) current.lines.push(line);
      else preamble.push(line);
    });
    if (current) sections.push(current);
    const bodySections = sections
      .map((section) => ({ title: section.title, body: section.lines.join("\n").trim() }))
      .filter((section) => section.body);
    return { preamble: preamble.join("\n").trim(), sections: bodySections };
  }

  function looksLikeMath(tex) {
    const text = tex.trim();
    if (!text || text.length > 500) return false;
    if (/\\[a-zA-Z]+/.test(text)) return true;
    if (/[\^_=<>]/.test(text)) return true;
    if (/[A-Za-z]/.test(text) && text.length <= 80) return true;
    return /^[0-9.+\-*/(),\s]+$/.test(text);
  }

  function katexHTML(block) {
    if (!block) return "";
    if (!window.katex) {
      return `<span class="math-fallback">${escapeHtml(block.tex)}</span>`;
    }
    try {
      return katex.renderToString(block.tex, {
        displayMode: !!block.display,
        throwOnError: false,
        strict: "ignore",
        trust: false,
      });
    } catch (err) {
      return `<span class="math-fallback">${escapeHtml(block.tex)}</span>`;
    }
  }

  function fallbackMarkdown(src) {
    const escaped = escapeHtml(src);
    const chunks = escaped.split(/\n{2,}/).map((chunk) => {
      const withBreaks = chunk.replace(/\n/g, "<br>");
      const heading = withBreaks.match(/^#{1,3}\s+(.+)$/);
      if (heading) return `<h2>${heading[1]}</h2>`;
      return `<p>${withBreaks.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`;
    });
    return chunks.join("");
  }

  function renderMarkdown(src) {
    const blocks = [];
    const codes = [];
    let text = String(src || "").replace(/\r\n/g, "\n");
    const stashCode = (block) => {
      const id = codes.length;
      codes.push(block);
      return `\uE000C${id}\uE001`;
    };
    const stashMath = (tex, display) => {
      const id = blocks.length;
      blocks.push({ tex: String(tex).trim(), display });
      return display ? `\n\n\uE000M${id}\uE001\n\n` : `\uE000M${id}\uE001`;
    };

    text = text.replace(/```[\s\S]*?```/g, stashCode);
    text = text.replace(/`[^`\n]+`/g, stashCode);
    // Delimited math first. A bare \ce{} pass before $...$ would punch a hole
    // in $n(\ce{Fe^2+})$ and hand KaTeX the placeholder instead of the formula.
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => stashMath(tex, true));
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => stashMath(tex, true));
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => stashMath(tex, false));
    text = text.replace(/\$((?:\\.|[^$\n])+?)\$/g, (full, tex) => (
      looksLikeMath(tex) ? stashMath(tex, false) : full
    ));
    text = text.replace(/\\(?:ce|pu)\{(?:[^{}]|\{[^{}]*\})*\}/g, (tex) => stashMath(tex, false));
    text = text.replace(/\uE000C(\d+)\uE001/g, (_, id) => codes[Number(id)]);

    let html;
    if (window.marked && window.DOMPurify) {
      html = DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }), {
        USE_PROFILES: { html: true },
      });
    } else {
      html = fallbackMarkdown(text);
    }
    html = html.replace(/<p>\s*\uE000M(\d+)\uE001\s*<\/p>/g, (_, id) => katexHTML(blocks[Number(id)]));
    html = html.replace(/\uE000M(\d+)\uE001/g, (_, id) => katexHTML(blocks[Number(id)]));
    return html;
  }

  function prose(markdown) {
    const node = document.createElement("div");
    node.className = "prose";
    node.innerHTML = renderMarkdown(markdown);
    return node;
  }

  function actions() {
    const bar = document.createElement("div");
    bar.className = "sheet-actions";
    [["copy", "Copy"], ["print", "Print"]].forEach(([act, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.act = act;
      button.textContent = label;
      bar.appendChild(button);
    });
    return bar;
  }

  function banner(answer) {
    const node = document.createElement("div");
    node.className = "answer-banner";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "Final answer";
    node.append(label, prose(answer));
    return node;
  }

  function kicker(meta) {
    const node = document.createElement("p");
    node.className = "sheet-kicker";
    const bits = [meta.subject, meta.exam, MODE_LABEL[meta.mode] || ""].filter(Boolean);
    node.textContent = bits.join(" · ");
    return node;
  }

  function fill(container, markdown, meta) {
    const info = meta || {};
    try {
      container.replaceChildren();
      if ((info.role || "assistant") === "user") {
        container.appendChild(prose(markdown));
        return;
      }
      const pulled = pullFinal(markdown);
      const split = splitSections(pulled.text);
      const known = split.sections.filter((section) => SECTIONS[normalize(section.title)]);
      const useSheet = known.length > 0 && known.length === split.sections.length;
      const root = document.createElement("div");
      root.className = useSheet ? "sheet" : "note-card";
      if (info.subject) root.dataset.subject = info.subject;
      if (info.mode) root.dataset.mode = info.mode;

      const substantial = String(markdown || "").trim().length > 180 || useSheet || pulled.answer;
      if (useSheet || substantial) {
        const top = document.createElement("div");
        top.className = "sheet-top";
        const label = kicker(info);
        if (!label.textContent) label.textContent = useSheet ? "Worked solution" : "Note";
        top.append(label, actions());
        root.appendChild(top);
      }
      if (pulled.answer) root.appendChild(banner(pulled.answer));

      if (useSheet) {
        const sections = split.sections.slice();
        if (split.preamble) sections.unshift({ title: "Question", body: split.preamble });
        const list = document.createElement("ol");
        list.className = "steps";
        sections.forEach((section, index) => {
          const mapped = SECTIONS[normalize(section.title)] || { label: section.title, kind: "note" };
          const item = document.createElement("li");
          item.className = `step ${mapped.kind}`;
          const title = document.createElement("div");
          title.className = "step-label";
          const num = document.createElement("span");
          num.className = "step-num";
          num.textContent = String(index + 1).padStart(2, "0");
          const name = document.createElement("span");
          name.textContent = mapped.label;
          title.append(num, name);
          item.append(title, prose(section.body));
          list.appendChild(item);
        });
        root.appendChild(list);
      } else if (pulled.text) {
        root.appendChild(prose(pulled.text));
      }

      if (info.streaming) {
        const status = document.createElement("p");
        status.className = "stream-status";
        status.textContent = "Writing the solution";
        root.appendChild(status);
      }
      container.appendChild(root);
    } catch (err) {
      container.replaceChildren();
      const plain = document.createElement("div");
      plain.className = "prose";
      plain.textContent = markdown || "";
      container.appendChild(plain);
    }
  }

  function thinking(container) {
    container.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "thinking";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-live", "polite");
    const row = document.createElement("div");
    row.className = "thinking-row";
    const dot = document.createElement("span");
    dot.className = "thinking-dot";
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = "Working the solution";
    row.append(dot, label);
    const line = document.createElement("span");
    line.className = "skel";
    const short = document.createElement("span");
    short.className = "skel short";
    wrap.append(row, line, short);
    container.appendChild(wrap);
  }

  window.Tutor = { fill, thinking, renderMarkdown };
})();
