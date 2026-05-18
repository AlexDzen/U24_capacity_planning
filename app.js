// This file contains the split application logic extracted from the original
// single-file prototype. It preserves the existing global API used by inline
// event handlers in index.html.

const ROLE_COLORS = {
  Android: { bg: "#E6F1FB", color: "#185FA5" },
  iOS: { bg: "#FBEAF0", color: "#993556" },
  Backend: { bg: "#E1F5EE", color: "#0F6E56" },
  QA: { bg: "#FAEEDA", color: "#854F0B" },
  Design: { bg: "#EEEDFE", color: "#534AB7" },
  Other: { bg: "#F1EFE8", color: "#5F5E5A" },
};

const SC = {
  "Ready for Deploy": { color: "#0F6E56", bg: "#E1F5EE" },
  "Ready for Development": { color: "#185FA5", bg: "#E6F1FB" },
  Done: { color: "#0F6E56", bg: "#E1F5EE" },
  Rejected: { color: "#888780", bg: "#F1EFE8" },
  Cancelled: { color: "#888780", bg: "#F1EFE8" },
  "In Progress": { color: "#378ADD", bg: "#E6F1FB" },
  "To do": { color: "#888780", bg: "#F1EFE8" },
  Testing: { color: "#BA7517", bg: "#FAEEDA" },
  "To Test": { color: "#7F77DD", bg: "#EEEDFE" },
  Review: { color: "#D85A30", bg: "#FAECE7" },
};

const STATUS_ORDER = ["In Progress", "Ready for Development", "To do", "Testing", "To Test", "Review", "Ready for Deploy", "Done", "Rejected"];
const HPD = 8;
const SKIP_STATUSES = new Set([]);
const DONE_STATUSES = new Set(["Done", "Ready for Deploy", "Closed", "Rejected", "Cancelled", "Won't Fix"]);

let cfg = {
  url: "",
  email: "",
  token: "",
  project: "U24",
  team: [
    { name: "Ігор Шаповаленко", initials: "ІШ", role: "Android" },
    { name: "Олексій Підкуйко", initials: "ОП", role: "Backend" },
    { name: "Олександр Жмурко", initials: "ОЖ", role: "QA" },
    { name: "Дмитро Пасінчук", initials: "ДП", role: "iOS" },
    { name: "Ілля Герасимов", initials: "ІГ", role: "iOS" },
  ],
};

let sprints = [];
let allAvailableSprints = [];
let sprintDays = [];
let vacDays = [];
let openPersons = [];
let openStatuses = {};
let allExpanded = true;
let currentFilter = "all";
let groupByPerson = true;
let currentTab = 0;
let currentAnalyticsSprint = 0;
let backlogFilter = "all";
let dragKey = null;
let dragFrom = null;
let dragFromSprint = null;
let orig = {};
let _backlog = [];
let _boardId = null;
let aiAnalysisCache = {};
let editingEst = null;
let currentLang = localStorage.getItem("capacity-lang") || "uk";

const T = {
  uk: {
    appTitle: "Capacity Planning",
    appSubtitle: "UNITED24 · SPRINT BOARD",
    btnAll: "Усі",
    btnInProgress: "In Progress",
    btnNoEst: "Без оцінки",
    btnCollapse: "Згорнути всіх",
    btnExpand: "Розгорнути всіх",
    btnByPerson: "👤 По людях",
    btnAllScope: "📋 Весь скоуп",
    tabBacklog: "Backlog",
    tabAnalytics: "📊 Аналітика",
    tabHint: "← перетягни задачу на вкладку для переносу між спринтами",
    modalApplyTitle: "Застосувати зміни в Jira",
  },
  en: {
    appTitle: "Capacity Planning",
    appSubtitle: "UNITED24 · SPRINT BOARD",
    btnAll: "All",
    btnInProgress: "In Progress",
    btnNoEst: "No estimate",
    btnCollapse: "Collapse all",
    btnExpand: "Expand all",
    btnByPerson: "👤 By person",
    btnAllScope: "📋 All tasks",
    tabBacklog: "Backlog",
    tabAnalytics: "📊 Analytics",
    tabHint: "← drag a task to a tab to move between sprints",
    modalApplyTitle: "Apply Changes to Jira",
  },
};

function t(key) {
  return T[currentLang]?.[key] || T.uk[key] || key;
}

function memberKey(member) {
  return member.name.replace(/\s+/g, "_").toLowerCase();
}

