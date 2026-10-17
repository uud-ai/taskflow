// ========== FIREBASE ==========
const COLORS = ['#7c6aff','#f472b6','#fb923c','#34d399','#60a5fa','#a78bfa','#f87171','#fbbf24'];
const NOTE_COLORS = ['#7c6aff','#f472b6','#fb923c','#34d399','#60a5fa','#a78bfa'];

let db = null;
let fbAvailable = false;
let authInstance = null;
let authFns = null;
let authMode = 'login';
let curView = 'tasks';
let curTask = null;
let curNote = null;
let noteColor = NOTE_COLORS[0];
let selColor = COLORS[0];
let selPrio = '';
let selRecur = '';
let calDate = new Date();
let calDay = null;

// State
let S = { projects: [], tasks: [], subtasks: [], notes: [], activeProject: 'all' };

// UID — set after email/password sign-in resolves (see initFirebase / onAuthStateChanged).
// Using a real account (not anonymous auth) is what lets the same data show up
// on every device: anonymous auth issues a fresh, device-local uid each time.
let UID = null;

// ========== LOCAL STORAGE ==========
function saveLocal() {
  localStorage.setItem('tf_data', JSON.stringify(S));
}
function loadLocal() {
  try {
    const r = JSON.parse(localStorage.getItem('tf_data') || 'null');
    if (r) { S.projects = r.projects||[]; S.tasks = r.tasks||[]; S.subtasks = r.subtasks||[]; S.notes = r.notes||[]; }
  } catch(e) {}
}

// ========== FIREBASE SETUP ==========
function loadFirebaseConfig() {
  return {
    apiKey: "AIzaSyBcKf3QqHG-ljIYoyJPhA2OMSoUgGMIIRc",
    authDomain: "taskflow-de4e3.firebaseapp.com",
    projectId: "taskflow-de4e3",
    storageBucket: "taskflow-de4e3.firebasestorage.app",
    messagingSenderId: "575774598508",
    appId: "1:575774598508:web:4eb7a09d7fd5a60c0dbf49"
  };
}

async function initFirebase() {
  const cfg = loadFirebaseConfig();

  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    const { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, query, where } =
      await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } =
      await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');

    const app = initializeApp(cfg);
    db = getFirestore(app);
    authInstance = getAuth(app);
    authFns = { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut };

    // Attach methods to db for use elsewhere
    db._col = (name) => collection(db, name);
    db._setDoc = setDoc;
    db._doc = doc;
    db._getDocs = getDocs;
    db._deleteDoc = deleteDoc;
    db._query = query;
    db._where = where;

    onAuthStateChanged(authInstance, async (user) => {
      document.getElementById('signOutBtn').style.display = user ? 'flex' : 'none';
      if (user) {
        UID = user.uid;
        fbAvailable = true;
        // The local cache (localStorage) isn't scoped per account. If it
        // belongs to a different uid (a previous account, or unsynced
        // guest/"продолжить без входа" data), drop it instead of merging —
        // otherwise a stranger account's cache leaks into whoever logs in
        // next on this device/browser.
        if (localStorage.getItem('tf_data_uid') !== UID) {
          S.projects = []; S.tasks = []; S.subtasks = []; S.notes = [];
        }
        closeModal('authModal');
        ss('syncing');
        try {
          await flushPending();
          await syncFromFirebase();
          localStorage.setItem('tf_data_uid', UID);
          ss('synced'); toast('Синхронизировано!');
        }
        catch(e) { ss('pending'); toast('Ошибка: ' + e.message); }
      } else {
        UID = null;
        fbAvailable = false;
        ss('pending');
        openModal('authModal');
      }
    });
  } catch(e) {
    console.error('Firebase init error:', e);
    ss('pending');
    toast('Ошибка Firebase: ' + e.message);
  }
}

// ========== AUTH (email + пароль — общий аккаунт на всех устройствах) ==========
function authErrorMessage(e) {
  const map = {
    'auth/invalid-email': 'Некорректный email',
    'auth/user-not-found': 'Пользователь не найден',
    'auth/wrong-password': 'Неверный пароль',
    'auth/invalid-credential': 'Неверный email или пароль',
    'auth/email-already-in-use': 'Этот email уже зарегистрирован',
    'auth/weak-password': 'Пароль слишком короткий (мин. 6 символов)',
    'auth/too-many-requests': 'Слишком много попыток, попробуй позже',
    'auth/network-request-failed': 'Проблема с сетью, попробуй ещё раз',
  };
  return map[e.code] || ('Ошибка: ' + (e.message || e.code || 'неизвестная'));
}

window.toggleAuthMode = function() {
  authMode = authMode === 'login' ? 'register' : 'login';
  document.getElementById('authTitle').textContent = authMode==='login' ? 'Вход' : 'Регистрация';
  document.getElementById('authSubmitBtn').textContent = authMode==='login' ? 'Войти' : 'Создать аккаунт';
  document.getElementById('authToggleText').textContent = authMode==='login' ? 'Нет аккаунта?' : 'Уже есть аккаунт?';
  document.getElementById('authToggleLink').textContent = authMode==='login' ? 'Зарегистрироваться' : 'Войти';
  document.getElementById('authError').style.display = 'none';
};

window.authSubmit = async function() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  if (!email || !password) { errEl.textContent = 'Заполни email и пароль'; errEl.style.display = 'block'; return; }
  const btn = document.getElementById('authSubmitBtn'); btn.disabled = true;
  try {
    if (authMode === 'login') await authFns.signInWithEmailAndPassword(authInstance, email, password);
    else await authFns.createUserWithEmailAndPassword(authInstance, email, password);
  } catch(e) {
    errEl.textContent = authErrorMessage(e);
    errEl.style.display = 'block';
  }
  btn.disabled = false;
};

