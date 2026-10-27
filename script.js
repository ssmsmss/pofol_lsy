// ===== Supabase 연결 정보 (공개 키만 사용) =====
const SUPABASE_URL = "https://auszpufzsakvhetoguyn.supabase.co";
const SUPABASE_KEY = "sb_publishable_FpWLt3ux2ksSRL_3h2PkFQ_cprDRVOZ";

// 좋아요를 누른 브라우저를 구분하는 번호와, 이미 누른 카드 목록을 저장하는 이름
const CLIENT_ID_KEY = "resume_client_id";
const LIKED_KEY = "resume_liked_projects";

const HEART_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.3C1 8.2 3.2 4.5 6.9 4.5c2.1 0 3.6 1.1 5.1 2.9 1.5-1.8 3-2.9 5.1-2.9 3.7 0 5.9 3.7 4.4 7.2C19.5 16.4 12 21 12 21z"/></svg>';

// ===== Supabase에 요청 보내기 =====
async function supabase(path, options = {}) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const error = new Error("Supabase 요청 실패: " + response.status);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// ===== 작은 도우미 =====
function $(id) {
  return document.getElementById(id);
}

// http, https 주소만 쓴다 (이상한 주소가 들어와도 실행되지 않도록)
function safeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url, location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

// 줄바꿈으로 나눈 줄 목록 (빈 줄은 뺀다)
function splitLines(text) {
  return (text || "").split("\n").map((s) => s.trim()).filter(Boolean);
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장이 막힌 브라우저에서는 그냥 넘어간다
  }
}

function getClientId() {
  let id = readStorage(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    writeStorage(CLIENT_ID_KEY, id);
  }
  return id;
}