function getMember(pid) {
  return cfg.team.find((member) => memberKey(member) === pid);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attr(value) {
  return esc(value).replace(/`/g, "&#96;");
}

function trunc(value, length) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function jiraIssueUrl(key) {
  const base = (cfg.url || "").replace(/\/$/, "");
  return `${base}/browse/${encodeURIComponent(key)}`;
}

function sprintByIndex(index) {
  return sprints[parseInt(index, 10)] || null;
}

function applyLang() {
  const langBtn = document.getElementById("lang-btn");
  if (langBtn) langBtn.textContent = currentLang === "en" ? "🇺🇦 UA" : "🇬🇧 EN";
  const map = {
    "app-title": t("appTitle"),
    "app-subtitle": t("appSubtitle"),
    "btn-all": t("btnAll"),
    "btn-inprogress": t("btnInProgress"),
    "btn-noest": t("btnNoEst"),
    "tab-backlog-label": t("tabBacklog"),
    "tab-analytics-label": t("tabAnalytics"),
    "tab-hint-text": t("tabHint"),
    "modal-title-text": t("modalApplyTitle"),
  };
  Object.entries(map).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });
  const toggleButton = document.getElementById("tog-btn");
  if (toggleButton) toggleButton.textContent = allExpanded ? t("btnCollapse") : t("btnExpand");
  const groupToggle = document.getElementById("group-toggle");
  if (groupToggle) groupToggle.textContent = groupByPerson ? t("btnByPerson") : t("btnAllScope");
}

function switchLang() {
  currentLang = currentLang === "uk" ? "en" : "uk";
  localStorage.setItem("capacity-lang", currentLang);
  applyLang();
  renderAll(_backlog);
}

function addTeamRow(name = "", initials = "", role = "iOS") {
  const list = document.getElementById("team-list");
  const row = document.createElement("div");
  row.className = "team-row";
  row.innerHTML = `
    <input type="text" placeholder="Ім'я в Jira" value="${attr(name)}">
    <input type="text" placeholder="ІН" value="${attr(initials)}" style="width:50px;flex:none;">
    <select>${["Android", "iOS", "Backend", "QA", "Design", "Other"].map((r) => `<option${r === role ? " selected" : ""}>${r}</option>`).join("")}</select>
    <button class="btn-remove" onclick="this.parentElement.remove()">×</button>`;
  list.appendChild(row);
}

function addSettingsTeamRow(name = "", initials = "", role = "iOS") {
  const list = document.getElementById("s-team-list");
  const row = document.createElement("div");
  row.className = "settings-row";
  row.innerHTML = `
    <input type="text" placeholder="Ім'я в Jira" value="${attr(name)}">
    <input type="text" placeholder="ІН" value="${attr(initials)}" style="width:50px;flex:none;">
    <select>${["Android", "iOS", "Backend", "QA", "Design", "Other"].map((r) => `<option${r === role ? " selected" : ""}>${r}</option>`).join("")}</select>
    <button class="btn-remove" onclick="this.parentElement.remove()">×</button>`;
  list.appendChild(row);
}

function getTeamFromForm(listId = "team-list") {
  const rows = document.querySelectorAll(`#${listId} .team-row, #${listId} .settings-row`);
  const team = [];
  rows.forEach((row) => {
    const inputs = row.querySelectorAll("input");
    const select = row.querySelector("select");
    if (inputs[0].value.trim()) {
      team.push({
        name: inputs[0].value.trim(),
        initials: inputs[1].value.trim() || inputs[0].value.trim().split(" ").map((word) => word[0]).join("").slice(0, 2),
        role: select.value,
      });
    }
  });
  return team;
}

function showErr(message) {
  const error = document.getElementById("err-msg");
  error.textContent = message;
  error.style.display = "block";
}

function hideErr() {
  document.getElementById("err-msg").style.display = "none";
}

function setLoading(show, text = "") {
  document.getElementById("loading").style.display = show ? "flex" : "none";
  document.getElementById("board").style.display = show ? "none" : "block";
  if (text) document.getElementById("loading-text").textContent = text;
}

function showNotice(msg, type) {
  const notice = document.getElementById("notice");
  notice.textContent = msg;
  notice.className = `notice ${type} show`;
  clearTimeout(notice._t);
  notice._t = setTimeout(() => notice.classList.remove("show"), 5000);
}

function formatDates(start, end) {
  if (!start || !end) return "дати не задані";
  const formatDate = (date) => new Date(date).toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
  return `${formatDate(start)} — ${formatDate(end)}`;
}

function jiraHeaders() {
  return {
    Authorization: "Basic " + btoa(`${cfg.email}:${cfg.token}`),
    "Content-Type": "application/json",
  };
}

function buildUrl(jiraPath) {
  const jiraFullUrl = `${cfg.url}/rest/api/3${jiraPath}`;
  if (cfg.proxyUrl) {
    return `${cfg.proxyUrl}/proxy?target=${encodeURIComponent(jiraFullUrl)}`;
  }
  return jiraFullUrl;
}

function buildAgileUrl(path) {
  const jiraFullUrl = `${cfg.url}/rest/agile/1.0${path}`;
  if (cfg.proxyUrl) {
    return `${cfg.proxyUrl}/proxy?target=${encodeURIComponent(jiraFullUrl)}`;
  }
  return jiraFullUrl;
}

async function jiraGet(path) {
  const response = await fetch(buildUrl(path), { headers: jiraHeaders() });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jira API ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function jiraPut(path, body) {
  const response = await fetch(buildUrl(path), {
    method: "PUT",
    headers: jiraHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Jira API ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function searchJira(jql, fields, startAt = 0, maxResults = 100) {
  const params = new URLSearchParams({
    jql,
    fields: fields.join(","),
    startAt,
    maxResults,
  });
  const response = await fetch(buildUrl(`/search/jql?${params.toString()}`), {
    method: "GET",
    headers: jiraHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Search failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return response.json();
}

const FIELDS = ["summary", "assignee", "status", "issuetype", "timeestimate", "timeoriginalestimate", "timespent", "parent", "customfield_10020", "components", "priority", "customfield_10014", "customfield_10015", "created", "updated"];

async function fetchPersonIssues(sprintName, personName) {
  try {
    const jql = `project = ${cfg.project} AND sprint = "${sprintName}" AND assignee = "${personName}"`;
    const data = await searchJira(jql, [...FIELDS, "parent"]);
    return data.issues || [];
  } catch {
    return [];
  }
}

async function fetchUnassignedIssues(sprintName) {
  const jql = `project = ${cfg.project} AND sprint = "${sprintName}" AND assignee is EMPTY`;
  const data = await searchJira(jql, FIELDS);
  return data.issues || [];
}

async function fetchPrevSprintKeys(currentSprintName) {
  try {
    const jql = `project = ${cfg.project} AND sprint in closedSprints() ORDER BY updated DESC`;
    const data = await searchJira(jql, ["customfield_10020", "summary", "status"], 0, 100);
    if (!data.issues?.length) return { keys: new Set(), name: "" };
    const sprintFields = data.issues[0]?.fields?.customfield_10020 || [];
    const closed = sprintFields
      .filter((sprint) => sprint.state === "closed" && sprint.name !== currentSprintName)
      .sort((a, b) => new Date(b.endDate || 0) - new Date(a.endDate || 0));
    const prevSprint = closed[0];
    if (!prevSprint) return { keys: new Set(), name: "" };
    const prevJql = `project = ${cfg.project} AND sprint = "${prevSprint.name}"`;
    const prevData = await searchJira(prevJql, ["summary", "status"], 0, 200);
    const keys = new Set((prevData.issues || []).map((issue) => issue.key));
    const byStatus = {};
    (prevData.issues || []).forEach((issue) => {
      byStatus[issue.fields.status.name] = (byStatus[issue.fields.status.name] || 0) + 1;
    });
    return { keys, name: prevSprint.name, total: prevData.issues?.length || 0, byStatus };
  } catch (error) {
    console.warn("fetchPrevSprintKeys failed:", error);
    return { keys: new Set(), name: "" };
  }
}

async function fetchBacklogIssues() {
  const jql = `project = ${cfg.project} AND sprint is EMPTY AND status != Done ORDER BY priority ASC, created DESC`;
  const data = await searchJira(jql, FIELDS, 0, 100);
  return data.issues || [];
}

async function fetchAllSprints() {
  const results = [];
  try {
    const jql = `project = ${cfg.project} AND sprint in openSprints()`;
    const data = await searchJira(jql, ["customfield_10020"], 0, 1);
    const issue = data.issues?.[0];
    if (issue) {
      (issue.fields.customfield_10020 || [])
        .filter((sprint) => sprint.state === "active")
        .forEach((sprint) => {
          if (!results.find((result) => result.id === sprint.id)) results.push(sprint);
        });
    }
  } catch {}

  try {
    if (_boardId) {
      const response = await fetch(buildAgileUrl(`/board/${_boardId}/sprint?state=future`), {
        method: "GET",
        headers: jiraHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        (data.values || []).forEach((sprint) => {
          if (!results.find((result) => result.id === sprint.id)) results.push(sprint);
        });
      }
    }
  } catch {}

  const order = { active: 0, future: 1 };
  return results.sort((a, b) => (order[a.state] || 1) - (order[b.state] || 1));
}

async function getActiveSprints() {
  try {
    const boardResponse = await fetch(buildAgileUrl(`/board?projectKeyOrId=${cfg.project}&type=scrum`), {
      method: "GET",
      headers: jiraHeaders(),
    });
    if (boardResponse.ok) {
      const boardData = await boardResponse.json();
      const board = (boardData.values || [])[0];
      if (board?.id) _boardId = board.id;
    }
  } catch (error) {
    console.warn("Board lookup failed:", error);
  }

  if (_boardId) {
    try {
      const [activeResponse, futureResponse] = await Promise.all([
        fetch(buildAgileUrl(`/board/${_boardId}/sprint?state=active`), { method: "GET", headers: jiraHeaders() }),
        fetch(buildAgileUrl(`/board/${_boardId}/sprint?state=future`), { method: "GET", headers: jiraHeaders() }),
      ]);
      const activeSprints = activeResponse.ok ? ((await activeResponse.json()).values || []) : [];
      const futureSprints = futureResponse.ok ? ((await futureResponse.json()).values || []) : [];
      const combined = activeSprints.length > 0 ? [...activeSprints, ...futureSprints.slice(0, 1)] : futureSprints.slice(0, 2);
      if (combined.length > 0) return combined.slice(0, 2);
    } catch (error) {
      console.warn("Agile sprint fetch failed:", error);
    }
  }

  const activeJql = `project = ${cfg.project} AND sprint in openSprints() ORDER BY created ASC`;
  const activeData = await searchJira(activeJql, ["customfield_10020"], 0, 1);
  const activeIssue = (activeData.issues || [])[0];
  const activeSprints = activeIssue ? (activeIssue.fields.customfield_10020 || []).filter((sprint) => sprint.state === "active") : [];
  if (activeSprints[0]?.boardId) _boardId = activeSprints[0].boardId;
  if (activeSprints.length > 0) return activeSprints.slice(0, 1);
  throw new Error(`Не знайдено активних або майбутніх спринтів у проекті ${cfg.project}`);
}

function parseIssue(issue) {
  const parent = issue.fields.parent;
  const parentType = parent?.fields?.issuetype?.name;
  let epicName = null;
  if (parentType === "Epic" && parent.fields?.summary) epicName = parent.fields.summary;
  if (!epicName && typeof issue.fields.customfield_10015 === "string" && issue.fields.customfield_10015) {
    epicName = issue.fields.customfield_10015;
  }
  const parentKey = parentType === "Story" || parentType === "Task" ? parent?.key : null;
  const parentInfo = parentKey ? {
    key: parent.key,
    sum: parent.fields?.summary || "",
    type: parentType,
    typeIconUrl: parent.fields?.issuetype?.iconUrl || "",
    priority: issue.fields.priority?.name || "Medium",
    epic: null,
    est: 0,
    rem: 0,
  } : null;
  return {
    key: issue.key,
    type: issue.fields.issuetype.name,
    typeIconUrl: issue.fields.issuetype.iconUrl || "",
    status: issue.fields.status.name,
    est: Math.round((issue.fields.timeoriginalestimate || 0) / 360) / 10,
    rem: issue.fields.timeestimate > 0 ? Math.round(issue.fields.timeestimate / 360) / 10 : Math.round((issue.fields.timeoriginalestimate || 0) / 360) / 10,
    sum: issue.fields.summary,
    priority: issue.fields.priority?.name || "Medium",
    epic: epicName,
    parentKey,
    parentInfo,
    assignee: issue.fields.assignee?.displayName || null,
    created: issue.fields.created || null,
    updated: issue.fields.updated || null,
  };
}

async function loadData() {
  setLoading(true, "Знаходимо активні спринти...");
  try {
    allAvailableSprints = await fetchAllSprints();
  } catch (error) {
    console.warn("fetchAllSprints:", error);
  }

  const sprintDefs = (await getActiveSprints()).slice(0, 2);
  try {
    allAvailableSprints = await fetchAllSprints();
  } catch (error) {
    console.warn("fetchAllSprints after board lookup:", error);
  }
  sprints = [];
  sprintDays = [];
  vacDays = [];
  openPersons = [];
  orig = {};

  for (let si = 0; si < sprintDefs.length; si += 1) {
    const sprint = sprintDefs[si];
    setLoading(true, `Завантажуємо ${sprint.name}...`);
    const start = new Date(sprint.startDate);
    const end = new Date(sprint.endDate);
    let workingDays = 0;
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      if (date.getDay() !== 0 && date.getDay() !== 6) workingDays += 1;
    }

    const tasks = {};
    const vacationDays = {};
    const openedPeople = {};
    for (const member of cfg.team) {
      setLoading(true, `${sprint.name}: завантажуємо ${member.name}...`);
      const pid = memberKey(member);
      try {
        const issues = await fetchPersonIssues(sprint.name, member.name);
        tasks[pid] = issues.filter((issue) => !SKIP_STATUSES.has(issue.fields.status.name)).map(parseIssue);
        tasks[pid].forEach((task) => {
          orig[task.key] = { sprint: si, person: pid };
        });
      } catch (error) {
        console.warn(`Failed to load ${member.name} for ${sprint.name}:`, error);
        tasks[pid] = [];
      }
      vacationDays[pid] = 0;
      openedPeople[pid] = true;
    }

    let prevSprintInfo = { keys: new Set(), name: "", total: 0, byStatus: {} };
    if (si === 0) prevSprintInfo = await fetchPrevSprintKeys(sprint.name);

    let unassigned = [];
    try {
      unassigned = (await fetchUnassignedIssues(sprint.name)).filter((issue) => !SKIP_STATUSES.has(issue.fields.status.name)).map(parseIssue);
    } catch (error) {
      console.warn("Failed to load unassigned issues:", error);
    }

    sprints.push({
      id: sprint.id ?? si,
      name: sprint.name,
      dates: formatDates(sprint.startDate || "", sprint.endDate || ""),
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      goal: sprint.goal || "",
      state: sprint.state || "future",
      tasks,
      unassigned,
      prevSprintInfo,
    });
    sprintDays.push(workingDays);
    vacDays.push(vacationDays);
    openPersons.push(openedPeople);
  }

  try {
    _backlog = (await fetchBacklogIssues()).map(parseIssue);
  } catch (error) {
    console.warn("Backlog load failed:", error);
    _backlog = [];
  }
  setLoading(false);
  renderAll(_backlog);
}

function getCap(si, pid) {
  return Math.max(0, (sprintDays[si] - (vacDays[si][pid] || 0)) * HPD);
}

function getRem(si, pid) {
  return Math.round(sprints[si].tasks[pid].filter((task) => !DONE_STATUSES.has(task.status)).reduce((sum, task) => sum + task.rem, 0) * 10) / 10;
}

function getPct(si, pid) {
  const capacity = getCap(si, pid);
  return capacity > 0 ? Math.round(getRem(si, pid) / capacity * 100) : 0;
}

function barCol(pct) {
  return pct <= 85 ? "#639922" : pct <= 95 ? "#BA7517" : "#E24B4A";
}

function getChanges() {
  const changes = [];
  sprints.forEach((sprint, sprintIndex) => {
    Object.entries(sprint.tasks).forEach(([pid, list]) => {
      list.forEach((task) => {
        const original = orig[task.key];
        if (original && (original.sprint !== sprintIndex || original.person !== pid)) {
          changes.push({ key: task.key, sum: task.sum, fromSprint: original.sprint, fromPerson: original.person, toSprint: sprintIndex, toPerson: pid });
        }
      });
    });
  });
  return changes;
}

function filterT(task) {
  if (currentFilter === "inprogress") return task.status === "In Progress";
  if (currentFilter === "noest") return task.est === 0;
  return true;
}

function issueTypeIcon(type, iconUrl) {
  if (iconUrl) {
    return `<img src="${attr(iconUrl)}" title="${attr(type)}" style="width:14px;height:14px;margin-right:3px;vertical-align:middle;flex-shrink:0;" onerror="this.style.display='none'">`;
  }
  const icons = { Bug: "🐛", Task: "✅", "Sub-task": "↳", Story: "📖", Epic: "⚡", Improvement: "⬆️", Spike: "🔍", Art: "🎨" };
  return `<span title="${attr(type)}" style="font-size:13px;margin-right:3px;">${icons[type] || "📌"}</span>`;
}

function priorityBadge(priority) {
  const config = {
    Critical: { icon: "🔴", color: "#A32D2D", bg: "#FCEBEB", border: "#F7C1C1" },
    Highest: { icon: "🔴", color: "#A32D2D", bg: "#FCEBEB", border: "#F7C1C1" },
    High: { icon: "🟡", color: "#854F0B", bg: "#FAEEDA", border: "#FAC775" },
    Medium: { icon: "🟢", color: "#3B6D11", bg: "#EAF3DE", border: "#9FE1CB" },
    Low: { icon: "🔵", color: "#185FA5", bg: "#E6F1FB", border: "#B5D4F4" },
    Lowest: { icon: "⚪", color: "#666660", bg: "#F1EFE8", border: "#D0D0CC" },
  };
  const colors = config[priority] || config.Medium;
  return `<span style="font-size:11px;font-weight:500;color:${colors.color};background:${colors.bg};border:1px solid ${colors.border};padding:1px 6px;border-radius:4px;white-space:nowrap;">${colors.icon} ${esc(priority || "Medium")}</span>`;
}

function renderBacklog() {
  const panel = document.getElementById("panel-backlog");
  if (!panel) return;
  const filtered = _backlog.filter((task) => {
    if (backlogFilter === "noest") return task.est === 0;
    if (backlogFilter === "bug") return task.type === "Bug";
    return true;
  });
  const sprintOptions = sprints.map((sprint, si) => `<option value="${si}">${esc(sprint.name)}</option>`).join("");
  panel.innerHTML = `
    <div class="backlog-section">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:.75rem;">
        <div style="font-size:15px;font-weight:600;color:var(--text);">Backlog</div>
        <div style="font-size:13px;color:var(--text2);">${_backlog.length} задач</div>
      </div>
      <div class="backlog-filter">
        <button class="bfbtn${backlogFilter === "all" ? " active" : ""}" onclick="setBFilter('all',this)">Всі</button>
        <button class="bfbtn${backlogFilter === "noest" ? " active" : ""}" onclick="setBFilter('noest',this)">Без оцінки</button>
        <button class="bfbtn${backlogFilter === "bug" ? " active" : ""}" onclick="setBFilter('bug',this)">Bugs</button>
      </div>
      ${filtered.length ? `
        <div class="backlog-hdr"><span>Тип · Ключ</span><span>Назва</span><span>Епік</span><span>Пріоритет</span><span>Est / Rem</span><span>Дія</span></div>
        ${filtered.map((task) => `
          <div class="backlog-row">
            <a href="${jiraIssueUrl(task.key)}" class="tkey" target="_blank">${esc(task.key)}</a>
            <span class="tsum" title="${attr(task.sum)}">${esc(trunc(task.sum, 45))}</span>
            ${task.epic ? `<span class="epic-tag" title="${attr(task.epic)}">${esc(trunc(task.epic, 14))}</span>` : `<span class="ttype">${esc(task.type)}</span>`}
            ${priorityBadge(task.priority)}
            ${task.est === 0 ? `<span class="no-est">нема</span>` : `<span class="est-rem">${task.est}г<span class="rem"> / ${task.rem}г</span></span>`}
            <select onchange="addToSprint(decodeURIComponent('${encodeURIComponent(task.key)}'),this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);">
              <option value="">+ В спринт...</option>
              ${sprintOptions}
            </select>
          </div>`).join("")}
      ` : '<div class="no-issues">Немає задач за фільтром</div>'}
    </div>`;
}

function renderAnalytics() {
  const si = currentAnalyticsSprint;
  const sprint = sprints[si];
  if (!sprint) return;
  const panel = document.getElementById("panel-analytics");
  if (!panel) return;
  const allTasks = Object.values(sprint.tasks || {}).flat();
  const all = [...allTasks, ...(sprint.unassigned || [])];
  const totalRemaining = all.filter((task) => !DONE_STATUSES.has(task.status)).reduce((sum, task) => sum + task.rem, 0);
  const totalCapacity = cfg.team.reduce((sum, member) => sum + getCap(si, memberKey(member)), 0);
  const totalDone = all.filter((task) => DONE_STATUSES.has(task.status)).length;
  const donePct = all.length ? Math.round(totalDone / all.length * 100) : 0;
  panel.innerHTML = `
    <div style="margin-bottom:1rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <div style="font-size:15px;font-weight:600;color:var(--text);">Sprint Health Dashboard</div>
      <select onchange="currentAnalyticsSprint=parseInt(this.value, 10);renderAnalytics();" style="font-size:13px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);">
        ${sprints.map((sp, index) => `<option value="${index}"${index === si ? " selected" : ""}>${esc(sp.name)}</option>`).join("")}
      </select>
    </div>
    <div class="analytics-grid" style="grid-template-columns:repeat(4,1fr);">
      <div class="an-card"><div class="an-card-title">📅 Прогрес часу</div><div class="an-big">${sprintDays[si]}</div><div class="an-sub">робочих днів</div></div>
      <div class="an-card"><div class="an-card-title">✅ Виконано</div><div class="an-big">${donePct}%</div><div class="an-sub">${totalDone} з ${all.length} задач</div></div>
      <div class="an-card"><div class="an-card-title">⏱ Remaining</div><div class="an-big">${Math.round(totalRemaining)}г</div><div class="an-sub">ще залишилось</div></div>
      <div class="an-card"><div class="an-card-title">👥 Навантаження</div><div class="an-big">${totalCapacity ? Math.round(totalRemaining / totalCapacity * 100) : 0}%</div><div class="an-sub">від загальної capacity</div></div>
    </div>`;
}

function renderPerson(si, member, changedKeys) {
  const pid = memberKey(member);
  const tasks = (sprints[si].tasks[pid] || []).filter(filterT);
  const pct = getPct(si, pid);
  const rem = getRem(si, pid);
  const cap = getCap(si, pid);
  const color = barCol(pct);
  const roleColors = ROLE_COLORS[member.role] || ROLE_COLORS.Other;
  const groups = {};
  tasks.forEach((task) => {
    if (!groups[task.status]) groups[task.status] = [];
    groups[task.status].push(task);
  });
  const groupsHtml = STATUS_ORDER.filter((status) => groups[status]).map((status) => {
    const statusConfig = SC[status] || { color: "#888", bg: "#f5f5f5" };
    const list = groups[status];
    const sgId = `${si}-${pid}-${status.replace(/\s/g, "_")}`;
    if (!(sgId in openStatuses)) openStatuses[sgId] = true;
    return `
      <div class="sg" style="border-color:${statusConfig.color}33;">
        <div class="sg-head" style="background:${statusConfig.bg};" onclick="toggleSg('${sgId}')">
          <div class="sdot" style="background:${statusConfig.color};"></div>
          <span class="sname" style="color:${statusConfig.color};">${esc(status)}</span>
          <span class="scount">${list.length}</span>
          <span class="srem" style="color:${statusConfig.color};">${Math.round(list.reduce((sum, task) => sum + task.rem, 0) * 10) / 10}г</span>
          <span class="sgchev${openStatuses[sgId] ? " open" : ""}" id="sgc-${sgId}">›</span>
        </div>
        <div class="sg-body${openStatuses[sgId] ? " open" : ""}" id="sgb-${sgId}">
          <div class="task-hdr"><span>Тип · Ключ</span><span>Назва</span><span>Епік</span><span>Пріоритет</span><span style="text-align:right;">Est / Rem</span></div>
          ${list.map((task) => `
            <div class="task-row${changedKeys.includes(task.key) ? " changed" : ""}" draggable="true" data-key="${attr(task.key)}" data-from="${attr(pid)}" data-sprint="${si}">
              <span style="display:flex;align-items:center;gap:3px;">${issueTypeIcon(task.type, task.typeIconUrl)}<a href="${jiraIssueUrl(task.key)}" class="tkey" target="_blank" onclick="event.stopPropagation()">${esc(task.key)}</a></span>
              <span class="tsum" title="${attr(task.sum)}">${esc(trunc(task.sum, 45))}</span>
              ${task.epic ? `<span class="epic-tag" title="${attr(task.epic)}">${esc(trunc(task.epic, 16))}</span>` : `<span class="ttype" style="color:var(--text3);">—</span>`}
              ${priorityBadge(task.priority)}
              ${task.est === 0 ? `<span class="no-est">нема</span>` : `<span class="est-rem">${task.est}г <span class="rem">/ ${task.rem}г</span></span>`}
            </div>`).join("")}
        </div>
      </div>`;
  }).join("");

  return `
    <div class="person-block" id="pb-${si}-${pid}" ondragover="onOver(event,${si},'${pid}')" ondrop="onDrop(event,${si},'${pid}')" ondragleave="onLeave(${si},'${pid}')">
      <div class="person-head" onclick="toggleP(${si},'${pid}')">
        <div class="avatar" style="background:${roleColors.bg};color:${roleColors.color};">${esc(member.initials)}</div>
        <div style="flex:1;min-width:0;">
          <div class="pname">${esc(member.name.split(" ").slice(0, 2).join(" "))}</div>
          <div class="pmeta">${esc(member.role)} · ${(sprints[si].tasks[pid] || []).length} задач</div>
        </div>
        <div class="load-wrap">
          <div class="bar-bg"><div class="bar-fill" style="width:${Math.min(pct, 100)}%;background:${color};"></div></div>
          <span class="pct-lbl" style="color:${color};">${pct}%</span>
          <span class="rem-lbl">${rem}г/${cap}г</span>
        </div>
        <span class="chev${openPersons[si]?.[pid] !== false ? " open" : ""}" id="chv-${si}-${pid}">›</span>
      </div>
      <div class="person-body${openPersons[si]?.[pid] !== false ? " open" : ""}" id="pbd-${si}-${pid}">
        <div class="body-inner">${groupsHtml || `<div style="font-size:12px;color:var(--text3);padding:10px 0;text-align:center;">Немає активних задач — перетягни сюди</div>`}</div>
      </div>
    </div>`;
}

function bindDrag() {
  document.querySelectorAll("[draggable='true'][data-key][data-from][data-sprint]").forEach((element) => {
    element.addEventListener("dragstart", (event) => {
      dragKey = element.dataset.key;
      dragFrom = element.dataset.from;
      dragFromSprint = parseInt(element.dataset.sprint, 10);
      setTimeout(() => element.classList.add("dragging"), 0);
      event.stopPropagation();
    });
    element.addEventListener("dragend", () => element.classList.remove("dragging"));
  });
}

function findTaskOwner(si, key) {
  return cfg.team.map(memberKey).find((pid) => (sprints[si].tasks[pid] || []).some((task) => task.key === key)) || "";
}

function renderAllTasks(si, changedKeys) {
  const sprint = sprints[si];
  const assigned = Object.values(sprint.tasks || {}).flat();
  const allTasks = [...assigned, ...(sprint.unassigned || [])].filter(filterT);
  const groups = {};
  allTasks.forEach((task) => {
    if (!groups[task.status]) groups[task.status] = [];
    groups[task.status].push(task);
  });
  const statuses = [
    ...STATUS_ORDER.filter((status) => groups[status]),
    ...Object.keys(groups).filter((status) => !STATUS_ORDER.includes(status)).sort(),
  ];
  if (!statuses.length) {
    return `<div style="font-size:12px;color:var(--text3);text-align:center;padding:2rem;">Немає задач</div>`;
  }
  return statuses.map((status) => {
    const statusConfig = SC[status] || { color: "#888", bg: "#f5f5f5" };
    const list = groups[status];
    const sgId = `all-${si}-${status.replace(/\s/g, "_")}`;
    if (!(sgId in openStatuses)) openStatuses[sgId] = true;
    return `
      <div class="sg" style="border-color:${statusConfig.color}33;">
        <div class="sg-head" style="background:${statusConfig.bg};" onclick="toggleSg('${sgId}')">
          <div class="sdot" style="background:${statusConfig.color};"></div>
          <span class="sname" style="color:${statusConfig.color};">${esc(status)}</span>
          <span class="scount">${list.length}</span>
          <span class="srem" style="color:${statusConfig.color};">${Math.round(list.reduce((sum, task) => sum + task.rem, 0) * 10) / 10}г</span>
          <span class="sgchev${openStatuses[sgId] ? " open" : ""}" id="sgc-${sgId}">›</span>
        </div>
        <div class="sg-body${openStatuses[sgId] ? " open" : ""}" id="sgb-${sgId}">
          <div class="task-hdr allscope-hdr"><span>Тип · Ключ</span><span>Назва</span><span>Епік</span><span>Хто</span><span style="text-align:right;">Est / Rem</span></div>
          ${list.map((task) => {
            const pid = findTaskOwner(si, task.key);
            const member = getMember(pid);
            const draggable = pid ? ` draggable="true" data-key="${attr(task.key)}" data-from="${attr(pid)}" data-sprint="${si}"` : "";
            return `
              <div class="task-row allscope-row${changedKeys.includes(task.key) ? " changed" : ""}"${draggable}>
                <span style="display:flex;align-items:center;gap:3px;">${issueTypeIcon(task.type, task.typeIconUrl)}<a href="${jiraIssueUrl(task.key)}" class="tkey" target="_blank" onclick="event.stopPropagation()">${esc(task.key)}</a></span>
                <span class="tsum" title="${attr(task.sum)}">${esc(trunc(task.sum, 45))}</span>
                ${task.epic ? `<span class="epic-tag" title="${attr(task.epic)}">${esc(trunc(task.epic, 16))}</span>` : `<span class="ttype" style="color:var(--text3);">—</span>`}
                <span style="font-size:10px;color:${member ? "var(--text2)" : "var(--amber)"};">${member ? esc(member.initials) : "?"}</span>
                ${task.est === 0 ? `<span class="no-est">нема</span>` : `<span class="est-rem">${task.est}г <span class="rem">/ ${task.rem}г</span></span>`}
              </div>`;
          }).join("")}
        </div>
      </div>`;
  }).join("");
}

function renderAll(backlogIssues) {
  if (backlogIssues !== undefined) _backlog = backlogIssues;
  document.getElementById("board").style.display = "block";
  const backlogPct = document.getElementById("tab-pct-backlog");
  if (backlogPct) backlogPct.textContent = _backlog.length ? `${_backlog.length}` : "";
  const changedKeys = getChanges().map((change) => change.key);
  for (let i = 0; i <= 1; i += 1) {
    const tab = document.getElementById(`tab-s${i}`);
    if (tab) tab.style.display = i < sprints.length ? "" : "none";
  }
  sprints.forEach((sprint, si) => {
    document.getElementById(`tab-name-${si}`).textContent = sprint.name;
    const totalCapacity = cfg.team.reduce((sum, member) => sum + getCap(si, memberKey(member)), 0);
    const totalRemaining = cfg.team.reduce((sum, member) => sum + getRem(si, memberKey(member)), 0);
    const pct = totalCapacity > 0 ? Math.round(totalRemaining / totalCapacity * 100) : 0;
    const pctEl = document.getElementById(`tab-pct-${si}`);
    pctEl.textContent = `${pct}%`;
    pctEl.style.color = barCol(pct);
    const panel = document.getElementById(`panel-${si}`);
    panel.innerHTML = `
      <div class="sprint-header">
        <div class="sprint-top">
          <span class="sprint-name">${esc(sprint.name)}</span>
          <span class="sprint-badge" style="background:${sprint.state === "active" ? "#E6F1FB" : "#FAEEDA"};color:${sprint.state === "active" ? "#185FA5" : "#854F0B"};">${sprint.state === "active" ? "Активний" : "Майбутній"}</span>
        </div>
        <div class="sprint-dates">${esc(sprint.dates)}</div>
        ${sprint.goal ? `<div class="sprint-goal">${esc(sprint.goal)}</div>` : ""}
        <div class="days-row">
          <span class="days-label">Робочих днів:</span>
          <button class="dbtn" onclick="chDays(${si},-1)">−</button>
          <span class="dval" id="dd-${si}">${sprintDays[si]}</span>
          <button class="dbtn" onclick="chDays(${si},1)">+</button>
          <span class="days-cap" id="dc-${si}">(${sprintDays[si] * HPD}г/особу)</span>
        </div>
        <div class="sumrow">
          <div class="sc"><div class="sc-label">Капасіті</div><div class="sc-val" id="scap-${si}">${totalCapacity}г</div></div>
          <div class="sc"><div class="sc-label">Remaining</div><div class="sc-val" id="srem-${si}">${Math.round(totalRemaining * 10) / 10}г</div></div>
          <div class="sc"><div class="sc-label">Навантаження</div><div class="sc-val" id="sload-${si}" style="color:${barCol(pct)};">${pct}%</div></div>
        </div>
      </div>
      <div class="vac-bar"><div class="vac-title">Відпустки</div><div class="vac-grid">${cfg.team.map((member) => {
        const pid = memberKey(member);
        return `
          <div class="vi">
            <div class="vname" title="${attr(member.name)}">${esc(member.initials)}</div>
            <div class="vctrl">
              <button class="vbtn" onclick="chVac(${si},'${pid}',-1)">−</button>
              <span class="vval" id="vv-${si}-${pid}">${vacDays[si][pid] || 0}</span>
              <button class="vbtn" onclick="chVac(${si},'${pid}',1)">+</button>
            </div>
            <div class="vcap" id="vc-${si}-${pid}">${getCap(si, pid)}г</div>
          </div>`;
      }).join("")}</div></div>
      ${(sprint.unassigned || []).length ? `
        <div class="unassigned-block" id="ua-${si}">
          <div class="unassigned-head" onclick="toggleUA(${si})">
            <div style="width:34px;height:34px;border-radius:50%;background:var(--amber-bg);color:var(--amber);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">?</div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:500;color:var(--text);">Без асайні</div>
              <div style="font-size:11px;color:var(--text2);">${sprint.unassigned.length} задач · ${Math.round(sprint.unassigned.reduce((sum, task) => sum + task.rem, 0) * 10) / 10}г remaining</div>
            </div>
            <span class="chev open" id="ua-chev-${si}">›</span>
          </div>
          <div class="person-body open" id="ua-body-${si}">
            <div class="body-inner">
              <div class="task-hdr"><span>Тип · Ключ</span><span>Назва</span><span>Епік</span><span>Пріоритет</span><span style="text-align:right;">Est / Rem</span></div>
              ${sprint.unassigned.map((task) => `
                <div class="task-row" style="cursor:default;">
                  <span style="display:flex;align-items:center;gap:3px;">${issueTypeIcon(task.type, task.typeIconUrl)}<a href="${jiraIssueUrl(task.key)}" class="tkey" target="_blank">${esc(task.key)}</a></span>
                  <span class="tsum" title="${attr(task.sum)}">${esc(trunc(task.sum, 45))}</span>
                  ${task.epic ? `<span class="epic-tag" title="${attr(task.epic)}">${esc(trunc(task.epic, 16))}</span>` : `<span class="ttype" style="color:var(--text3);">—</span>`}
                  ${priorityBadge(task.priority)}
                  ${task.est === 0 ? `<span class="no-est">нема</span>` : `<span class="est-rem">${task.est}г<span class="rem"> / ${task.rem}г</span></span>`}
                </div>`).join("")}
            </div>
          </div>
        </div>` : ""}
      <div id="persons-${si}">${groupByPerson ? cfg.team.map((member) => renderPerson(si, member, changedKeys)).join("") : renderAllTasks(si, changedKeys)}</div>`;
  });
  bindDrag();
  document.getElementById("jbtn").classList.toggle("dirty", getChanges().length > 0);
  applyLang();
}

async function connect() {
  const url = document.getElementById("jira-url").value.trim().replace(/\/$/, "");
  const email = document.getElementById("jira-email").value.trim();
  const token = document.getElementById("jira-token").value.trim();
  const project = document.getElementById("jira-project").value.trim().toUpperCase();
  const team = getTeamFromForm();
  if (!url || !email || !token || !project || !team.length) {
    showErr("Заповни всі поля та додай хоча б одного учасника.");
    return;
  }
  const proxyUrl = document.getElementById("proxy-url").value.trim().replace(/\/$/, "");
  cfg = { url, email, token, project, team, proxyUrl };
  localStorage.setItem("capacity-cfg", JSON.stringify({ url, email, project, team, proxyUrl }));
  document.getElementById("btn-connect").disabled = true;
  document.getElementById("btn-connect").textContent = "Підключення...";
  hideErr();
  try {
    await loadData();
    document.getElementById("setup-screen").style.display = "none";
    document.getElementById("app").style.display = "block";
    document.getElementById("header-project").textContent = cfg.project;
  } catch (error) {
    showErr(`Помилка: ${error.message}`);
    document.getElementById("btn-connect").disabled = false;
    document.getElementById("btn-connect").textContent = "Підключитись і завантажити спринт";
  }
}

function switchTab(tab) {
  currentTab = tab;
  if (typeof tab === "number") currentAnalyticsSprint = tab;
  [0, 1].forEach((index) => {
    document.getElementById(`tab-s${index}`)?.classList.toggle("active", index === tab);
    document.getElementById(`panel-${index}`)?.classList.toggle("active", index === tab);
  });
  document.getElementById("tab-backlog")?.classList.toggle("active", tab === "backlog");
  document.getElementById("panel-backlog")?.classList.toggle("active", tab === "backlog");
  if (tab === "backlog") renderBacklog();
  document.getElementById("tab-analytics")?.classList.toggle("active", tab === "analytics");
  document.getElementById("panel-analytics")?.classList.toggle("active", tab === "analytics");
  if (tab === "analytics") renderAnalytics();
}

function toggleP(si, pid) {
  if (!openPersons[si]) openPersons[si] = {};
  openPersons[si][pid] = !(openPersons[si][pid] !== false);
  document.getElementById(`pbd-${si}-${pid}`)?.classList.toggle("open", openPersons[si][pid]);
  document.getElementById(`chv-${si}-${pid}`)?.classList.toggle("open", openPersons[si][pid]);
}

function toggleSg(sgId) {
  openStatuses[sgId] = !openStatuses[sgId];
  document.getElementById(`sgb-${sgId}`)?.classList.toggle("open", openStatuses[sgId]);
  document.getElementById(`sgc-${sgId}`)?.classList.toggle("open", openStatuses[sgId]);
}

function toggleUA(si) {
  const body = document.getElementById(`ua-body-${si}`);
  const chev = document.getElementById(`ua-chev-${si}`);
  const open = body?.classList.toggle("open");
  chev?.classList.toggle("open", open);
}

function toggleAll() {
  allExpanded = !allExpanded;
  sprints.forEach((_, si) => {
    cfg.team.forEach((member) => {
      const pid = memberKey(member);
      if (!openPersons[si]) openPersons[si] = {};
      openPersons[si][pid] = allExpanded;
      document.getElementById(`pbd-${si}-${pid}`)?.classList.toggle("open", allExpanded);
      document.getElementById(`chv-${si}-${pid}`)?.classList.toggle("open", allExpanded);
    });
  });
  applyLang();
}

function toggleGroupBy() {
  groupByPerson = !groupByPerson;
  renderAll();
}

function setFilter(filter, button) {
  currentFilter = filter;
  document.querySelectorAll(".fbtn").forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");
  renderAll();
}

function setBFilter(filter, button) {
  backlogFilter = filter;
  document.querySelectorAll(".bfbtn").forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");
  renderBacklog();
}

async function addToSprint(key, si) {
  if (si === "") return;
  const sprint = sprintByIndex(si);
  if (!sprint) return;
  try {
    const response = await fetch(buildAgileUrl(`/sprint/${sprint.id}/issue`), {
      method: "POST",
      headers: jiraHeaders(),
      body: JSON.stringify({ issues: [key] }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to add issue to sprint: ${response.status} ${text.slice(0, 120)}`);
    }
    _backlog = _backlog.filter((task) => task.key !== key);
    showNotice(`✓ ${key} додано в ${sprint.name}`, "ok");
    renderBacklog();
    renderAll(_backlog);
  } catch (error) {
    showNotice(`Помилка: ${error.message}`, "err");
  }
}

async function addSprintTab(sprintName) {
  if (sprints.length >= 2) {
    showNotice("Зараз відкрито максимум 2 спринти. Закрий або онови сторінку, щоб змінити набір.", "warn");
    return;
  }
  if (sprints.some((sprint) => sprint.name === sprintName)) {
    showNotice(`${sprintName} вже відкритий`, "warn");
    return;
  }
  const sprintMeta = allAvailableSprints.find((sprint) => sprint.name === sprintName);
  if (!sprintMeta) {
    showNotice("Спринт не знайдено", "err");
    return;
  }
  const si = sprints.length;
  setLoading(true, `Завантажуємо ${sprintMeta.name}...`);
  try {
    const start = new Date(sprintMeta.startDate || Date.now());
    const end = new Date(sprintMeta.endDate || Date.now());
    let workingDays = 0;
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      if (date.getDay() !== 0 && date.getDay() !== 6) workingDays += 1;
    }
    if (!workingDays) workingDays = 10;

    const tasks = {};
    const vacationDays = {};
    const openedPeople = {};
    for (const member of cfg.team) {
      const pid = memberKey(member);
      try {
        const issues = await fetchPersonIssues(sprintMeta.name, member.name);
        tasks[pid] = issues.filter((issue) => !SKIP_STATUSES.has(issue.fields.status.name)).map(parseIssue);
        tasks[pid].forEach((task) => {
          orig[task.key] = { sprint: si, person: pid };
        });
      } catch (error) {
        console.warn(`Failed to load ${member.name} for ${sprintMeta.name}:`, error);
        tasks[pid] = [];
      }
      vacationDays[pid] = 0;
      openedPeople[pid] = true;
    }

    let unassigned = [];
    try {
      unassigned = (await fetchUnassignedIssues(sprintMeta.name)).filter((issue) => !SKIP_STATUSES.has(issue.fields.status.name)).map(parseIssue);
    } catch (error) {
      console.warn("Failed to load unassigned issues:", error);
    }

    sprints.push({
      id: sprintMeta.id ?? si,
      name: sprintMeta.name,
      dates: formatDates(sprintMeta.startDate || "", sprintMeta.endDate || ""),
      startDate: sprintMeta.startDate,
      endDate: sprintMeta.endDate,
      goal: sprintMeta.goal || "",
      state: sprintMeta.state || "future",
      tasks,
      unassigned,
      prevSprintInfo: { keys: new Set(), name: "", total: 0, byStatus: {} },
    });
    sprintDays.push(workingDays);
    vacDays.push(vacationDays);
    openPersons.push(openedPeople);
    currentAnalyticsSprint = si;
    setLoading(false);
    renderAll();
    switchTab(si);
    showNotice(`✓ ${sprintMeta.name} додано`, "ok");
  } catch (error) {
    setLoading(false);
    showNotice(`Помилка додавання спринту: ${error.message}`, "err");
  }
}

function openModal() {
  const changes = getChanges();
  if (!changes.length) {
    showNotice("Немає змін для збереження.", "warn");
    return;
  }
  document.getElementById("modal-sub").textContent = `${changes.length} задач будуть переасайнені:`;
  document.getElementById("modal-list").innerHTML = changes.map((change) => {
    const toMember = getMember(change.toPerson);
    const fromSprint = sprints[change.fromSprint]?.name;
    const toSprint = sprints[change.toSprint]?.name;
    return `
      <div class="ch-row">
        <div class="ch-top">
          <span class="ch-key">${esc(change.key)}</span>
          <span class="ch-badge" style="background:#E6F1FB;color:#185FA5;">${esc(fromSprint)}</span>
          <span class="ch-arr">→</span>
          <span class="ch-badge" style="background:#E1F5EE;color:#0F6E56;">${esc(toSprint)}</span>
          ${change.fromPerson !== change.toPerson ? `<span style="font-size:11px;color:var(--text2);">· ${esc(toMember?.name || change.toPerson)}</span>` : ""}
        </div>
        <div class="ch-sum">${esc(trunc(change.sum, 60))}</div>
      </div>`;
  }).join("");
  document.getElementById("modal-bg").classList.add("open");
}

function closeModal() {
  document.getElementById("modal-bg").classList.remove("open");
}

async function applyJira() {
  const changes = getChanges();
  const button = document.getElementById("modal-apply-btn");
  button.disabled = true;
  button.textContent = "Збереження...";
  const errors = [];
  for (const change of changes) {
    const member = getMember(change.toPerson);
    if (!member) continue;
    try {
      const userSearch = await jiraGet(`/user/search?query=${encodeURIComponent(member.name)}&maxResults=1`);
      const accountId = userSearch[0]?.accountId;
      if (!accountId) {
        errors.push(`${change.key}: не знайдено користувача ${member.name}`);
        continue;
      }
      await jiraPut(`/issue/${change.key}`, { fields: { assignee: { accountId } } });
      if (change.fromSprint !== change.toSprint) {
        const targetSprint = sprints[change.toSprint];
        if (targetSprint?.id != null) {
          const response = await fetch(buildAgileUrl(`/sprint/${targetSprint.id}/issue`), {
            method: "POST",
            headers: jiraHeaders(),
            body: JSON.stringify({ issues: [change.key] }),
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(`sprint move failed: ${response.status} ${text.slice(0, 120)}`);
          }
        }
      }
      orig[change.key] = { sprint: change.toSprint, person: change.toPerson };
    } catch (error) {
      errors.push(`${change.key}: ${error.message}`);
    }
  }
  button.disabled = false;
  button.textContent = "Зберегти в Jira";
  closeModal();
  if (errors.length) {
    showNotice(`Частково застосовано. Помилки: ${errors.join("; ")}`, "err");
  } else {
    showNotice(`✓ ${changes.length} задач оновлено в Jira!`, "ok");
  }
  renderAll();
}

function openSettings() {
  document.getElementById("s-jira-url").value = cfg.url;
  document.getElementById("s-jira-email").value = cfg.email;
  document.getElementById("s-jira-token").value = "";
  document.getElementById("s-proxy-url").value = cfg.proxyUrl || "";
  document.getElementById("s-jira-project").value = cfg.project;
  document.getElementById("s-team-list").innerHTML = "";
  cfg.team.forEach((member) => addSettingsTeamRow(member.name, member.initials, member.role));
  document.getElementById("settings-bg").classList.add("open");
}

function closeSettings() {
  document.getElementById("settings-bg").classList.remove("open");
}

async function saveSettings() {
  const newToken = document.getElementById("s-jira-token").value.trim();
  cfg.url = document.getElementById("s-jira-url").value.trim().replace(/\/$/, "");
  cfg.email = document.getElementById("s-jira-email").value.trim();
  cfg.project = document.getElementById("s-jira-project").value.trim().toUpperCase();
  cfg.team = getTeamFromForm("s-team-list");
  cfg.proxyUrl = document.getElementById("s-proxy-url").value.trim().replace(/\/$/, "");
  if (newToken) cfg.token = newToken;
  localStorage.setItem("capacity-cfg", JSON.stringify({ url: cfg.url, email: cfg.email, project: cfg.project, team: cfg.team, proxyUrl: cfg.proxyUrl }));
  closeSettings();
  await refreshData();
}

async function refreshData() {
  try {
    await loadData();
    showNotice("✓ Дані оновлено з Jira", "ok");
  } catch (error) {
    showNotice(`Помилка оновлення: ${error.message}`, "err");
  }
}

function onOver(event, si, pid) {
  event.preventDefault();
  document.getElementById(`pb-${si}-${pid}`)?.classList.add("drop-target");
}

function onLeave(si, pid) {
  document.getElementById(`pb-${si}-${pid}`)?.classList.remove("drop-target");
}

function onDrop(event, toSprint, toPerson) {
  event.preventDefault();
  document.getElementById(`pb-${toSprint}-${toPerson}`)?.classList.remove("drop-target");
  if (!dragKey) return;
  if (dragFromSprint === toSprint && dragFrom === toPerson) {
    dragKey = null;
    return;
  }
  const fromList = sprints[dragFromSprint].tasks[dragFrom];
  const index = fromList.findIndex((task) => task.key === dragKey);
  if (index === -1) {
    dragKey = null;
    return;
  }
  const [task] = fromList.splice(index, 1);
  sprints[toSprint].tasks[toPerson].push(task);
  dragKey = null;
  renderAll();
}

function onTabOver(event, si) {
  if (!dragKey || dragFromSprint === si) return;
  event.preventDefault();
  document.getElementById(`tab-s${si}`)?.classList.add("drag-over");
}

function onTabLeave(si) {
  document.getElementById(`tab-s${si}`)?.classList.remove("drag-over");
}

function onTabDrop(event, toSprint) {
  event.preventDefault();
  document.getElementById(`tab-s${toSprint}`)?.classList.remove("drag-over");
  if (!dragKey || dragFromSprint === toSprint) return;
  const fromList = sprints[dragFromSprint].tasks[dragFrom];
  const index = fromList.findIndex((task) => task.key === dragKey);
  if (index === -1) return;
  const [task] = fromList.splice(index, 1);
  sprints[toSprint].tasks[dragFrom].push(task);
  const key = dragKey;
  dragKey = null;
  renderAll();
  switchTab(toSprint);
  showNotice(`✓ ${key} перенесено в ${sprints[toSprint].name}`, "ok");
}

function chVac(si, pid, delta) {
  if (!vacDays[si]) vacDays[si] = {};
  vacDays[si][pid] = Math.max(0, Math.min(sprintDays[si], (vacDays[si][pid] || 0) + delta));
  document.getElementById(`vv-${si}-${pid}`).textContent = vacDays[si][pid];
  document.getElementById(`vc-${si}-${pid}`).textContent = `${getCap(si, pid)}г`;
  renderAll();
}

function chDays(si, delta) {
  sprintDays[si] = Math.max(1, Math.min(20, sprintDays[si] + delta));
  renderAll();
}

function toggleSprintPicker() {
  const picker = document.getElementById("sprint-picker");
  const isOpen = picker.style.display !== "none";
  if (!isOpen) {
    const openNames = new Set(sprints.map((sprint) => sprint.name));
    const stateLabel = { active: "🟢 Активний", future: "🔵 Майбутній" };
    picker.innerHTML = allAvailableSprints.length ? allAvailableSprints.map((sprint) => `
      <div onclick="addSprintTab(decodeURIComponent('${encodeURIComponent(sprint.name)}'));toggleSprintPicker()" style="padding:7px 14px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:8px;${openNames.has(sprint.name) ? "opacity:.4;pointer-events:none;" : ""}" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
        <span>${esc(stateLabel[sprint.state] || sprint.state)}</span>
        <span style="flex:1;">${esc(sprint.name)}</span>
        ${openNames.has(sprint.name) ? '<span style="font-size:10px;color:var(--text3);">відкрито</span>' : ""}
      </div>`).join("") : '<div style="padding:12px;font-size:12px;color:var(--text3);">Завантаження...</div>';
  }
  picker.style.display = isOpen ? "none" : "block";
}

document.addEventListener("DOMContentLoaded", () => {
  cfg.team.forEach((member) => addTeamRow(member.name, member.initials, member.role));
  const saved = localStorage.getItem("capacity-cfg");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      cfg = { ...cfg, ...parsed };
      document.getElementById("jira-url").value = cfg.url || "";
      document.getElementById("jira-email").value = cfg.email || "";
      document.getElementById("jira-project").value = cfg.project || "U24";
      document.getElementById("proxy-url").value = cfg.proxyUrl || "";
      document.getElementById("team-list").innerHTML = "";
      cfg.team.forEach((member) => addTeamRow(member.name, member.initials, member.role));
    } catch {}
  }
  [document.getElementById("modal-bg"), document.getElementById("settings-bg")].forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target === element) element.classList.remove("open");
    });
  });
  applyLang();
});