window.authSignOut = async function() {
  if (!authInstance) return;
  await authFns.signOut(authInstance);
  toast('Вышли из аккаунта');
};

// ========== FIREBASE CRUD ==========
// Writes that fail (offline, flaky network) get queued to localStorage and
// retried on reconnect/next sync — otherwise the edit only exists locally
// and is silently lost the moment localStorage is cleared or another device
// does a sync that doesn't know about it yet.
function loadPending() {
  try { return JSON.parse(localStorage.getItem('tf_pending') || '[]'); } catch(e) { return []; }
}
function savePending(p) { localStorage.setItem('tf_pending', JSON.stringify(p)); }
function queuePending(op, colName, id, data) {
  const pending = loadPending();
  pending.push({ op, colName, id, data, ts: Date.now() });
  savePending(pending);
  ss('pending');
}

async function fbSet(colName, id, data) {
  if (!fbAvailable) { queuePending('set', colName, id, data); return; }
  try {
    await db._setDoc(db._doc(db._col(colName), id), { ...data, uid: UID });
  } catch(e) { console.error('fbSet error:', e); queuePending('set', colName, id, data); }
}
async function fbDel(colName, id) {
  if (!fbAvailable) { queuePending('del', colName, id, null); return; }
  try { await db._deleteDoc(db._doc(db._col(colName), id)); }
  catch(e) { console.error('fbDel error:', e); queuePending('del', colName, id, null); }
}
async function fbGetAll(colName) {
  if (!fbAvailable) return [];
  try {
    const q = db._query(db._col(colName), db._where('uid','==',UID));
    const snap = await db._getDocs(q);
    return snap.docs.map(d => d.data());
  } catch(e) { console.error('fbGetAll:', e); return []; }
}

async function flushPending() {
  if (!fbAvailable) return;
  const pending = loadPending();
  if (!pending.length) return;
  const remaining = [];
  for (const op of pending) {
    try {
      if (op.op === 'set') await db._setDoc(db._doc(db._col(op.colName), op.id), { ...op.data, uid: UID });
      else await db._deleteDoc(db._doc(db._col(op.colName), op.id));
    } catch(e) { remaining.push(op); }
  }
  savePending(remaining);
  if (!remaining.length && fbAvailable) ss('synced');
}
window.addEventListener('online', flushPending);

// Last-write-wins merge by id: keeps whichever side (local/remote) was
// updated more recently, and unions ids so unsynced local edits/creations
// survive a sync instead of being clobbered by a full overwrite.
function mergeById(local, remote) {
  const map = new Map();
  local.forEach(item => map.set(item.id, item));
  remote.forEach(item => {
    const existing = map.get(item.id);
    const remoteTs = item.updatedAt || item.createdAt || 0;
    const localTs = existing ? (existing.updatedAt || existing.createdAt || 0) : -1;
    if (!existing || remoteTs >= localTs) map.set(item.id, item);
  });
  return Array.from(map.values());
}

async function syncFromFirebase() {
  const [projects, tasks, subtasks, notes] = await Promise.all([
    fbGetAll('projects'), fbGetAll('tasks'), fbGetAll('subtasks'), fbGetAll('notes')
  ]);

  const remoteProjects = projects.map(p => ({ id:p.id, name:p.name, color:p.color, updatedAt:p.updatedAt||0 }));
  const remoteTasks = tasks.map(t => ({ id:t.id, title:t.title, done:t.done||false, projectId:t.projectId||'', deadline:t.deadline||null, taskTime:t.taskTime||null, notes:t.notes||'', priority:t.priority||'', recur:t.recur||'', parentId:t.parentId||null, createdAt:t.createdAt||Date.now(), updatedAt:t.updatedAt||t.createdAt||0 }));
  const remoteSubtasks = subtasks.map(s => ({ id:s.id, taskId:s.taskId, title:s.title, done:s.done||false, updatedAt:s.updatedAt||0 }));
  const remoteNotes = notes.map(n => ({ id:n.id, title:n.title||'', body:n.body||'', color:n.color||NOTE_COLORS[0], createdAt:n.createdAt||Date.now(), updatedAt:n.updatedAt||Date.now() }));

  S.projects = mergeById(S.projects, remoteProjects);
  S.tasks = mergeById(S.tasks, remoteTasks);
  S.subtasks = mergeById(S.subtasks, remoteSubtasks);
  S.notes = mergeById(S.notes, remoteNotes);

  if (!S.projects.length) await createDefaultProjects();
  checkRecurring(); saveLocal(); renderAll();
}

async function createDefaultProjects() {
  const defs = [
    { id:'inbox', name:'Входящие', color:'#7c6aff' },
    { id:'work', name:'Работа', color:'#60a5fa' },
    { id:'personal', name:'Личное', color:'#34d399' }
  ];
  S.projects = defs;
  for (const p of defs) await fbSet('projects', p.id, p);
}

async function syncNow() {
  if (!UID) { openModal('authModal'); return; }
  ss('syncing');
  try { await flushPending(); await syncFromFirebase(); ss('synced'); toast('Синхронизировано!'); }
  catch(e) { ss('pending'); toast('Ошибка: ' + e.message); }
}
window.syncNow = syncNow;

// ========== THEME ==========
window.toggleTheme = function() {
  const isLight = document.body.classList.toggle('light');
  localStorage.setItem('tf_theme', isLight ? 'light' : 'dark');
  document.getElementById('themeBtn').textContent = isLight ? '☀️' : '🌙';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', isLight ? '#f4f4f8' : '#7c6aff');
}
window.loadTheme = function() {
  const t = localStorage.getItem('tf_theme');
  if (t === 'light') { document.body.classList.add('light'); document.getElementById('themeBtn').textContent = '☀️'; document.querySelector('meta[name="theme-color"]').content = '#f4f4f8'; }
}

