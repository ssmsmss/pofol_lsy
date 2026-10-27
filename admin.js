// ===== Supabase 연결 정보 (공개 키만 사용) =====
const SUPABASE_URL = "https://auszpufzsakvhetoguyn.supabase.co";
const SUPABASE_KEY = "sb_publishable_FpWLt3ux2ksSRL_3h2PkFQ_cprDRVOZ";
const BUCKET = "resume";

// 로그인 정보는 이 탭에만 저장한다 (탭을 닫으면 다시 로그인)
const SESSION_KEY = "resume_admin_session";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const FILE_TYPES = { ...IMAGE_TYPES, "application/pdf": "pdf" };

const PROFILE_FIELDS = [
  "name", "title", "career_badge", "email", "phone", "location",
  "headline", "intro", "education", "skills", "experience", "quote",
];

let session = null;    // { access_token, refresh_token, expires_at, user }
let profile = null;    // 지금 저장된 프로필
let projects = [];     // 순서대로 정렬된 카드 목록
let likeCounts = {};   // { 카드 id: 좋아요 수 }
let editingId = null;  // 고치는 중인 카드 id (새 카드면 null)

function $(id) {
  return document.getElementById(id);
}

// ===== 로그인 정보 저장 =====
function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function saveSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in,
    user: { id: data.user.id, email: data.user.email },
  };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // 저장이 막힌 브라우저에서는 이 화면에서만 로그인이 유지된다
  }
}

function clearSession() {
  session = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 무시
  }
}

// ===== Supabase Auth (로그인 · 토큰 새로 받기 · 로그아웃) =====
async function authRequest(path, body, token) {
  const headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(SUPABASE_URL + "/auth/v1/" + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error((data && (data.error_description || data.msg || data.message)) || "로그인 요청 실패");
    error.status = response.status;
    throw error;
  }
  return data;
}

// 토큰이 1분 안에 끝나면 미리 새로 받는다
async function getToken() {
  if (!session) throw new LoginNeeded();
  if (session.expires_at - 60 < Date.now() / 1000) {
    try {
      const data = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      saveSession(data);
    } catch {
      throw new LoginNeeded();
    }
  }
  return session.access_token;
}

class LoginNeeded extends Error {
  constructor() {
    super("다시 로그인해 주세요.");
  }
}

// ===== 표(데이터베이스) 요청 =====
async function db(path, options = {}) {
  const token = await getToken();
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
  if (options.prefer) headers.Prefer = options.prefer;

  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 401) throw new LoginNeeded();
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error("저장하지 못했어요. (" + response.status + " " + ((data && data.message) || "") + ")");
  }
  return data;
}

// 고치기·지우기를 하고 실제로 바뀐 줄이 있는지 확인한다
// (규칙에 막히면 오류 없이 0줄이 돌아오기 때문)
async function dbChange(path, method, body) {
  const rows = await db(path, { method, body, prefer: "return=representation" });
  if (!rows || rows.length === 0) {
    throw new Error("바뀐 내용이 없어요. 관리자 권한이 있는지 확인해 주세요.");
  }
  return rows;
}

// ===== 보관함(파일) 올리기 =====
// 문제가 있으면 안내 문구, 괜찮으면 빈 글자를 돌려준다
function checkFile(file, allowed) {
  if (!file) return "";
  if (!allowed[file.type]) {
    return allowed === IMAGE_TYPES
      ? `"${file.name}"은(는) 이미지가 아니에요. PNG·JPG·WEBP·GIF만 올릴 수 있어요.`
      : `"${file.name}"은(는) 올릴 수 없는 종류예요. 이미지나 PDF만 올릴 수 있어요.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `"${file.name}"이(가) 10MB보다 커요. (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
  }
  return "";
}

// 파일 이름은 영어·숫자로 새로 짓는다. 예) projects/20261027-143005-k3j9x2ab.pdf
function newFileName(folder, file) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `${folder}/${stamp}-${random}.${FILE_TYPES[file.type]}`;
}

