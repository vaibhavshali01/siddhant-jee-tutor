(function () {
  const SUBJECTS = ["Physics", "Chemistry", "Maths"];
  const TABS = [
    ["today", "Today"],
    ["prep", "Prep"],
    ["syllabus", "Syllabus"],
    ["log", "Log"],
    ["ledger", "Ledger"],
    ["topics", "Topics"],
    ["notes", "Notes"],
  ];
  const ACCENTS = [
    ["indigo", "#4f46e5"],
    ["emerald", "#059669"],
    ["rose", "#e11d48"],
    ["amber", "#d97706"],
  ];
  const BLOCKS = [
    ["Morning revision", "7:00–10:00 AM", 7, 10],
    ["Classes", "12:00–4:30 PM", 12, 16.5],
    ["Self-study and PYQs", "5:30–8:30 PM", 17.5, 20.5],
    ["Night deep work", "10:00 PM–1:00 AM", 22, 25],
  ];
  const board = document.getElementById("board");
  const tabs = document.getElementById("tabs");
  const panel = document.getElementById("panel");
  const focus = document.getElementById("focus");
  const toastEl = document.getElementById("toast");
  let state = null;
  let tab = "today";
  let prepSubject = "Physics";
  let mistakeFilter = "All";
  let logView = "timeline";
  let ledgerFilter = "All";
  let topicView = "current";
  let syllabusSubject = "Physics";
  let syllabusScope = "Advanced";
  let openChapter = null;
  let saveTimer = 0;
  let clock = 0;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
  const todayISO = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const parseISO = (value) => {
    const [y, m, d] = String(value || "").split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const daysBetween = (iso) => Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
  const fmt = (iso) => parseISO(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const nextId = () => {
    state.next_id = (state.next_id || 1) + 1;
    return state.next_id;
  };
  const progress = (chapter) => {
    const subs = chapter.subtopics || [];
    if (!subs.length) return 0;
    return Math.round(100 * subs.filter((sub) => sub.done).length / subs.length);
  };
  const subjectPercent = (subject) => {
    const rows = state.chapters.filter((chapter) => chapter.subject === subject);
    if (!rows.length) return 0;
    return Math.round(rows.reduce((sum, chapter) => sum + progress(chapter), 0) / rows.length);
  };
  const deskSubject = (subject) => (subject === "Maths" ? "Mathematics" : subject);
  const minutesOn = (iso) => state.log.filter((entry) => entry.day === iso && entry.kind === "study").reduce((sum, entry) => sum + (entry.minutes || 0), 0);
  const shiftISO = (days) => {
    const date = parseISO(todayISO());
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  function toast(message) {
    toastEl.hidden = false;
    toastEl.textContent = message;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { toastEl.hidden = true; }, 1800);
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const res = await fetch("/api/dashboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF": CSRF },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) toast("Could not save the dashboard.");
    }, 350);
  }
  function paintAccent() {
    board.dataset.accent = state.accent || "amber";
  }

  function currentBlock() {
    const now = new Date();
    let hour = now.getHours() + now.getMinutes() / 60;
    if (hour < 1) hour += 24;
    return BLOCKS.findIndex((block) => hour >= block[2] && hour < block[3]);
  }

  function renderTabs() {
    tabs.innerHTML = TABS.map(([id, label]) => `<button type="button" class="${tab === id ? "on" : ""}" data-tab="${id}">${label}</button>`).join("");
  }

  function chapterLink(chapter) {
    const params = new URLSearchParams({
      subject: deskSubject(chapter.subject),
      mode: "solve",
      text: `${chapter.name}: revise the core idea and one standard problem.`,
    });
    return `/desk?${params.toString()}`;
  }

  function renderToday() {
    const examDays = daysBetween(state.exam);
    const open = state.tasks.filter((task) => !task.done);
    const shown = state.calm ? open.slice(0, 3) : state.tasks;
    const studied = minutesOn(todayISO());
    const week = state.ledger.filter((item) => daysBetween(item.due) <= 7 && daysBetween(item.due) >= 0).length;
    const started = state.chapters.filter((chapter) => progress(chapter) > 0 || chapter.practice > 0);
    const weakest = started.sort((a, b) => progress(a) - progress(b) || b.practice - a.practice)[0];
    const inClass = state.topics.filter((topic) => topic.status !== "Done").slice(0, 2).map((topic) => topic.name).join(", ") || "nothing added yet";
    const block = currentBlock();
    const watched = state.log.filter((entry) => entry.day === todayISO() && String(entry.text || "").startsWith("Lecture:")).reduce((sum, entry) => sum + (entry.minutes || 0), 0);
    const nextLecture = state.lectures.find((lecture) => lecture.watched < 100);
    panel.innerHTML = `
      <div class="board-grid">
        <section class="count-card">
          <p class="kicker" style="color:white">Countdown</p>
          <div class="days">${examDays}</div>
          <div>days to the target exam</div>
          <p>${fmt(state.exam)}</p>
          <form class="inline-form" data-form="exam"><input type="date" name="exam" value="${esc(state.exam)}"><button class="btn small ghost" type="submit">Save date</button></form>
        </section>
        <section class="card">
          <p class="kicker">Today’s brief</p>
          <div class="stats">
            <div class="stat"><b>${Math.floor(studied / 60)} hr</b><span class="muted">${studied % 60} min today</span></div>
            <div class="stat"><b>${open.length}</b><span class="muted">open tasks</span></div>
            <div class="stat"><b>${week}</b><span class="muted">due this week</span></div>
            <div class="stat"><b>${state.backlogs.length}</b><span class="muted">backlogs</span></div>
          </div>
          <p>In class right now: <b>${esc(inClass)}</b>. ${weakest ? `Weakest chapter: <b>${esc(weakest.name)}</b> (${progress(weakest)}%, ${weakest.practice || 0} tutor drills).` : "No chapter has been started, so there is no weakest one yet."} Signed in as ${esc(PROFILE.name)}${PROFILE.class_year ? ` · ${esc(PROFILE.class_year)}` : ""}${PROFILE.target && PROFILE.target !== "owner" ? ` · ${esc(PROFILE.target)}` : ""}.</p>
          ${weakest ? `<a class="btn small" href="${chapterLink(weakest)}">Drill ${esc(weakest.name)} on the desk</a>` : ""}
        </section>
        <section class="card">
          <p class="kicker">Focus timer</p>
          <div id="timer-mount"></div>
          <div class="chips" id="lengths"></div>
          <div class="row-form">
            <label>Subject <select id="focus-subject">${SUBJECTS.map((subject) => `<option ${state.focusSubject === subject ? "selected" : ""}>${subject}</option>`).join("")}</select></label>
            <button class="btn" type="button" id="focus-toggle">Start</button>
            <button class="btn ghost" type="button" id="focus-reset">Reset</button>
            <button class="btn ghost" type="button" id="focus-enter">Study zone</button>
          </div>
        </section>
        <section>
          <p class="kicker">Daily rhythm</p>
          ${BLOCKS.map((item, index) => `<div class="rhythm ${index === block ? "now" : ""}"><b>${item[0]}</b> <span class="muted">${item[1]}</span>${index === block ? ' <span class="pill">now</span>' : ""}</div>`).join("")}
          <p class="kicker">Recorded lectures</p>
          <div class="card">
            <b>${watched} of ${state.goal} min watched today</b>
            <div class="bar" style="margin:8px 0"><i style="width:${Math.min(100, watched / state.goal * 100)}%"></i></div>
            <div class="chips">${[60, 90, 120, 180].map((goal) => `<button type="button" class="chip ${state.goal === goal ? "on" : ""}" data-goal="${goal}">${goal}m</button>`).join("")}</div>
            ${nextLecture ? `<p><span class="pill">${esc(nextLecture.subject)}</span> <b>${esc(nextLecture.title)}</b><br><span class="muted">${esc(nextLecture.chapter)} · ${nextLecture.minutes} min · ${nextLecture.watched}%</span></p><button class="btn small" type="button" data-watch="${nextLecture.id}">+25%</button>` : `<p class="muted">Add lectures under Topics.</p>`}
          </div>
        </section>
        <section class="card board-span">
          <div class="row" style="justify-content:space-between"><p class="kicker">Tasks</p><button class="btn small ghost" type="button" id="calm">${state.calm ? "Calm mode on" : "Calm mode"}</button></div>
          <form class="inline-form" data-form="task"><input name="text" type="text" placeholder="Add a task" required maxlength="240"><select name="subject">${SUBJECTS.map((subject) => `<option>${subject}</option>`).join("")}</select><button class="btn" type="submit">Add</button></form>
          ${(shown.map((task) => `<div class="row" style="margin-bottom:8px"><button type="button" class="check ${task.done ? "on" : ""}" data-task="${task.id}">${task.done ? "✓" : ""}</button><div class="${task.done ? "muted" : ""}" style="${task.done ? "text-decoration:line-through" : ""}">${esc(task.text)}</div><span class="pill">${esc(task.subject)}</span><button type="button" class="textbtn" data-del-task="${task.id}">Remove</button></div>`).join("")) || `<p class="muted">Nothing here. Add a task above.</p>`}
        </section>
        <section class="card board-span">
          <p class="kicker">Colour</p>
          <div class="row">${ACCENTS.map(([name, color]) => `<button type="button" class="swatch ${state.accent === name ? "on" : ""}" data-accent="${name}" style="background:${color}" title="${name}"></button>`).join("")}</div>
          <p class="muted">Indigo, emerald, rose, and amber sit on top of the same light and dark desk. The light/dark switch in the header still applies everywhere.</p>
        </section>
      </div>`;
    mountTimer();
  }

  function mountTimer() {
    const mount = document.getElementById("timer-mount");
    if (!mount) return;
    const total = (state.focusLen || 25) * 60;
    const left = Math.max(0, state.focusLeft ?? total);
    const ratio = total ? left / total : 1;
    const clockText = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    mount.innerHTML = `<svg class="timer-ring" viewBox="0 0 120 120" role="img" aria-label="Focus timer"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="8"/><circle cx="60" cy="60" r="52" fill="none" stroke="var(--accent)" stroke-width="8" stroke-dasharray="${(2 * Math.PI * 52).toFixed(1)}" stroke-dashoffset="${(2 * Math.PI * 52 * (1 - ratio)).toFixed(1)}" transform="rotate(-90 60 60)"/><text x="60" y="66" text-anchor="middle">${clockText}</text></svg>`;
    const toggle = document.getElementById("focus-toggle");
    if (toggle) toggle.textContent = state.focusRun ? "Pause" : (left < total ? "Resume" : "Start");
    document.querySelectorAll("#lengths, .chips").forEach(() => {});
    const lengths = document.getElementById("lengths");
    if (lengths) {
      lengths.className = "chips";
      lengths.innerHTML = [15, 25, 45, 60, 90].map((minutes) => `<button type="button" class="${state.focusLen === minutes ? "on" : ""}" data-len="${minutes}">${minutes} min</button>`).join("") + `<input id="custom-len" type="number" min="1" max="300" value="${state.focusLen || 25}" aria-label="Custom minutes" style="width:88px">`;
    }
  }

  function renderPrep() {
    const chapters = state.chapters.filter((chapter) => chapter.subject === prepSubject);
    const mistakes = state.mistakes.filter((mistake) => mistakeFilter === "All" || mistake.cause === mistakeFilter);
    panel.innerHTML = `
      <div class="board-tabs">${SUBJECTS.map((subject) => `<button type="button" class="${prepSubject === subject ? "on" : ""}" data-prep="${subject}">${subject} ${subjectPercent(subject)}%</button>`).join("")}</div>
      ${chapters.map((chapter) => `<article class="card"><div class="row" style="justify-content:space-between;gap:8px"><div><b>${esc(chapter.name)}</b><div class="muted">${chapter.practice || 0} tutor drills · ${chapter.scope === "A" ? "Advanced only" : chapter.scope === "M" ? "Main only" : "Main + Advanced"}</div></div><div class="row"><button type="button" class="btn small ghost" data-bump="${chapter.id}" data-by="-10">−</button><b>${progress(chapter)}%</b><button type="button" class="btn small ghost" data-bump="${chapter.id}" data-by="10">+</button></div></div><div class="bar" style="margin-top:8px"><i style="width:${progress(chapter)}%"></i></div><p><a href="${chapterLink(chapter)}">Ask the desk</a></p></article>`).join("")}
      <p class="kicker">Mistake notebook</p>
      <div class="chips">${["All", "Concept", "Calculation", "Silly", "Time"].map((cause) => `<button type="button" class="${mistakeFilter === cause ? "on" : ""}" data-cause="${cause}">${cause}</button>`).join("")}</div>
      <form class="inline-form" data-form="mistake"><select name="subject">${SUBJECTS.map((subject) => `<option>${subject}</option>`).join("")}</select><select name="cause">${["Concept", "Calculation", "Silly", "Time"].map((cause) => `<option>${cause}</option>`).join("")}</select><input name="question" type="text" placeholder="What went wrong?" required><input name="fix" type="text" placeholder="The rule to remember" required><button class="btn" type="submit">Save</button></form>
      ${mistakes.map((mistake) => `<article class="card"><span class="pill">${esc(mistake.subject)}</span> <span class="pill">${esc(mistake.cause)}</span><p><b>${esc(mistake.question)}</b></p><p class="muted">${esc(mistake.fix)}</p><button type="button" class="btn small ghost" data-revised="${mistake.id}">${mistake.revised ? "Revised" : "Mark revised"}</button></article>`).join("") || `<p class="muted">No mistakes in this filter.</p>`}`;
  }

  function scopeOk(chapter) {
    if (syllabusScope === "All") return true;
    return (chapter.scope || "MA").includes(syllabusScope === "Main" ? "M" : "A");
  }
  function renderSyllabus() {
    const visible = state.chapters.filter(scopeOk);
    const rows = visible.filter((chapter) => chapter.subject === syllabusSubject);
    const total = visible.reduce((sum, chapter) => sum + chapter.subtopics.length, 0);
    const done = visible.reduce((sum, chapter) => sum + chapter.subtopics.filter((sub) => sub.done).length, 0);
    panel.innerHTML = `
      <article class="card"><b>${done} of ${total} subtopics done</b><div class="bar" style="margin-top:8px"><i style="width:${total ? done / total * 100 : 0}%"></i></div><p class="muted">Ticking a subtopic updates the chapter on Prep. A tutor solution that names the chapter adds a drill, it does not tick the syllabus for you.</p></article>
      <div class="chips">${["Advanced", "Main", "All"].map((scope) => `<button type="button" class="${syllabusScope === scope ? "on" : ""}" data-scope="${scope}">${scope}</button>`).join("")}</div>
      <div class="board-tabs">${SUBJECTS.map((subject) => `<button type="button" class="${syllabusSubject === subject ? "on" : ""}" data-syl="${subject}">${subject}</button>`).join("")}</div>
      ${rows.map((chapter) => {
        const opened = openChapter === chapter.id;
        const finished = chapter.subtopics.filter((sub) => sub.done).length;
        return `<article class="card"><div class="row" style="justify-content:space-between"><button type="button" class="btn small ghost" data-open="${chapter.id}">${opened ? "Hide" : "Open"}</button><div style="flex:1"><b>${esc(chapter.name)}</b><div class="muted">${finished}/${chapter.subtopics.length} · ${progress(chapter)}%</div></div></div><div class="bar"><i style="width:${progress(chapter)}%"></i></div>${opened ? chapter.subtopics.map((sub) => `<div class="row" style="margin-top:8px"><button type="button" class="check ${sub.done ? "on" : ""}" data-sub="${sub.id}" data-chapter="${chapter.id}">${sub.done ? "✓" : ""}</button><span class="${sub.done ? "muted" : ""}">${esc(sub.name)}</span></div>`).join("") : ""}</article>`;
      }).join("")}`;
  }

  function renderLog() {
    const days = [...new Set(state.log.map((entry) => entry.day))].sort().reverse();
    const heat = Array.from({ length: 84 }, (_, index) => {
      const iso = shiftISO(-(83 - index));
      const hours = minutesOn(iso) / 60;
      return `<i title="${iso}" style="background:color-mix(in srgb, var(--accent) ${hours ? Math.min(100, 25 + hours * 18) : 8}%, var(--line))"></i>`;
    }).join("");
    let streak = 0;
    for (let i = 0; i < 84; i += 1) {
      if (minutesOn(shiftISO(-i)) > 0) streak += 1;
      else if (i > 0) break;
    }
    const weekStart = shiftISO(-6);
    const week = state.log.filter((entry) => entry.kind === "study" && entry.day >= weekStart);
    const total = week.reduce((sum, entry) => sum + entry.minutes, 0);
    panel.innerHTML = `
      <div class="board-tabs"><button type="button" class="${logView === "timeline" ? "on" : ""}" data-logview="timeline">Timeline</button><button type="button" class="${logView === "review" ? "on" : ""}" data-logview="review">Weekly review</button></div>
      ${logView === "review" ? `<article class="card"><div class="muted">This week</div><div class="count-card" style="min-height:0;padding:16px"><div class="days" style="font-size:3rem">${Math.floor(total / 60)}h ${total % 60}m</div></div>
        ${SUBJECTS.map((subject) => {
          const minutes = week.filter((entry) => entry.subject === subject).reduce((sum, entry) => sum + entry.minutes, 0);
          return `<p>${subject} · ${Math.round(minutes / 6) / 10}h</p><div class="bar"><i style="width:${total ? minutes / total * 100 : 0}%"></i></div>`;
        }).join("")}
        <p class="muted">${streak} day study streak, counting today backward.</p></article>` : `
      <article class="card"><b>${streak}</b> day study streak<div class="heat" style="margin-top:12px">${heat}</div><p class="muted">Last 12 weeks. Darker means more hours.</p></article>
      <form class="inline-form" data-form="log"><select name="kind"><option value="study">Study</option><option value="note">Note</option><option value="checkin">Check-in</option><option value="mock">Mock score</option></select><select name="subject">${SUBJECTS.map((subject) => `<option>${subject}</option>`).join("")}</select><input name="minutes" type="number" min="0" value="60" style="width:90px" aria-label="Minutes"><input name="text" type="text" placeholder="What did you do?" required><button class="btn" type="submit">Add</button></form>
      ${days.map((day) => `<p class="kicker">${day === todayISO() ? "Today" : day === shiftISO(-1) ? "Yesterday" : fmt(day)}</p>` + state.log.filter((entry) => entry.day === day).map((entry) => `<article class="card row"><span class="muted">${esc(entry.time)}</span><div style="flex:1">${esc(entry.text)}</div>${entry.kind === "study" ? `<span class="pill">${esc(entry.subject)} · ${entry.minutes}m</span>` : `<span class="pill">${esc(entry.kind)}</span>`}<button type="button" class="textbtn" data-del-log="${entry.id}">Remove</button></article>`).join("")).join("")}`} `;
  }

  function renderLedger() {
    const rows = state.ledger.filter((item) => ledgerFilter === "All" || item.type === ledgerFilter).slice().sort((a, b) => a.due.localeCompare(b.due));
    panel.innerHTML = `
      <form class="inline-form" data-form="ledger"><input name="text" type="text" placeholder="Try: mock test in 14 days" required><button class="btn" type="submit">Add</button></form>
      <p class="muted">You can write “today”, “tomorrow”, or “in 10 days”. Repeating items roll forward when you mark them done.</p>
      <div class="chips">${["All", "Exam", "Mock", "Revision", "Admin"].map((kind) => `<button type="button" class="${ledgerFilter === kind ? "on" : ""}" data-ledger="${kind}">${kind}</button>`).join("")}</div>
      ${rows.map((item) => {
        const due = daysBetween(item.due);
        return `<article class="card row"><div style="flex:1"><b>${esc(item.title)}</b><div class="muted">${due < 0 ? `${-due}d overdue` : due === 0 ? "Due today" : fmt(item.due)}${item.repeat ? ` · every ${item.repeat.n} ${item.repeat.unit}` : ""}</div></div><span class="pill">${esc(item.type)}</span><button type="button" class="btn small ghost" data-ledger-done="${item.id}">Done</button></article>`;
      }).join("") || `<p class="muted">Nothing in this list.</p>`}`;
  }

  function renderTopics() {
    const views = [["current", "Topics"], ["back", "Backlogs"], ["lectures", "Lectures"], ["material", "Material"]];
    let body = "";
    if (topicView === "current") {
      body = `<form class="inline-form" data-form="topic"><select name="subject">${SUBJECTS.map((subject) => `<option>${subject}</option>`).join("")}</select><input name="name" type="text" placeholder="Topic being taught" required><button class="btn" type="submit">Add</button></form>
        <p class="muted">Tap the status to move a topic from Learning to Practice to Done.</p>
        ${state.topics.map((topic) => `<article class="card"><span class="pill">${esc(topic.subject)}</span> <b>${esc(topic.name)}</b> ${topic.source === "Allen" ? '<span class="pill">Allen</span>' : ""}<div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button type="button" class="btn small" data-status="${topic.id}">${esc(topic.status)}</button><button type="button" class="btn small ghost" data-to-back="${topic.id}">Move to backlog</button><button type="button" class="textbtn" data-del-topic="${topic.id}">Remove</button></div></article>`).join("") || `<p class="muted">No current topics yet.</p>`}
        <p class="kicker">Allen list</p>
        <form class="stack" data-form="allen"><textarea name="text" rows="4" placeholder="Physics: Rotational Motion&#10;Chemistry: Equilibrium (missed)" required></textarea><label class="muted"><input type="checkbox" name="mirror"> Drop Allen topics missing from this paste</label><button class="btn" type="submit">Import</button></form>
        <p class="muted">${state.allen_synced_at ? `Last imported ${esc(state.allen_synced_at)}.` : "Not imported yet."} This only reads the text you paste. It never signs in to Allen.</p>`;
    } else if (topicView === "back") {
      body = `<form class="inline-form" data-form="backlog"><select name="subject">${SUBJECTS.map((subject) => `<option>${subject}</option>`).join("")}</select><input name="name" type="text" placeholder="Backlog topic" required><select name="priority"><option>High</option><option>Medium</option><option>Low</option></select><select name="why"><option>Missed class</option><option>Not understood</option><option>No practice</option></select><button class="btn" type="submit">Add</button></form>
        ${state.backlogs.map((item) => `<article class="card"><span class="pill">${esc(item.subject)}</span> <b>${esc(item.name)}</b><div class="muted">${esc(item.why)} · clear by ${fmt(item.due)} · ${esc(item.priority)}</div><button type="button" class="btn small ghost" data-clear-back="${item.id}">Cleared</button></article>`).join("") || `<p class="muted">No backlogs.</p>`}`;
    } else if (topicView === "lectures") {
      body = `<form class="inline-form" data-form="lecture"><select name="subject">${SUBJECTS.map((subject) => `<option>${subject}</option>`).join("")}</select><input name="chapter" type="text" placeholder="Chapter" required><input name="title" type="text" placeholder="Lecture title" required><input name="minutes" type="number" min="5" value="50" style="width:90px"><button class="btn" type="submit">Add</button></form>
        ${state.lectures.map((lecture) => `<article class="card"><span class="pill">${esc(lecture.subject)}</span> <b>${esc(lecture.title)}</b><div class="muted">${esc(lecture.chapter)} · ${lecture.minutes} min · ${lecture.watched}%</div><div class="bar"><i style="width:${lecture.watched}%"></i></div><button type="button" class="btn small" data-watch="${lecture.id}">+25%</button> <button type="button" class="btn small ghost" data-finish="${lecture.id}">Finished</button></article>`).join("") || `<p class="muted">No lectures yet.</p>`}`;
    } else {
      body = `<p class="muted">Allen’s own modules stay on allen.in. Save the title and link you actually use.</p>
        <p><a href="https://allen.in" target="_blank" rel="noopener">Open allen.in</a></p>
        <form class="inline-form" data-form="material"><select name="subject">${SUBJECTS.map((subject) => `<option>${subject}</option>`).join("")}</select><input name="title" type="text" placeholder="Title" required><input name="note" type="text" placeholder="Module or pages"><input name="url" type="url" placeholder="https://"><button class="btn" type="submit">Save</button></form>
        ${state.materials.map((item) => `<article class="card"><span class="pill">${esc(item.subject)}</span> <b>${esc(item.title)}</b><div class="muted">${esc(item.note)}</div>${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">Open</a>` : ""}</article>`).join("")}`;
    }
    panel.innerHTML = `<div class="board-tabs">${views.map(([id, label]) => `<button type="button" class="${topicView === id ? "on" : ""}" data-topics="${id}">${label}</button>`).join("")}</div>${body}`;
  }

  function renderNotes() {
    panel.innerHTML = `
      <article class="card"><p>These notes stay on your Siddhant account. There is no second PIN: the owner already has to approve the login, and a PIN stored beside the note would not be a real lock.</p></article>
      <form class="inline-form" data-form="note"><input name="title" type="text" placeholder="Title" required><input name="body" type="text" placeholder="Details" required><button class="btn" type="submit">Save</button></form>
      ${state.notes.map((note) => `<article class="card"><b>${esc(note.title)}</b><p>${esc(note.body)}</p><button type="button" class="textbtn" data-del-note="${note.id}">Remove</button></article>`).join("") || `<p class="muted">No private notes yet.</p>`}
      <div class="row" style="gap:8px"><button class="btn ghost" type="button" id="export">Download backup</button><label class="btn ghost">Restore backup<input id="restore" type="file" accept="application/json,.json" hidden></label></div>`;
  }

  function render() {
    paintAccent();
    renderTabs();
    if (tab === "today") renderToday();
    else if (tab === "prep") renderPrep();
    else if (tab === "syllabus") renderSyllabus();
    else if (tab === "log") renderLog();
    else if (tab === "ledger") renderLedger();
    else if (tab === "topics") renderTopics();
    else renderNotes();
  }

  function setFocus(minutes) {
    if (state.focusRun) { toast("Pause the timer before changing its length."); return; }
    state.focusLen = minutes;
    state.focusLeft = minutes * 60;
    state.focusEnd = null;
    save();
    render();
  }
  function logFocus(minutes, label) {
    if (minutes < 1) return;
    state.log.push({
      id: nextId(), day: todayISO(), time: new Date().toTimeString().slice(0, 5),
      kind: "study", subject: state.focusSubject || "Physics", minutes, text: label,
    });
  }
  function finishFocus(early) {
    const spent = Math.round(((state.focusLen || 25) * 60 - (state.focusLeft || 0)) / 60);
    const minutes = early ? spent : (state.focusLen || 25);
    state.focusRun = false;
    state.focusEnd = null;
    state.focusLeft = (state.focusLen || 25) * 60;
    if (minutes >= 1) logFocus(minutes, early ? "Focus session ended early" : "Focus session");
    save();
    toast(minutes >= 1 ? `Logged ${minutes} min` : "Under a minute, so nothing was logged");
    if (!focus.hidden) focus.hidden = true;
    render();
  }
  function tick() {
    if (!state || !state.focusRun || !state.focusEnd) return;
    state.focusLeft = Math.max(0, Math.ceil((state.focusEnd - Date.now()) / 1000));
    if (state.focusLeft <= 0) finishFocus(false);
    else if (tab === "today" || !focus.hidden) mountTimer();
  }

  function parseLedger(text) {
    let title = text.trim();
    const lower = title.toLowerCase();
    let due = shiftISO(7);
    let repeat = null;
    const every = lower.match(/every\s*(\d+)?\s*(day|week|month|year)s?/);
    if (every) {
      repeat = { n: Number(every[1] || 1), unit: every[2] };
      title = title.replace(every[0], "");
    }
    const ahead = lower.match(/in\s+(\d+)\s*(day|week)s?/);
    if (ahead) due = shiftISO(Number(ahead[1]) * (ahead[2] === "week" ? 7 : 1));
    else if (lower.includes("tomorrow")) due = shiftISO(1);
    else if (lower.includes("today")) due = todayISO();
    title = title.replace(/\b(in\s+\d+\s*(day|week)s?|tomorrow|today)\b/ig, "").replace(/\s+/g, " ").trim();
    const type = /mock|test|aits/.test(lower) ? "Mock" : /revis|formula|notes/.test(lower) ? "Revision" : /exam|admit|register/.test(lower) ? "Exam" : "Admin";
    return { title: title || "Untitled", type, due, repeat };
  }

  function importAllen(text, mirror) {
    let added = 0;
    const seen = [];
    text.split("\n").forEach((raw) => {
      const line = raw.replace(/^[\s\-*•\d.)]+/, "").trim();
      const match = line.match(/^(physics|phy|chemistry|chem|mathematics|maths|math)\s*[:\-–|]\s*(.+)$/i);
      if (!match) return;
      const subject = { physics: "Physics", phy: "Physics", chemistry: "Chemistry", chem: "Chemistry", mathematics: "Maths", maths: "Maths", math: "Maths" }[match[1].toLowerCase()];
      let name = match[2].trim();
      if (/backlog|missed/i.test(name)) {
        name = name.replace(/\(?\s*(backlog|missed)\s*\)?/ig, "").trim();
        if (name && !state.backlogs.some((item) => item.name === name && item.subject === subject)) {
          const due = parseISO(todayISO());
          due.setDate(due.getDate() + 5);
          state.backlogs.push({ id: nextId(), subject, name, priority: "High", why: "Missed class", due: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}` });
          added += 1;
        }
        return;
      }
      seen.push(`${subject}|${name.toLowerCase()}`);
      if (!state.topics.some((topic) => topic.subject === subject && topic.name.toLowerCase() === name.toLowerCase())) {
        state.topics.unshift({ id: nextId(), subject, name, status: "Learning", source: "Allen" });
        added += 1;
      }
    });
    if (mirror) state.topics = state.topics.filter((topic) => topic.source !== "Allen" || seen.includes(`${topic.subject}|${topic.name.toLowerCase()}`));
    state.allen_synced_at = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return added;
  }

  function bumpChapter(id, by) {
    const chapter = state.chapters.find((item) => item.id === Number(id));
    if (!chapter || !chapter.subtopics.length) return;
    const target = Math.max(0, Math.min(100, progress(chapter) + Number(by)));
    const need = Math.round(chapter.subtopics.length * target / 100);
    chapter.subtopics.forEach((sub, index) => { sub.done = index < need; });
  }

  function watchLecture(id, finish) {
    const lecture = state.lectures.find((item) => item.id === Number(id));
    if (!lecture) return;
    const before = lecture.watched;
    lecture.watched = finish ? 100 : Math.min(100, lecture.watched + 25);
    const gained = Math.round((lecture.watched - before) * lecture.minutes / 100);
    if (gained > 0) {
      state.log.push({ id: nextId(), day: todayISO(), time: new Date().toTimeString().slice(0, 5), kind: "study", subject: lecture.subject, minutes: gained, text: `Lecture: ${lecture.title}` });
    }
  }

  focus.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !state) return;
    if (button.id === "zone-pause") {
      state.focusRun = !state.focusRun;
      state.focusEnd = state.focusRun ? Date.now() + state.focusLeft * 1000 : null;
      mountTimer();
      save();
    }
    if (button.id === "zone-leave" && !button.disabled) {
      button.disabled = true;
      let left = 30;
      button.textContent = `Leave in ${left}s`;
      const wait = setInterval(() => {
        left -= 1;
        if (left > 0) button.textContent = `Leave in ${left}s`;
        else { clearInterval(wait); finishFocus(true); }
      }, 1000);
    }
  });

  board.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !state) return;
    if (button.dataset.tab) { tab = button.dataset.tab; render(); return; }
    if (button.dataset.accent) { state.accent = button.dataset.accent; save(); render(); return; }
    if (button.dataset.goal) { state.goal = Number(button.dataset.goal); save(); render(); return; }
    if (button.id === "calm") { state.calm = !state.calm; save(); render(); return; }
    if (button.dataset.len) { setFocus(Number(button.dataset.len)); return; }
    if (button.dataset.task) {
      const task = state.tasks.find((item) => item.id === Number(button.dataset.task));
      if (task) task.done = !task.done;
      save(); render(); return;
    }
    if (button.dataset.delTask) { state.tasks = state.tasks.filter((item) => item.id !== Number(button.dataset.delTask)); save(); render(); return; }
    if (button.dataset.prep) { prepSubject = button.dataset.prep; render(); return; }
    if (button.dataset.cause) { mistakeFilter = button.dataset.cause; render(); return; }
    if (button.dataset.bump) { bumpChapter(button.dataset.bump, button.dataset.by); save(); render(); return; }
    if (button.dataset.revised) {
      const mistake = state.mistakes.find((item) => item.id === Number(button.dataset.revised));
      if (mistake) mistake.revised = !mistake.revised;
      save(); render(); return;
    }
    if (button.dataset.scope) { syllabusScope = button.dataset.scope; render(); return; }
    if (button.dataset.syl) { syllabusSubject = button.dataset.syl; render(); return; }
    if (button.dataset.open) { openChapter = openChapter === Number(button.dataset.open) ? null : Number(button.dataset.open); render(); return; }
    if (button.dataset.sub) {
      const chapter = state.chapters.find((item) => item.id === Number(button.dataset.chapter));
      const sub = chapter && chapter.subtopics.find((item) => item.id === Number(button.dataset.sub));
      if (sub) sub.done = !sub.done;
      save(); render(); return;
    }
    if (button.dataset.logview) { logView = button.dataset.logview; render(); return; }
    if (button.dataset.delLog) { state.log = state.log.filter((item) => item.id !== Number(button.dataset.delLog)); save(); render(); return; }
    if (button.dataset.ledger) { ledgerFilter = button.dataset.ledger; render(); return; }
    if (button.dataset.ledgerDone) {
      const item = state.ledger.find((entry) => entry.id === Number(button.dataset.ledgerDone));
      if (item && item.repeat) {
        const date = parseISO(item.due);
        const step = item.repeat.unit === "week" ? 7 * item.repeat.n : item.repeat.n;
        if (item.repeat.unit === "month") date.setMonth(date.getMonth() + item.repeat.n);
        else if (item.repeat.unit === "year") date.setFullYear(date.getFullYear() + item.repeat.n);
        else date.setDate(date.getDate() + step);
        item.due = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      } else state.ledger = state.ledger.filter((entry) => entry.id !== Number(button.dataset.ledgerDone));
      save(); render(); return;
    }
    if (button.dataset.topics) { topicView = button.dataset.topics; render(); return; }
    if (button.dataset.status) {
      const topic = state.topics.find((item) => item.id === Number(button.dataset.status));
      if (topic) topic.status = { Learning: "Practice", Practice: "Done", Done: "Learning" }[topic.status];
      save(); render(); return;
    }
    if (button.dataset.toBack) {
      const topic = state.topics.find((item) => item.id === Number(button.dataset.toBack));
      if (topic) {
        state.topics = state.topics.filter((item) => item.id !== topic.id);
        state.backlogs.unshift({ id: nextId(), subject: topic.subject, name: topic.name, priority: "High", why: "Not understood", due: shiftISO(3) });
      }
      save(); render(); return;
    }
    if (button.dataset.delTopic) { state.topics = state.topics.filter((item) => item.id !== Number(button.dataset.delTopic)); save(); render(); return; }
    if (button.dataset.clearBack) { state.backlogs = state.backlogs.filter((item) => item.id !== Number(button.dataset.clearBack)); save(); render(); return; }
    if (button.dataset.watch) { watchLecture(button.dataset.watch, false); save(); render(); return; }
    if (button.dataset.finish) { watchLecture(button.dataset.finish, true); save(); render(); return; }
    if (button.dataset.delNote) { state.notes = state.notes.filter((item) => item.id !== Number(button.dataset.delNote)); save(); render(); return; }
    if (button.id === "focus-toggle") {
      if (state.focusRun) { state.focusRun = false; state.focusEnd = null; }
      else { state.focusRun = true; state.focusEnd = Date.now() + (state.focusLeft || (state.focusLen || 25) * 60) * 1000; }
      save(); render(); return;
    }
    if (button.id === "focus-reset") { state.focusRun = false; state.focusEnd = null; state.focusLeft = (state.focusLen || 25) * 60; save(); render(); return; }
    if (button.id === "focus-enter") {
      if (!state.focusRun) { state.focusRun = true; state.focusEnd = Date.now() + (state.focusLeft || (state.focusLen || 25) * 60) * 1000; }
      focus.hidden = false;
      focus.innerHTML = `<p class="kicker" style="color:#e4b57d">Study zone</p><div id="timer-mount"></div><p>One problem at a time. Alerts on this page wait.</p><div class="row" style="justify-content:center"><button class="btn" type="button" id="zone-pause">Pause</button><button class="btn ghost" type="button" id="zone-leave">Leave</button></div><p><a href="/desk">Open the desk</a> if you are stuck. The Gemini assistant from the other site is not copied; this account already has the tutor.</p>`;
      mountTimer();
      save();
      return;
    }
    if (button.id === "zone-pause") { state.focusRun = !state.focusRun; if (state.focusRun) state.focusEnd = Date.now() + state.focusLeft * 1000; else state.focusEnd = null; mountTimer(); save(); return; }
    if (button.id === "zone-leave") {
      button.disabled = true;
      let left = 30;
      button.textContent = `Leave in ${left}s`;
      const wait = setInterval(() => {
        left -= 1;
        if (left > 0) button.textContent = `Leave in ${left}s`;
        else { clearInterval(wait); finishFocus(true); }
      }, 1000);
      return;
    }
    if (button.id === "export") {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "siddhant-dashboard.json";
      link.click();
    }
  });

  board.addEventListener("change", (event) => {
    if (event.target.id === "focus-subject") { state.focusSubject = event.target.value; save(); }
    if (event.target.id === "custom-len") setFocus(Math.max(1, Math.min(300, Number(event.target.value) || 25)));
    if (event.target.id === "restore" && event.target.files[0]) {
      const file = event.target.files[0];
      file.text().then((raw) => {
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.chapters)) throw new Error("not a backup");
        state = data;
        save();
        render();
        toast("Backup restored");
      }).catch(() => toast("That file is not a dashboard backup."));
    }
  });

  board.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.form === "exam") state.exam = data.exam || state.exam;
    if (form.dataset.form === "task" && data.text) state.tasks.unshift({ id: nextId(), text: data.text, subject: data.subject, done: false });
    if (form.dataset.form === "mistake") state.mistakes.unshift({ id: nextId(), subject: data.subject, cause: data.cause, question: data.question, fix: data.fix, revised: false });
    if (form.dataset.form === "log") state.log.unshift({ id: nextId(), day: todayISO(), time: new Date().toTimeString().slice(0, 5), kind: data.kind, subject: data.subject, minutes: Number(data.minutes) || 0, text: data.text });
    if (form.dataset.form === "ledger") {
      const parsed = parseLedger(data.text);
      state.ledger.push({ id: nextId(), ...parsed });
    }
    if (form.dataset.form === "topic") state.topics.unshift({ id: nextId(), subject: data.subject, name: data.name, status: "Learning", source: "Manual" });
    if (form.dataset.form === "backlog") state.backlogs.unshift({ id: nextId(), subject: data.subject, name: data.name, priority: data.priority, why: data.why, due: shiftISO(7) });
    if (form.dataset.form === "lecture") state.lectures.push({ id: nextId(), subject: data.subject, chapter: data.chapter, title: data.title, minutes: Number(data.minutes) || 50, watched: 0, url: "" });
    if (form.dataset.form === "material") state.materials.unshift({ id: nextId(), subject: data.subject, title: data.title, note: data.note || "", url: data.url || "" });
    if (form.dataset.form === "note") state.notes.unshift({ id: nextId(), title: data.title, body: data.body });
    if (form.dataset.form === "allen") importAllen(data.text, form.elements.mirror.checked);
    save();
    render();
  });

  async function start() {
    const res = await fetch("/api/dashboard");
    if (!res.ok) { panel.textContent = "The dashboard is not available for this account."; return; }
    const body = await res.json();
    state = body.state;
    state.focusLen = state.focusLen || 25;
    state.focusLeft = state.focusLeft ?? state.focusLen * 60;
    state.focusSubject = state.focusSubject || "Physics";
    if (state.focusRun && state.focusEnd && state.focusEnd < Date.now()) finishFocus(false);
    render();
    clock = setInterval(tick, 1000);
  }
  start();
})();