// ========== SYNC STATUS ==========
function ss(s) {
  const b = document.getElementById('syncBtn'), l = document.getElementById('syncLabel');
  b.className = 'sync-btn ' + s;
  if (s==='synced') l.textContent = 'Синхронизировано';
  else if (s==='syncing') l.textContent = 'Синхронизация...';
  else l.textContent = UID ? 'Не синхронизировано' : 'Войти для синхронизации';
}

// ========== UTILS ==========
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.togglePopover(true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.hidePopover(), 3000);
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function gp(id) { return S.projects.find(p=>p.id===id) || { name:'Входящие', color:'#7c6aff' }; }
function gsubs(tid) { return S.subtasks.filter(s=>s.taskId===tid); }
function fmtAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'только что';
  if (diff < 3600000) return Math.floor(diff/60000) + 'м назад';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'ч назад';
  return new Date(ts).toLocaleDateString('ru', {day:'numeric',month:'short'});
}
function closeModal(id) { document.getElementById(id).close(); }
function openModal(id) { document.getElementById(id).showModal(); }
window.closeModal = closeModal;
window.openModal = openModal;

// ========== PROJECTS ==========
function renderProjects() {
  const el = document.getElementById('projScroll');
  el.innerHTML = '';
  const mkChip = (pid, label, cnt, active, color) => {
    const d = document.createElement('div');
    d.className = 'proj-chip' + (active ? ' active' : '');
    if (active && color) d.style.background = color;
    d.innerHTML = `<div class="chip-dot" style="background:${color||'#7c6aff'}"></div>${esc(label)}<span class="chip-cnt">${cnt}</span>`;
    d.onclick = () => { S.activeProject = pid; renderAll(); };
    return d;
  };
  el.appendChild(mkChip('all', 'Все', S.tasks.filter(t=>!t.done).length, S.activeProject==='all', '#7c6aff'));
  S.projects.forEach(p => el.appendChild(mkChip(p.id, p.name, S.tasks.filter(t=>t.projectId===p.id&&!t.done).length, S.activeProject===p.id, p.color)));
  const add = document.createElement('div');
  add.className = 'add-proj-chip'; add.textContent = '+';
  add.onclick = () => { renderColors(); openModal('projModal'); setTimeout(() => document.getElementById('projName').focus(), 100); };
  el.appendChild(add);
}

function renderColors() {
  document.getElementById('colorPicker').innerHTML = '';
  COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'csw' + (c===selColor?' selected':'');
    sw.style.background = c;
    sw.onclick = () => { selColor = c; renderColors(); };
    document.getElementById('colorPicker').appendChild(sw);
  });
}

async function saveProject() {
  const name = document.getElementById('projName').value.trim();
  if (!name) return;
  const p = { id: crypto.randomUUID(), name, color: selColor, updatedAt: Date.now() };
  S.projects.push(p); saveLocal(); renderAll();
  closeModal('projModal'); document.getElementById('projName').value = '';
  await fbSet('projects', p.id, p);
}
window.saveProject = saveProject;

// ========== TASKS ==========
async function addTask() {
  const inp = document.getElementById('newTaskInp'), title = inp.value.trim();
  if (!title) return;
  const pid = S.activeProject==='all' ? (S.projects[0]?.id||'inbox') : S.activeProject;
  const t = { id: crypto.randomUUID(), title, done: false, projectId: pid, createdAt: Date.now(), updatedAt: Date.now(), deadline: null, taskTime: null, notes: '', priority: '' };
  S.tasks.unshift(t); inp.value = ''; saveLocal(); renderAll();
  await fbSet('tasks', t.id, t);
}

async function toggleTask(id, e) {
  if (e) e.stopPropagation();
  const t = S.tasks.find(x=>x.id===id); if (!t) return;
  t.done = !t.done; t.updatedAt = Date.now(); saveLocal(); renderAll();
  await fbSet('tasks', t.id, t);
}

async function deleteTask() {
  if (!curTask) return;
  const id = curTask; curTask = null;
  S.tasks = S.tasks.filter(t=>t.id!==id);
  S.subtasks = S.subtasks.filter(s=>s.taskId!==id);
  closeModal('detailModal'); saveLocal(); renderAll();
  await fbDel('tasks', id);
}
window.deleteTask = deleteTask;

function openDetail(id) {
  curTask = id;
  const t = S.tasks.find(x=>x.id===id); if (!t) return;
  const p = gp(t.projectId);
  const dc = document.getElementById('detailCheck');
  dc.className = 'detail-check' + (t.done?' done':'');
  dc.style.borderColor = p.color; dc.style.background = t.done ? p.color : 'transparent';
  dc.style.color = t.done ? '#fff' : 'transparent';
  document.getElementById('detailTitle').value = t.title;
  document.getElementById('detailNote').value = t.notes || '';
  document.getElementById('detailDate').value = t.deadline ? new Date(t.deadline).toISOString().split('T')[0] : '';
  document.getElementById('detailTime').value = t.taskTime || '';
  document.getElementById('detailProj').innerHTML = S.projects.map(p2 =>
    `<option value="${p2.id}"${p2.id===t.projectId?' selected':''}>${esc(p2.name)}</option>`).join('');
  selPrio = t.priority || '';
  document.querySelectorAll('.prio-btn').forEach(b => {
    b.className = 'prio-btn';
    if (b.dataset.p === selPrio) b.classList.add('active-'+selPrio);
  });
  selRecur = t.recur || '';
  document.querySelectorAll('#recurBtns .prio-btn').forEach(b => {
    b.className = 'prio-btn';
    if (b.dataset.r === selRecur) b.classList.add('active-low');
  });
  renderSubs(); openModal('detailModal');
}

