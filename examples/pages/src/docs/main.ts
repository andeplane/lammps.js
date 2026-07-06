import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./styles.css";

import { createExampleBlock } from "./block";
import { helpersNote, heroHtml, sections } from "./content";

const toc = document.getElementById("toc")!;
const content = document.getElementById("content")!;
const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
const navToggle = document.querySelector<HTMLButtonElement>(".nav-toggle")!;

// ---------- hero ----------

const hero = document.createElement("div");
hero.className = "hero";
hero.id = "top";
hero.innerHTML = heroHtml;
content.appendChild(hero);

const note = document.createElement("div");
note.className = "callout";
const noteBody = document.createElement("span");
noteBody.innerHTML = helpersNote;
note.appendChild(noteBody);
content.appendChild(note);

// ---------- sections + toc ----------

sections.forEach((section, index) => {
  const num = String(index + 1).padStart(2, "0");

  const link = document.createElement("a");
  link.href = `#${section.id}`;
  const numEl = document.createElement("span");
  numEl.className = "toc-num";
  numEl.textContent = num;
  link.append(numEl, document.createTextNode(section.title));
  toc.appendChild(link);

  const sectionEl = document.createElement("section");
  sectionEl.className = "doc-section";
  sectionEl.id = section.id;

  const head = document.createElement("div");
  head.className = "section-head";
  head.innerHTML = `
    <span class="sec-num">${num}</span>
    <h2>${section.title}</h2>
    <a class="anchor" href="#${section.id}">#</a>
  `;
  sectionEl.appendChild(head);

  const intro = document.createElement("div");
  intro.className = "prose";
  intro.innerHTML = section.intro;
  sectionEl.appendChild(intro);

  for (const example of section.examples ?? []) {
    sectionEl.appendChild(createExampleBlock(example));
  }

  for (const group of section.reference ?? []) {
    const groupEl = document.createElement("div");
    groupEl.className = "ref-group";
    const title = document.createElement("h3");
    title.textContent = group.title;
    groupEl.appendChild(title);

    const wrap = document.createElement("div");
    wrap.className = "ref-table-wrap";
    const table = document.createElement("table");
    table.className = "ref-table";
    table.innerHTML = "<thead><tr><th>API</th><th>What it does</th><th></th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const row of group.rows) {
      const tr = document.createElement("tr");
      const sig = document.createElement("td");
      sig.textContent = row.sig;
      const desc = document.createElement("td");
      desc.innerHTML = row.desc;
      const see = document.createElement("td");
      if (row.see) {
        const a = document.createElement("a");
        a.href = `#${row.see}`;
        a.textContent = "demo ↗";
        see.appendChild(a);
      }
      tr.append(sig, desc, see);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    groupEl.appendChild(wrap);
    sectionEl.appendChild(groupEl);
  }

  content.appendChild(sectionEl);
});

// ---------- scrollspy ----------

const tocLinks = new Map<string, HTMLAnchorElement>();
for (const link of toc.querySelectorAll<HTMLAnchorElement>("a")) {
  tocLinks.set(link.hash.slice(1), link);
}

const visible = new Set<string>();
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        visible.add(entry.target.id);
      } else {
        visible.delete(entry.target.id);
      }
    }
    // highlight the first visible section (document order)
    let first: string | null = null;
    for (const section of sections) {
      if (visible.has(section.id)) {
        first = section.id;
        break;
      }
    }
    if (first) {
      for (const [id, link] of tocLinks) {
        link.classList.toggle("active", id === first);
      }
    }
  },
  { rootMargin: "-60px 0px -55% 0px" }
);
for (const section of sections) {
  const el = document.getElementById(section.id);
  if (el) observer.observe(el);
}

// ---------- mobile nav ----------

navToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});
toc.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("a")) {
    sidebar.classList.remove("open");
  }
});