function getLikedIds() {
  try {
    return new Set(JSON.parse(readStorage(LIKED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveLikedId(projectId) {
  const liked = getLikedIds();
  liked.add(projectId);
  writeStorage(LIKED_KEY, JSON.stringify([...liked]));
}

function formatDate(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===== 프로필 =====
function renderProfile(p) {
  if (!p) return;

  document.title = p.name ? `${p.name} | 포트폴리오` : "포트폴리오";

  const photoUrl = safeUrl(p.photo_url);
  if (photoUrl) {
    const img = document.createElement("img");
    img.src = photoUrl;
    img.alt = (p.name || "") + " 프로필 사진";
    $("photo").replaceChildren(img);
  }

  $("name").textContent = p.name;
  $("title").textContent = p.title;
  $("badge").textContent = p.career_badge;

  $("contactName").textContent = p.name;
  $("contactEmail").textContent = p.email;
  if (p.email) $("contactEmail").href = "mailto:" + p.email;
  $("contactPhone").textContent = p.phone;
  $("contactLocation").textContent = p.location;

  renderHeadline(p.headline, p.name);
  $("intro").textContent = p.intro;

  $("education").replaceChildren(...splitLines(p.education).map(makeLine));
  $("experience").replaceChildren(...splitLines(p.experience).map(makeLine));

  // 쉼표나 줄바꿈으로 나눈 기술 목록
  const skills = (p.skills || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  $("skills").replaceChildren(
    ...skills.map((s) => {
      const li = document.createElement("li");
      li.textContent = s;
      return li;
    })
  );

  $("quote").textContent = p.quote ? `“${p.quote}”` : "";
}

function makeLine(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div;
}

// 한 줄 소개: 마지막 쉼표 뒤부터 이름까지를 파란 밑줄로 꾸민다
// 예) "…더하는, [리드 기획자 & PM 김지영]입니다."
function renderHeadline(headline, name) {
  const box = $("headline");
  headline = headline || "";
  const nameAt = name ? headline.lastIndexOf(name) : -1;
  if (nameAt < 0) {
    box.textContent = headline;
    return;
  }
  const comma = headline.lastIndexOf(",", nameAt);
  let start = comma >= 0 ? comma + 1 : nameAt;
  while (headline[start] === " ") start++;
  const end = nameAt + name.length;

  const mark = document.createElement("span");
  mark.className = "mark";
  mark.textContent = headline.slice(start, end);
  box.replaceChildren(headline.slice(0, start), mark, headline.slice(end));
}

// ===== 포트폴리오 카드 =====
function renderProjects(projects, likeCounts) {
  const box = $("cards");
  if (!projects.length) {
    const p = document.createElement("p");
    p.className = "empty-text";
    p.textContent = "아직 등록된 프로젝트가 없습니다.";
    box.replaceChildren(p);
    return;
  }
  const liked = getLikedIds();
  box.replaceChildren(...projects.map((project) => makeCard(project, likeCounts[project.id] || 0, liked.has(project.id))));
}

function makeCard(project, likeCount, alreadyLiked) {
  const card = document.createElement("article");
  card.className = "card";

  // 누르면 열 주소: 첨부 파일이 있으면 그 파일, 없으면 썸네일 이미지
  const openUrl = safeUrl(project.file_url) || safeUrl(project.thumbnail_url);
  const thumbUrl = safeUrl(project.thumbnail_url);

  const open = document.createElement("button");
  open.type = "button";
  open.className = "card-open";
  if (openUrl) {
    card.classList.add("clickable");
    open.addEventListener("click", () => window.open(openUrl, "_blank", "noopener"));
  } else {
    open.disabled = true;
  }

  // 브라우저 창 모양 썸네일
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  thumb.innerHTML = '<div class="thumb-bar"><span></span><span></span><span></span></div>';
  const thumbBody = document.createElement("div");
  thumbBody.className = "thumb-body";
  if (thumbUrl) {
    const img = document.createElement("img");
    img.src = thumbUrl;
    img.alt = project.title + " 미리보기";
    img.loading = "lazy";
    thumbBody.append(img);
  }
  thumb.append(thumbBody);

  const category = document.createElement("div");
  category.className = "card-category";
  category.textContent = [project.number, project.category].filter(Boolean).join(". ");

  const title = document.createElement("h5");
  title.className = "card-title";
  title.textContent = project.title;

  const desc = document.createElement("p");
  desc.className = "card-desc";
  desc.textContent = project.description;

  open.append(thumb, category, title, desc);

  // 아래쪽: 태그와 좋아요
  const foot = document.createElement("div");
  foot.className = "card-foot";

  const tags = document.createElement("div");
  tags.className = "tags";
  (project.tags || []).forEach((t) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = t;
    tags.append(tag);
  });

  const like = document.createElement("button");
  like.type = "button";
  like.className = "like";
  like.innerHTML = HEART_SVG;
  const count = document.createElement("span");
  count.textContent = likeCount;
  like.append(count);
  setLiked(like, alreadyLiked);
  like.addEventListener("click", () => sendLike(project.id, like, count));

  foot.append(tags, like);
  card.append(open, foot);
  return card;
}

function setLiked(button, liked) {
  button.classList.toggle("liked", liked);
  button.setAttribute("aria-pressed", liked ? "true" : "false");
  button.title = liked ? "이미 좋아요를 눌렀어요" : "좋아요";
}

async function sendLike(projectId, button, count) {
  if (button.classList.contains("liked") || button.dataset.busy) return;
  button.dataset.busy = "1";
  try {
    await supabase("likes", {
      method: "POST",
      body: { project_id: projectId, client_id: getClientId() },
      prefer: "return=minimal",
    });
    count.textContent = Number(count.textContent) + 1;
    saveLikedId(projectId);
    setLiked(button, true);
  } catch (error) {
    if (error.status === 409) {
      // 이 브라우저는 이미 눌렀던 카드 (숫자는 그대로)
      saveLikedId(projectId);
      setLiked(button, true);
    } else {
      alert("좋아요를 저장하지 못했습니다. 잠시 후 다시 눌러 주세요.");
    }
  } finally {
    delete button.dataset.busy;
  }
}

// 카드별 좋아요 수 세기
function countLikes(likes) {
  const counts = {};
  likes.forEach((row) => {
    counts[row.project_id] = (counts[row.project_id] || 0) + 1;
  });
  return counts;
}

// ===== 방명록 =====
function makeGuestbookItem(entry) {
  const li = document.createElement("li");

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

  li.append(head, msg);
  return li;
}

function renderGuestbook(entries) {
  const list = $("gbList");
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "empty-text";
    li.textContent = "아직 남겨진 글이 없습니다. 첫 글을 남겨 주세요!";
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...entries.map(makeGuestbookItem));
}

async function submitGuestbook() {
  const nickname = $("gbNickname").value.trim();
  const message = $("gbMessage").value.trim();
  const status = $("gbStatus");
  const button = $("gbSubmit");

  if (!nickname || !message) {
    status.textContent = "별명과 한마디를 모두 적어 주세요.";
    return;
  }

  button.disabled = true;
  status.textContent = "";
  try {
    const rows = await supabase("resume_guestbook", {
      method: "POST",
      body: { nickname, message },
      prefer: "return=representation",
    });
    const list = $("gbList");
    list.querySelector(".empty-text")?.remove();
    list.prepend(makeGuestbookItem(rows[0]));
    $("gbMessage").value = "";
  } catch {
    status.textContent = "글을 남기지 못했습니다. 잠시 후 다시 시도해 주세요.";
  } finally {
    button.disabled = false;
  }
}

$("gbSubmit").addEventListener("click", submitGuestbook);
$("gbMessage").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) submitGuestbook();
});

// ===== 처음 열 때 모두 불러오기 =====
async function loadAll() {
  try {
    const [profiles, projects, likes, guestbook] = await Promise.all([
      supabase("profile?select=*&id=eq.1"),
      supabase("projects?select=*&order=sort_order.asc,id.asc"),
      supabase("likes?select=project_id"),
      supabase("resume_guestbook?select=*&order=created_at.desc"),
    ]);
    renderProfile(profiles[0]);
    renderProjects(projects, countLikes(likes));
    renderGuestbook(guestbook);
  } catch {
    $("loadError").hidden = false;
  }
}

loadAll();