async function saveDetail() {
  const t = S.tasks.find(x=>x.id===curTask); if (!t) return;
  t.title = document.getElementById('detailTitle').value.trim() || t.title;
  t.notes = document.getElementById('detailNote').value;
  t.projectId = document.getElementById('detailProj').value;
  t.priority = selPrio;
  t.recur = selRecur;
  const dv = document.getElementById('detailDate').value;
  const tv = document.getElementById('detailTime').value;
  if (dv) { const d = new Date(dv); if(tv){const[h,m]=tv.split(':');d.setHours(+h,+m,0,0);} t.deadline=d.getTime(); } else t.deadline=null;
  t.taskTime = tv || null;
  t.updatedAt = Date.now();
  saveLocal(); renderAll();
  await fbSet('tasks', t.id, t);
}
window.saveDetail = saveDetail;

window.setPrio = function(p) {
  selPrio = selPrio===p ? '' : p;
  document.querySelectorAll('.prio-btn').forEach(b => {
    b.className = 'prio-btn';
    if (b.dataset.p === selPrio) b.classList.add('active-'+selPrio);
  });
};

window.setRecur = function(r) {
  selRecur = r;
  document.querySelectorAll('#recurBtns .prio-btn').forEach(b => {
    b.className = 'prio-btn';
    if (b.dataset.r === r) b.classList.add('active-low');
  });
};

async function toggleDetailCheck() {
  const t = S.tasks.find(x=>x.id===curTask); if (!t) return;
  t.done = !t.done; t.updatedAt = Date.now();
  const p = gp(t.projectId), dc = document.getElementById('detailCheck');
  dc.className = 'detail-check' + (t.done?' done':'');
  dc.style.background = t.done ? p.color : 'transparent';
  dc.style.color = t.done ? '#fff' : 'transparent';
  saveLocal(); renderAll();
  await fbSet('tasks', t.id, t);
}

function renderTasks() {
  const el = document.getElementById('tasksList');
  let tasks = S.tasks.slice();
  if (curView==='done') tasks = tasks.filter(t=>t.done);
  else { tasks = tasks.filter(t=>!t.done); if(S.activeProject!=='all') tasks=tasks.filter(t=>t.projectId===S.activeProject); }
  if (!tasks.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">${curView==='done'?'🎉':'✨'}</div><div>${curView==='done'?'Нет завершённых':'Список пуст!'}</div></div>`;
    return;
  }
  el.innerHTML = '';
  tasks.forEach(t => {
    const p = gp(t.projectId);
    const di = t.deadline ? { label: new Date(t.deadline).toLocaleDateString('ru',{day:'numeric',month:'short'}), over: new Date(t.deadline) < new Date() } : null;
    const subs = gsubs(t.id), sd = subs.filter(s=>s.done).length, sp = subs.length ? Math.round(sd/subs.length*100) : 0;
    const div = document.createElement('div');
    div.className = 'task-item' + (t.done?' done':'');

    const chk = document.createElement('div');
    chk.className = 'task-check' + (t.done?' done-check':'');
    chk.style.borderColor = p.color; chk.style.background = t.done ? p.color : 'transparent';
    chk.innerHTML = `<span class="task-check-inner" style="color:#fff">✓</span>`;
    chk.onclick = e => toggleTask(t.id, e);

    const body = document.createElement('div'); body.className = 'task-body';
    const prioTag = t.priority ? `<span class="task-priority priority-${t.priority}">${{high:'Высокий',med:'Средний',low:'Низкий'}[t.priority]}</span>` : '';
    body.innerHTML = `<div class="task-title">${esc(t.title)}</div>`
      + (t.notes ? `<div class="task-note-preview">${esc(t.notes)}</div>` : '')
      + `<div class="task-meta"><span class="task-proj" style="color:${p.color}">${esc(p.name)}</span>`
      + (di ? `<span class="task-date${di.over?' overdue':''}">${di.over?'⚠️ ':'📅 '}${di.label}${t.taskTime?' '+t.taskTime:''}</span>` : '')
      + (t.recur ? `<span class="task-priority priority-low">↻ ${{daily:'Ежедн.',weekly:'Еженед.',monthly:'Ежемес.'}[t.recur]||t.recur}</span>` : '')
      + prioTag
      + (subs.length ? `<span class="task-date">☑ ${sd}/${subs.length}</span>` : '')
      + `</div>`
      + (subs.length ? `<div class="sub-progress"><div class="sub-progress-fill" style="width:${sp}%;background:${p.color}"></div></div>` : '');
    body.onclick = () => openDetail(t.id);

    const acts = document.createElement('div'); acts.className = 'task-actions';
    const eb = document.createElement('button'); eb.className = 'task-act'; eb.textContent = '✎'; eb.onclick = () => openDetail(t.id);
    const db2 = document.createElement('button'); db2.className = 'task-act del'; db2.textContent = '✕';
    db2.onclick = async e => { e.stopPropagation(); S.tasks=S.tasks.filter(x=>x.id!==t.id); saveLocal(); renderAll(); await fbDel('tasks',t.id); };
    acts.appendChild(eb); acts.appendChild(db2);

    const bar = document.createElement('div'); bar.className = 'task-bar'; bar.style.background = p.color;
    div.appendChild(chk); div.appendChild(body); div.appendChild(acts); div.appendChild(bar);
    el.appendChild(div);
  });
}