// 올리고 공개 주소를 돌려준다
async function uploadFile(folder, file) {
  const token = await getToken();
  const path = newFileName(folder, file);
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + token,
      "Content-Type": file.type,
    },
    body: file,
  });
  if (response.status === 401) throw new LoginNeeded();
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json()).message || "";
    } catch {
      // 무시
    }
    throw new Error(`"${file.name}"을(를) 올리지 못했어요. (${response.status} ${detail})`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// ===== 안내 문구 =====
function showMsg(id, text, ok) {
  const el = $(id);
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "bad");
}

// 오류를 보여 준다. 로그인이 끝났으면 로그인 화면으로
function handleError(msgId, error) {
  if (error instanceof LoginNeeded) {
    clearSession();
    showView("login");
    showMsg("loginMsg", "로그인이 끝났어요. 다시 로그인해 주세요.");
    return;
  }
  showMsg(msgId, error.message);
}

function safeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function formatDate(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeButton(text, className, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn small " + className;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function emptyItem(text) {
  const li = document.createElement("li");
  li.className = "empty-text";
  li.textContent = text;
  return li;
}

function splitComma(text) {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

// ===== 화면 바꾸기 =====
function showView(name) {
  $("loginView").hidden = name !== "login";
  $("notAdminView").hidden = name !== "notAdmin";
  $("adminView").hidden = name !== "admin";
}

// ===== 로그인 · 로그아웃 =====
async function login() {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!email || !password) {
    showMsg("loginMsg", "이메일과 비밀번호를 모두 적어 주세요.");
    return;
  }
  $("loginButton").disabled = true;
  showMsg("loginMsg", "");
  try {
    const data = await authRequest("token?grant_type=password", { email, password });
    saveSession(data);
    $("loginPassword").value = "";
    await start();
  } catch (error) {
    showMsg("loginMsg", error.status === 400 ? "이메일 또는 비밀번호가 맞지 않아요." : "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    $("loginButton").disabled = false;
  }
}

async function logout() {
  if (session) {
    try {
      await authRequest("logout", {}, session.access_token);
    } catch {
      // 이미 끝난 로그인이어도 이 브라우저에서는 지운다
    }
  }
  clearSession();
  showView("login");
}

// 로그인한 사람이 관리자인지 확인하고 화면을 연다
async function start() {
  try {
    const rows = await db("admins?select=user_id&user_id=eq." + session.user.id);
    if (!rows.length) {
      showView("notAdmin");
      return;
    }
    $("whoEmail").textContent = session.user.email;
    showView("admin");
    await Promise.all([loadProfile(), loadProjects(), loadGuestbook()]);
  } catch (error) {
    if (error instanceof LoginNeeded) {
      clearSession();
      showView("login");
    } else {
      showView("login");
      showMsg("loginMsg", error.message);
    }
  }
}

// ===== 프로필 =====
async function loadProfile() {
  try {
    const rows = await db("profile?select=*&id=eq.1");
    profile = rows[0] || null;
    PROFILE_FIELDS.forEach((f) => {
      $("pf_" + f).value = (profile && profile[f]) || "";
    });
    showProfilePhoto(profile && profile.photo_url);
  } catch (error) {
    handleError("profileMsg", error);
  }
}

function showProfilePhoto(url) {
  const box = $("profilePhoto");
  const safe = safeUrl(url);
  if (safe) {
    const img = document.createElement("img");
    img.src = safe;
    img.alt = "프로필 사진";
    box.replaceChildren(img);
  } else {
    box.innerHTML =
      '<svg class="photo-empty" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" /></svg>';
  }
}

async function saveProfile() {
  const file = $("profilePhotoFile").files[0];
  const problem = checkFile(file, IMAGE_TYPES);
  if (problem) {
    showMsg("profileMsg", problem);
    return;
  }

  $("profileSave").disabled = true;
  showMsg("profileMsg", "저장하는 중…", true);
  try {
    const row = { id: 1, updated_at: new Date().toISOString() };
    PROFILE_FIELDS.forEach((f) => {
      row[f] = $("pf_" + f).value.trim();
    });
    row.photo_url = profile ? profile.photo_url : null;
    if (file) row.photo_url = await uploadFile("profile", file);

    // 줄이 있으면 고치고, 없으면 새로 만든다
    const rows = await db("profile?on_conflict=id", {
      method: "POST",
      body: row,
      prefer: "resolution=merge-duplicates,return=representation",
    });
    profile = rows[0];
    showProfilePhoto(profile.photo_url);
    $("profilePhotoFile").value = "";
    showMsg("profileMsg", "저장했어요. 홈페이지를 새로고침하면 보여요.", true);
  } catch (error) {
    handleError("profileMsg", error);
  } finally {
    $("profileSave").disabled = false;
  }
}

// ===== 포트폴리오 카드 =====
async function loadProjects() {
  try {
    const [rows, likes] = await Promise.all([
      db("projects?select=*&order=sort_order.asc,id.asc"),
      db("likes?select=project_id"),
    ]);
    projects = rows;
    likeCounts = {};
    likes.forEach((l) => {
      likeCounts[l.project_id] = (likeCounts[l.project_id] || 0) + 1;
    });
    renderProjects();
    renderLikes();
  } catch (error) {
    handleError("projectListMsg", error);
  }
}

function renderProjects() {
  const list = $("projectList");
  if (!projects.length) {
    list.replaceChildren(emptyItem("아직 카드가 없어요. 아래 '+ 카드 추가'를 눌러 보세요."));
    return;
  }
  list.replaceChildren(
    ...projects.map((p, i) => {
      const li = document.createElement("li");

      const thumb = document.createElement("div");
      thumb.className = "mini-thumb";
      const thumbUrl = safeUrl(p.thumbnail_url);
      if (thumbUrl) {
        const img = document.createElement("img");
        img.src = thumbUrl;
        img.alt = "";
        thumb.append(img);
      }

      const text = document.createElement("div");
      text.className = "grow";
      const title = document.createElement("div");
      title.className = "gb-nick";
      title.textContent = [p.number, p.title].filter(Boolean).join(". ");
      const sub = document.createElement("div");
      sub.className = "item-sub";
      sub.textContent = [p.category, p.file_url ? "첨부 파일 있음" : "첨부 파일 없음"].filter(Boolean).join(" · ");
      text.append(title, sub);

      const likes = document.createElement("span");
      likes.className = "like-count";
      likes.textContent = "♥ " + (likeCounts[p.id] || 0);

      const actions = document.createElement("div");
      actions.className = "actions";
      const up = makeButton("▲", "light", () => moveProject(i, -1));
      up.disabled = i === 0;
      up.title = "위로";
      const down = makeButton("▼", "light", () => moveProject(i, 1));
      down.disabled = i === projects.length - 1;
      down.title = "아래로";
      actions.append(
        up,
        down,
        makeButton("수정", "light", () => openEditor(p)),
        makeButton("삭제", "danger", () => deleteProject(p))
      );

      li.append(thumb, text, likes, actions);
      return li;
    })
  );
}

// 순서 바꾸기: 옆 카드와 자리를 바꾸고 1, 2, 3… 으로 다시 번호를 매긴다
async function moveProject(index, step) {
  const target = index + step;
  if (target < 0 || target >= projects.length) return;
  const order = projects.slice();
  [order[index], order[target]] = [order[target], order[index]];

  showMsg("projectListMsg", "순서를 바꾸는 중…", true);
  try {
    await Promise.all(
      order
        .map((p, i) => ({ p, sort: i + 1 }))
        .filter(({ p, sort }) => p.sort_order !== sort)
        .map(({ p, sort }) => dbChange("projects?id=eq." + p.id, "PATCH", { sort_order: sort }))
    );
    showMsg("projectListMsg", "순서를 바꿨어요.", true);
  } catch (error) {
    handleError("projectListMsg", error);
  }
  await loadProjects();
}

async function deleteProject(p) {
  if (!confirm(`"${p.title}" 카드를 지울까요?\n좋아요 기록도 함께 지워지고, 되돌릴 수 없어요.`)) return;
  try {
    await dbChange("projects?id=eq." + p.id, "DELETE");
    if (editingId === p.id) closeEditor();
    showMsg("projectListMsg", "카드를 지웠어요.", true);
  } catch (error) {
    handleError("projectListMsg", error);
  }
  await loadProjects();
}

function showCurrentFile(boxId, url, label) {
  const box = $(boxId);
  const safe = safeUrl(url);
  if (!safe) {
    box.textContent = "지금: 없음";
    return;
  }
  const a = document.createElement("a");
  a.href = safe;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = label + " 열어 보기";
  box.replaceChildren("지금: ", a, " (새 파일을 고르면 바뀌어요)");
}

function openEditor(p) {
  editingId = p ? p.id : null;
  $("editorTitle").textContent = p ? "카드 수정" : "카드 추가";
  $("pj_number").value = p ? p.number : "";
  $("pj_category").value = p ? p.category : "";
  $("pj_title").value = p ? p.title : "";
  $("pj_description").value = p ? p.description : "";
  $("pj_tags").value = p ? (p.tags || []).join(", ") : "";
  $("pj_sort_order").value = p
    ? p.sort_order
    : projects.reduce((max, x) => Math.max(max, x.sort_order), 0) + 1;
  $("pj_thumb").value = "";
  $("pj_file").value = "";
  showCurrentFile("pj_thumb_now", p && p.thumbnail_url, "썸네일");
  showCurrentFile("pj_file_now", p && p.file_url, "첨부 파일");
  showMsg("projectMsg", "");
  $("projectEditor").hidden = false;
  $("projectEditor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  editingId = null;
  $("projectEditor").hidden = true;
}

async function saveProject() {
  const title = $("pj_title").value.trim();
  if (!title) {
    showMsg("projectMsg", "제목을 적어 주세요.");
    return;
  }
  const thumbFile = $("pj_thumb").files[0];
  const attachFile = $("pj_file").files[0];
  const problem = checkFile(thumbFile, IMAGE_TYPES) || checkFile(attachFile, FILE_TYPES);
  if (problem) {
    showMsg("projectMsg", problem);
    return;
  }

  $("projectSave").disabled = true;
  showMsg("projectMsg", "저장하는 중…", true);
  try {
    const old = projects.find((x) => x.id === editingId);
    const row = {
      number: $("pj_number").value.trim(),
      category: $("pj_category").value.trim(),
      title,
      description: $("pj_description").value.trim(),
      tags: splitComma($("pj_tags").value),
      sort_order: parseInt($("pj_sort_order").value, 10) || 0,
      thumbnail_url: old ? old.thumbnail_url : null,
      file_url: old ? old.file_url : null,
    };
    if (thumbFile) row.thumbnail_url = await uploadFile("projects", thumbFile);
    if (attachFile) row.file_url = await uploadFile("projects", attachFile);

    if (editingId) {
      await dbChange("projects?id=eq." + editingId, "PATCH", row);
    } else {
      await dbChange("projects", "POST", row);
    }
    closeEditor();
    showMsg("projectListMsg", "카드를 저장했어요. 홈페이지를 새로고침하면 보여요.", true);
    await loadProjects();
  } catch (error) {
    handleError("projectMsg", error);
  } finally {
    $("projectSave").disabled = false;
  }
}

// ===== 좋아요 =====
function renderLikes() {
  const list = $("likeList");
  if (!projects.length) {
    list.replaceChildren(emptyItem("카드가 없어요."));
    return;
  }
  list.replaceChildren(
    ...projects.map((p) => {
      const li = document.createElement("li");
      const name = document.createElement("div");
      name.className = "grow gb-nick";
      name.textContent = [p.number, p.title].filter(Boolean).join(". ");
      const count = document.createElement("span");
      count.className = "like-count";
      count.textContent = "♥ " + (likeCounts[p.id] || 0);
      const actions = document.createElement("div");
      actions.className = "actions";
      const reset = makeButton("좋아요 초기화", "danger", () => resetLikes(p));
      reset.disabled = !likeCounts[p.id];
      actions.append(reset);
      li.append(name, count, actions);
      return li;
    })
  );
}

async function resetLikes(p) {
  if (!confirm(`"${p.title}" 카드의 좋아요 ${likeCounts[p.id] || 0}개를 모두 지울까요?\n되돌릴 수 없어요.`)) return;
  try {
    await dbChange("likes?project_id=eq." + p.id, "DELETE");
    showMsg("likeMsg", "좋아요를 초기화했어요.", true);
  } catch (error) {
    handleError("likeMsg", error);
  }
  await loadProjects();
}

// ===== 방명록 =====
async function loadGuestbook() {
  try {
    const rows = await db("resume_guestbook?select=*&order=created_at.desc");
    const list = $("guestbookList");
    if (!rows.length) {
      list.replaceChildren(emptyItem("아직 남겨진 글이 없어요."));
      return;
    }
    list.replaceChildren(
      ...rows.map((entry) => {
        const li = document.createElement("li");
        const text = document.createElement("div");
        text.className = "grow";
        const head = document.createElement("div");
        head.className = "gb-head";
        const nick = document.createElement("span");
        nick.className = "gb-nick";
        nick.textContent = entry.nickname;
        const date = document.createElement("span");
        date.className = "gb-date";
        date.textContent = formatDate(entry.created_at);
        head.append(nick, date);
        const msg = document.createElement("p");
        msg.className = "gb-msg";
        msg.textContent = entry.message;
        text.append(head, msg);

        const actions = document.createElement("div");
        actions.className = "actions";
        actions.append(makeButton("삭제", "danger", () => deleteGuestbook(entry)));
        li.append(text, actions);
        return li;
      })
    );
  } catch (error) {
    handleError("guestbookMsg", error);
  }
}

async function deleteGuestbook(entry) {
  if (!confirm(`${entry.nickname}님의 글을 지울까요?\n"${entry.message}"\n되돌릴 수 없어요.`)) return;
  try {
    await dbChange("resume_guestbook?id=eq." + entry.id, "DELETE");
    showMsg("guestbookMsg", "글을 지웠어요.", true);
  } catch (error) {
    handleError("guestbookMsg", error);
  }
  await loadGuestbook();
}

// ===== 버튼 연결 =====
$("loginButton").addEventListener("click", login);
$("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) login();
});
document.querySelectorAll("[data-logout]").forEach((b) => b.addEventListener("click", logout));
$("profileSave").addEventListener("click", saveProfile);
$("projectNew").addEventListener("click", () => openEditor(null));
$("projectSave").addEventListener("click", saveProject);
$("projectCancel").addEventListener("click", closeEditor);

// 고르자마자 파일을 검사해서 안내한다
$("profilePhotoFile").addEventListener("change", (e) => {
  showMsg("profileMsg", checkFile(e.target.files[0], IMAGE_TYPES));
});
$("pj_thumb").addEventListener("change", (e) => {
  showMsg("projectMsg", checkFile(e.target.files[0], IMAGE_TYPES));
});
$("pj_file").addEventListener("change", (e) => {
  showMsg("projectMsg", checkFile(e.target.files[0], FILE_TYPES));
});

// ===== 처음 열 때 =====
session = loadSession();
if (session) {
  start();
} else {
  showView("login");
}