// ========== STATS ==========
function renderStats() {
  const el = document.getElementById('statsBar');
  const ac = S.tasks.filter(t=>!t.done).length, dn = S.tasks.filter(t=>t.done).length;
  const tot = S.tasks.length, pct = tot ? Math.round(dn/tot*100) : 0;
  const r=20, ci=2*Math.PI*r, da=ci-ci*pct/100;
  el.innerHTML = `
    <div class="stat"><div class="stat-n" style="color:var(--c1)">${ac}</div><div class="stat-l">Активных</div></div>
    <div class="stat"><div class="stat-n" style="color:var(--c3)">${dn}</div><div class="stat-l">Готово</div></div>
    <div class="stat-ring">
      <svg class="ring-svg" width="48" height="48" viewBox="0 0 48 48">
        <defs><linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#7c6aff"/><stop offset="100%" stop-color="#a78bfa"/></linearGradient></defs>
        <circle class="rb" cx="24" cy="24" r="${r}"/>
        <circle class="rf" cx="24" cy="24" r="${r}" stroke-dasharray="${ci}" stroke-dashoffset="${da}"/>
      </svg>
      <div><div class="stat-n" style="font-size:20px">${pct}%</div><div class="stat-l">Прогресс</div></div>
    </div>`;
}

// ========== SUBTASKS ==========
function renderSubs() {
  const el = document.getElementById('subList'); el.innerHTML = '';
  gsubs(curTask).forEach(s => {
    const row = document.createElement('div'); row.className = 'sub-item';
    const cb = document.createElement('div'); cb.className = 'sub-cb' + (s.done?' done-cb':'');
    cb.style.borderColor = '#7c6aff'; cb.style.background = s.done ? '#7c6aff' : 'transparent';
    cb.innerHTML = `<span class="sub-cb-inner" style="color:#fff">✓</span>`;
    cb.onclick = async () => { s.done=!s.done; s.updatedAt=Date.now(); renderSubs(); saveLocal(); await fbSet('subtasks',s.id,s); };
    const tx = document.createElement('div'); tx.className = 'sub-text'+(s.done?' done-t':''); tx.textContent = s.title;
    const dl = document.createElement('button'); dl.className = 'sub-del'; dl.textContent = '✕';
    dl.onclick = async () => { S.subtasks=S.subtasks.filter(x=>x.id!==s.id); renderSubs(); saveLocal(); await fbDel('subtasks',s.id); };
    row.appendChild(cb); row.appendChild(tx); row.appendChild(dl); el.appendChild(row);
  });
}
async function addSub() {
  const inp = document.getElementById('subInp'), title = inp.value.trim(); if(!title) return;
  const s = { id: crypto.randomUUID(), taskId: curTask, title, done: false, updatedAt: Date.now() };
  S.subtasks.push(s); inp.value = ''; renderSubs(); saveLocal();
  await fbSet('subtasks', s.id, s);
}
window.addSub = addSub;

// ========== CALENDAR ==========
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const WDAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

function dayTasks(y,m,d) { return S.tasks.filter(t=>{if(!t.deadline)return false;const td=new Date(t.deadline);return td.getFullYear()===y&&td.getMonth()===m&&td.getDate()===d;}); }

function renderCal() {
  const y = calDate.getFullYear(), m = calDate.getMonth();
  document.getElementById('calTitle').textContent = MONTHS[m] + ' ' + y;
  const today = new Date(); today.setHours(0,0,0,0);
  const grid = document.getElementById('calGrid');
  grid.innerHTML = WDAYS.map(d=>`<div class="cal-day-lbl">${d}</div>`).join('');
  let dow = new Date(y,m,1).getDay()-1; if(dow<0) dow=6;
  const dim = new Date(y,m+1,0).getDate(), dip = new Date(y,m,0).getDate();
  for(let i=0;i<Math.ceil((dow+dim)/7)*7;i++){
    let day,mo=m,yr=y,other=false;
    if(i<dow){day=dip-dow+i+1;mo=m-1;if(mo<0){mo=11;yr--;}other=true;}
    else if(i>=dow+dim){day=i-dow-dim+1;mo=m+1;if(mo>11){mo=0;yr++;}other=true;}
    else day=i-dow+1;
    const dd=new Date(yr,mo,day);dd.setHours(0,0,0,0);
    const cell=document.createElement('div');
    cell.className='cal-day'+(other?' other':'')+(dd.getTime()===today.getTime()?' today':'')
      +(calDay&&calDay.getTime()===dd.getTime()?' selected':'')+(dayTasks(yr,mo,day).length?' has-tasks':'');
    cell.textContent=day;
    const _y=yr,_m=mo,_d=day;
    cell.onclick=()=>{calDay=new Date(_y,_m,_d);calDay.setHours(0,0,0,0);renderCal();renderCalPanel();};
    grid.appendChild(cell);
  }
  renderCalPanel();
}

function renderCalPanel() {
  const el = document.getElementById('calPanel'); el.innerHTML = '';
  if (!calDay) return;
  const y=calDay.getFullYear(),m=calDay.getMonth(),d=calDay.getDate();
  const tasks = dayTasks(y,m,d);
  const lbl = calDay.toLocaleDateString('ru',{day:'numeric',month:'long',weekday:'long'});

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'cal-panel-hdr';
  hdr.textContent = lbl.charAt(0).toUpperCase()+lbl.slice(1);
  el.appendChild(hdr);

  // Quick add form
  const qa = document.createElement('div'); qa.className = 'cal-quick-add';
  const r1 = document.createElement('div'); r1.className = 'cal-quick-row';
  const ti = document.createElement('input');
  ti.id = 'calTaskInp'; ti.className = 'cal-quick-input';
  ti.placeholder = '+ Новая задача...';
  ti.onkeydown = e => { if(e.key==='Enter') calAddTask(); };
  const tm = document.createElement('input');
  tm.id = 'calTimeInp'; tm.type = 'time'; tm.className = 'cal-quick-time';
  r1.appendChild(ti); r1.appendChild(tm); qa.appendChild(r1);
  const r2 = document.createElement('div'); r2.className = 'cal-quick-row';
  const ps = document.createElement('select');
  ps.id = 'calProjSel'; ps.className = 'cal-quick-select';
  S.projects.forEach(p => { const o=document.createElement('option');o.value=p.id;o.textContent=p.name;ps.appendChild(o); });
  const ab = document.createElement('button');
  ab.className = 'cal-quick-btn'; ab.textContent = 'Добавить'; ab.onclick = calAddTask;
  r2.appendChild(ps); r2.appendChild(ab); qa.appendChild(r2);
  el.appendChild(qa);

  // Task list
  if (!tasks.length) {
    const em = document.createElement('div'); em.className = 'cal-empty';
    em.textContent = 'Нет задач — добавь первую!';
    el.appendChild(em);
  } else {
    tasks.sort((a,b)=>(a.taskTime||'').localeCompare(b.taskTime||'')).forEach(t => {
      const p = gp(t.projectId);
      const row = document.createElement('div');
      row.className = 'cal-task-row';
      row.innerHTML = `<div class="cal-task-bar" style="background:${p.color}"></div>`
        + `<div class="cal-task-body">`
        + `<div class="cal-task-title${t.done?' done':''}">${esc(t.title)}</div>`
        + `<div class="cal-task-sub" style="color:${p.color}">${esc(p.name)}${t.taskTime?' · <b style=color:var(--text-dim)>'+t.taskTime+'</b>':''}</div>`
        + `</div>`
        + `<div class="cal-task-acts">`
        + `<button class="cal-task-btn${t.done?' done':''}" onclick="calToggle('${t.id}')">${t.done?'↩':'✓'}</button>`
        + `<button class="cal-task-btn" onclick="openDetail('${t.id}')">✎</button>`
        + `</div>`;
      el.appendChild(row);
    });
  }
}

async function calAddTask() {
  const ti = document.getElementById('calTaskInp'); if(!ti) return;
  const title = ti.value.trim(); if(!title) return;
  const tv = document.getElementById('calTimeInp').value;
  const pid = document.getElementById('calProjSel').value || (S.projects[0]?.id||'inbox');
  let deadline;
  if(tv){const[h,m]=tv.split(':');deadline=new Date(calDay.getFullYear(),calDay.getMonth(),calDay.getDate(),+h,+m).getTime();}
  else deadline=new Date(calDay.getFullYear(),calDay.getMonth(),calDay.getDate()).getTime();
  const t={id:crypto.randomUUID(),title,done:false,projectId:pid,createdAt:Date.now(),updatedAt:Date.now(),deadline,taskTime:tv||null,notes:'',priority:''};
  S.tasks.unshift(t); ti.value=''; saveLocal(); renderCal(); toast('Задача добавлена!');
  await fbSet('tasks',t.id,t);
}

async function calToggle(id) {
  const t = S.tasks.find(x=>x.id===id); if(!t) return;
  t.done=!t.done; t.updatedAt=Date.now(); saveLocal(); renderCalPanel();
  await fbSet('tasks',t.id,t);
}
window.calToggle = calToggle;

// ========== NOTES ==========
function renderNotes() {
  const q = (document.getElementById('notesSearch').value||'').toLowerCase();
  const el = document.getElementById('notesGrid'); el.innerHTML = '';
  const notes = S.notes.filter(n=>!q||(n.title+n.body).toLowerCase().includes(q));
  if (!notes.length) {
    el.innerHTML = '<div class="notes-empty"><div style="font-size:44px;opacity:.4;margin-bottom:12px">📝</div><div>Нет заметок — создай первую!</div></div>';
    return;
  }
  notes.forEach(n => {
    const card = document.createElement('div'); card.className = 'note-card';
    const bar = document.createElement('div'); bar.className = 'note-bar'; bar.style.background = n.color||NOTE_COLORS[0];
    const title = document.createElement('div'); title.className = 'note-title'; title.textContent = n.title||'Без названия';
    const preview = document.createElement('div'); preview.className = 'note-preview'; preview.textContent = n.body||'';
    const footer = document.createElement('div'); footer.className = 'note-footer';
    footer.innerHTML = `<div class="note-date">${fmtAgo(n.updatedAt||n.createdAt)}</div>`;
    const del = document.createElement('button'); del.className = 'note-del'; del.textContent = '✕';
    del.onclick = async e => { e.stopPropagation(); S.notes=S.notes.filter(x=>x.id!==n.id); renderNotes(); saveLocal(); await fbDel('notes',n.id); toast('Заметка удалена'); };
    card.appendChild(bar); card.appendChild(title); card.appendChild(preview); card.appendChild(footer); card.appendChild(del);
    card.onclick = () => openNote(n.id);
    el.appendChild(card);
  });
}

function openNote(noteId) {
  let n = noteId ? S.notes.find(x=>x.id===noteId) : null;
  if (!n) { n={id:crypto.randomUUID(),title:'',body:'',color:NOTE_COLORS[0],createdAt:Date.now(),updatedAt:Date.now()}; S.notes.unshift(n); }
  curNote = n.id; noteColor = n.color||NOTE_COLORS[0];
  document.getElementById('noteTitleInp').value = n.title;
  document.getElementById('noteTextarea').value = n.body;
  document.getElementById('noteStrip').style.background = noteColor;
  renderNoteColors();
  document.getElementById('noteEditor').classList.add('open');
  setTimeout(() => document.getElementById('noteTitleInp').focus(), 150);
}
window.openNote = openNote;

function renderNoteColors() {
  const el = document.getElementById('noteColors'); el.innerHTML = '';
  NOTE_COLORS.forEach(c => {
    const dot = document.createElement('div'); dot.className = 'nc'+(c===noteColor?' on':''); dot.style.background = c;
    dot.onclick = () => { noteColor=c; document.getElementById('noteStrip').style.background=c; el.querySelectorAll('.nc').forEach(d=>d.classList.remove('on')); dot.classList.add('on'); autoSaveNote(); };
    el.appendChild(dot);
  });
}

function autoSaveNote() {
  const n = S.notes.find(x=>x.id===curNote); if(!n) return;
  n.title = document.getElementById('noteTitleInp').value;
  n.body = document.getElementById('noteTextarea').value;
  n.color = noteColor; n.updatedAt = Date.now();
  saveLocal(); fbSet('notes', n.id, n);
}

function closeNote() {
  autoSaveNote();
  document.getElementById('noteEditor').classList.remove('open');
  curNote = null; renderNotes();
}

// ========== AI (локальный парсер, без внешнего API) ==========
// \b в JS-regex не распознаёт кириллицу как "словесные" символы, поэтому
// границы слов для русского текста считаем вручную через \p{L}/\p{N}.
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function fmtDate(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
const WORDCHARS = '\\p{L}\\p{N}_';
function wb(inner) { return new RegExp('(?<![' + WORDCHARS + '])(?:' + inner + ')(?![' + WORDCHARS + '])', 'iu'); }

function parseTaskLocal(text, today) {
  const removals = [];
  const result = { date: null, time: null, project: null, priority: null };

  if (/не\s*срочно|как-нибудь|не\s*горит|низкий приоритет/i.test(text)) {
    result.priority = 'low';
    removals.push(/не\s*срочно|как-нибудь|не\s*горит|низкий приоритет/i);
  } else if (/срочно|важно|критично|высокий приоритет/i.test(text)) {
    result.priority = 'high';
    removals.push(/срочно|важно|критично|высокий приоритет/i);
  }

  let m = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (m) {
    result.time = String(m[1]).padStart(2,'0') + ':' + m[2];
    removals.push(new RegExp('(?:в|к)\\s*' + escapeRe(m[0]) + '|' + escapeRe(m[0])));
  } else {
    m = text.match(/(\d{1,2})\s*(?:час(?:а|ов)?)?\s*(утра|дня|вечера|ночи)/i);
    if (m) {
      let h = parseInt(m[1], 10);
      const p = m[2].toLowerCase();
      if ((p === 'дня' || p === 'вечера') && h <= 11) h += 12;
      else if (p === 'ночи' && h === 12) h = 0;
      result.time = String(h).padStart(2,'0') + ':00';
      removals.push(new RegExp('(?:в|к)\\s*' + escapeRe(m[0]) + '|' + escapeRe(m[0]), 'i'));
    }
  }

  const WEEKDAYS = [
    ['воскресень', ['е','я','ем','и'], 0],
    ['понедельник', ['','а','е','ом','у'], 1],
    ['вторник', ['','а','е','ом'], 2],
    ['сред', ['а','у','е','ой','ы'], 3],
    ['четверг', ['','а','е','ом'], 4],
    ['пятниц', ['а','у','е','ей','ы'], 5],
    ['суббот', ['а','у','е','ой','ы'], 6],
  ];
  if (wb('послезавтра').test(text)) {
    const d = new Date(today); d.setDate(d.getDate()+2); result.date = fmtDate(d);
    removals.push(wb('послезавтра'));
  } else if (wb('завтра').test(text)) {
    const d = new Date(today); d.setDate(d.getDate()+1); result.date = fmtDate(d);
    removals.push(wb('завтра'));
  } else if (wb('сегодня').test(text)) {
    result.date = fmtDate(today);
    removals.push(wb('сегодня'));
  } else {
    const wm = text.match(/через\s+(\d+)\s+д(?:ень|ня|ней)/i);
    if (wm) {
      const d = new Date(today); d.setDate(d.getDate()+parseInt(wm[1],10)); result.date = fmtDate(d);
      removals.push(new RegExp(escapeRe(wm[0]), 'i'));
    } else if (/через\s+недел/i.test(text)) {
      const d = new Date(today); d.setDate(d.getDate()+7); result.date = fmtDate(d);
      removals.push(/через\s+недел\w*/i);
    } else {
      for (const [stem, endings, idx] of WEEKDAYS) {
        const re = wb('(?:в\\s+)?' + stem + '(?:' + endings.join('|') + ')');
        if (re.test(text)) {
          let diff = (idx - today.getDay() + 7) % 7;
          if (diff === 0) diff = 7;
          const d = new Date(today); d.setDate(d.getDate()+diff); result.date = fmtDate(d);
          removals.push(re);
          break;
        }
      }
    }
  }

  for (const p of S.projects) {
    const re = wb(escapeRe(p.name));
    if (re.test(text)) { result.project = p.name; removals.push(re); break; }
  }

  let cleaned = text;
  removals.forEach(re => { cleaned = cleaned.replace(re, ''); });
  cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/^[\s,.\-]+|[\s,.\-]+$/g, '').trim();
  cleaned = cleaned.replace(/\s+(?:по|в|к|для|на|от|до|с|у)$/i, '').trim();
  result.title = cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : text;
  return result;
}

async function runAI() {
  const inp = document.getElementById('aiInput'), text = inp.value.trim(); if(!text) return;
  document.getElementById('aiThinking').classList.add('show');
  document.getElementById('aiBtn').disabled = true;
  await new Promise(r => setTimeout(r, 300));
  try {
    const parsed = parseTaskLocal(text, new Date());
    const proj = (parsed.project && S.projects.find(p=>p.name.toLowerCase()===parsed.project.toLowerCase())) || S.projects[0] || {id:'inbox'};
    let deadline = null;
    if (parsed.date) { const d=new Date(parsed.date); if(parsed.time){const[h,m]=parsed.time.split(':');d.setHours(+h,+m,0,0);} deadline=d.getTime(); }
    const t = {id:crypto.randomUUID(),title:parsed.title||text,done:false,projectId:proj.id,createdAt:Date.now(),updatedAt:Date.now(),deadline,taskTime:parsed.time||null,notes:'',priority:parsed.priority||''};
    S.tasks.unshift(t); inp.value=''; saveLocal(); renderAll(); toast('✦ '+t.title);
    await fbSet('tasks', t.id, t);
  } catch(e) {
    const t={id:crypto.randomUUID(),title:text,done:false,projectId:S.projects[0]?.id||'inbox',createdAt:Date.now(),updatedAt:Date.now(),deadline:null,taskTime:null,notes:'',priority:''};
    S.tasks.unshift(t); inp.value=''; saveLocal(); renderAll(); toast('Задача добавлена');
    await fbSet('tasks', t.id, t);
  }
  document.getElementById('aiThinking').classList.remove('show');
  document.getElementById('aiBtn').disabled = false;
}

function initMic() {
  const btn=document.getElementById('micBtn'),inp=document.getElementById('aiInput');
  if(!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)){btn.style.display='none';return;}
  const rec=new (window.SpeechRecognition||window.webkitSpeechRecognition)();
  rec.lang='ru-RU';rec.continuous=false;rec.interimResults=true;let running=false;
  rec.onresult=e=>{let t='';for(let i=e.resultIndex;i<e.results.length;i++)t+=e.results[i][0].transcript;inp.value=t;};
  rec.onend=()=>{running=false;btn.classList.remove('recording');};
  btn.onclick=()=>{if(running)rec.stop();else{rec.start();running=true;btn.classList.add('recording');}};
}

// ========== VIEW ==========
function setView(v) {
  curView = v;
  ['tasksView','calView','notesView'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  const vm={tasks:'tasksView',done:'tasksView',cal:'calView',notes:'notesView'};
  if(vm[v]) document.getElementById(vm[v]).style.display='block';
  ['navTasks','navCal','navNotes','navDone'].forEach(id=>document.getElementById(id).classList.remove('active'));
  const nm={tasks:'navTasks',cal:'navCal',notes:'navNotes',done:'navDone'};
  if(nm[v]) document.getElementById(nm[v]).classList.add('active');
  const isTask = v==='tasks'||v==='done';
  ['aiWrap','addArea','projArea','statsBar'].forEach(id=>document.getElementById(id).style.display=isTask?(id==='statsBar'?'flex':'block'):'none');
  if(v==='cal'){calDay=calDay||new Date();calDay.setHours(0,0,0,0);renderCal();}
  else if(v==='notes') renderNotes();
  else renderAll();
}
window.setView = setView;

function renderAll() { renderProjects(); renderStats(); renderTasks(); }

// ========== EVENTS ==========
document.getElementById('aiBtn').onclick = runAI;
document.getElementById('aiInput').onkeydown = e => { if(e.key==='Enter') runAI(); };
document.getElementById('addBtn').onclick = addTask;
document.getElementById('newTaskInp').onkeydown = e => { if(e.key==='Enter') addTask(); };
document.getElementById('calPrev').onclick = () => { calDate=new Date(calDate.getFullYear(),calDate.getMonth()-1,1);renderCal(); };
document.getElementById('calNext').onclick = () => { calDate=new Date(calDate.getFullYear(),calDate.getMonth()+1,1);renderCal(); };
document.getElementById('projModal').onclick = e => { if(e.target.id==='projModal') closeModal('projModal'); };
document.getElementById('detailModal').onclick = e => { if(e.target.id==='detailModal'){saveDetail();closeModal('detailModal');} };
// native <dialog> closes on Escape (fires 'cancel') for free — save first so
// an unsaved priority/recur toggle isn't silently discarded.
document.getElementById('detailModal').addEventListener('cancel', saveDetail);
document.getElementById('detailCheck').onclick = toggleDetailCheck;
document.getElementById('detailTitle').onblur = saveDetail;
document.getElementById('detailNote').onblur = saveDetail;
document.getElementById('detailProj').onchange = saveDetail;
document.getElementById('detailDate').onchange = saveDetail;
document.getElementById('detailTime').onchange = saveDetail;
document.getElementById('notesSearch').oninput = renderNotes;
document.getElementById('noteBack').onclick = closeNote;
document.getElementById('noteSaveBtn').onclick = () => { autoSaveNote(); closeNote(); };
document.getElementById('noteTitleInp').oninput = autoSaveNote;
let ntTimer; document.getElementById('noteTextarea').oninput = () => { clearTimeout(ntTimer); ntTimer=setTimeout(autoSaveNote,1500); };

// ========== RECURRING ==========
function checkRecurring() {
  const today = new Date(); today.setHours(0,0,0,0);
  S.tasks.filter(t => t.recur && t.done).forEach(t => {
    const last = new Date(t.deadline || t.createdAt); last.setHours(0,0,0,0);
    let next = new Date(last);
    if (t.recur==='daily') next.setDate(next.getDate()+1);
    else if (t.recur==='weekly') next.setDate(next.getDate()+7);
    else if (t.recur==='monthly') next.setMonth(next.getMonth()+1);
    // dedup by chain root (parentId), not title — two recurring tasks
    // with the same title no longer suppress each other's next instance.
    const rootId = t.parentId || t.id;
    if (next <= today && !S.tasks.find(x => !x.done && (x.parentId===rootId || x.id===rootId))) {
      const nt = {id:crypto.randomUUID(),title:t.title,done:false,projectId:t.projectId,
        createdAt:Date.now(),updatedAt:Date.now(),deadline:next.getTime(),taskTime:t.taskTime,notes:t.notes,
        priority:t.priority,recur:t.recur,parentId:rootId};
      S.tasks.unshift(nt); fbSet('tasks', nt.id, nt);
    }
  });
}

// ========== INIT ==========
async function init() {
  loadLocal();
  loadTheme();
  if (!S.projects.length) {
    S.projects = [{id:'inbox',name:'Входящие',color:'#7c6aff'},{id:'work',name:'Работа',color:'#60a5fa'},{id:'personal',name:'Личное',color:'#34d399'}];
  }
  checkRecurring();
  renderAll(); initMic();
  await initFirebase();
}
init();

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
