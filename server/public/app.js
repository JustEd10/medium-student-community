const CATEGORIES = ['Документы', 'Учёба', 'Кампус', 'Языки', 'События'];

const keys = { token: 'medium.lesson.token', login: 'medium.lesson.login', role: 'medium.lesson.role' };
function stored(key) { try { return localStorage.getItem(keys[key]); } catch { return null; } }
function store(key, value) { try { value ? localStorage.setItem(keys[key], value) : localStorage.removeItem(keys[key]); } catch { /* состояние остаётся в памяти */ } }
let token = stored('token');
let currentUser = stored('login');
let role = stored('role');
let itemsVersion = 0;
let myVersion = 0;

const $ = (id) => document.getElementById(id);

async function api(url, method = 'GET', body) {
  const requestedToken = token;
  const headers = { 'Content-Type': 'application/json' };
  if (requestedToken) headers.Authorization = 'Bearer ' + requestedToken;
  const res = await fetch(url, { method, cache: 'no-store', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && requestedToken && requestedToken === token) logout();
    throw new Error(data.error || 'Ошибка');
  }
  return data;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showUser() {
  const box = $('userBox');
  box.innerHTML = '';
  $('loginBox').classList.toggle('hidden', !!token);
  $('addBox').classList.toggle('hidden', !token);
  $('myBox').classList.toggle('hidden', !token);
  if (!token) return;
  box.append(el('span', currentUser + ' (' + role + ') '));
  const btn = el('button', 'Выйти', 'small');
  btn.onclick = logout;
  box.append(btn);
}

function logout() {
  if (token)
    fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  token = currentUser = role = null;
  for (const key of Object.keys(keys)) store(key, null);
  myVersion += 1;
  $('myRecords').replaceChildren();
  showUser();
  loadItems();
}

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  const form = e.target;
  const submit = form.querySelector('button');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    const data = await api('/api/login', 'POST', {
      login: form.login.value,
      password: form.password.value,
    });
    token = data.token;
    currentUser = data.login;
    role = data.role;
    store('token', token);
    store('login', currentUser);
    store('role', role);
    form.reset();
    showUser();
    loadItems();
    loadMy();
  } catch (err) {
    $('loginError').textContent = err.message;
  } finally {
    submit.disabled = false;
  }
};

async function loadItems() {
  const version = ++itemsVersion;
  const params = new URLSearchParams();
  if ($('categoryFilter').value) params.set('category', $('categoryFilter').value);
  if ($('searchInput').value.trim()) params.set('search', $('searchInput').value.trim());
  params.set('sort', $('sortSelect').value);

  const box = $('items');
  try {
    const items = await api('/api/items?' + params);
    const cards = await Promise.all(items.map(drawItem));
    if (version !== itemsVersion) return;
    box.innerHTML = '';
    if (!items.length) box.append(el('p', 'Ничего не найдено', 'hint'));
    box.append(...cards);
  } catch (err) {
    if (version === itemsVersion) box.textContent = err.message;
  }
}

async function drawItem(item) {
  const card = el('div', undefined, 'item');
  card.append(el('h3', item.title));
  if (item.body) card.append(el('p', item.body));
  const date = new Date(item.createdAt).toLocaleString('ru-RU');
  card.append(
    el(
      'div',
      `${item.category} · ${item.author} · ${date} · ответов: ${item.answersCount}`,
      'meta',
    ),
  );

  const answers = await api('/api/records?item_id=' + item.id);
  for (const a of answers) {
    const row = el('div', undefined, 'answer');
    const stars = a.rating ? ' · оценка: ' + a.rating + '/5' : '';
    row.append(el('div', a.body));
    row.append(el('span', a.author + stars, 'meta'));
    // оценить может автор вопроса
    if (token && item.author === currentUser && a.author !== currentUser) {
      const rate = el('div', undefined, 'rating-stars');
      rate.setAttribute('role', 'group');
      rate.setAttribute('aria-label', 'Оценка ответа от 1 до 5 звёзд');
      for (let i = 1; i <= 5; i++) {
        const star = el('button', i <= (a.rating || 0) ? '★' : '☆');
        star.type = 'button';
        star.setAttribute('aria-label', `${i} из 5 звёзд`);
        star.setAttribute('aria-pressed', String(i === a.rating));
        star.onclick = async () => {
          const buttons = [...rate.querySelectorAll('button')];
          buttons.forEach(button => button.disabled = true);
          try {
            await api(`/api/records/${a.id}/rating`, 'PATCH', { rating: i });
            loadItems();
            loadMy();
          } catch (err) { alert(err.message); }
          finally { buttons.forEach(button => button.disabled = false); }
        };
        rate.append(star);
      }
      row.append(' ', rate);
    }
    card.append(row);
  }

  if (token) {
    const form = el('form', undefined, 'answer-form');
    const input = el('input');
    input.placeholder = 'Ваш ответ';
    const send = el('button', 'Ответить', 'small');
    form.append(input, send);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (send.disabled) return;
      send.disabled = true;
      try {
        await api('/api/records', 'POST', { item_id: item.id, body: input.value });
        loadItems();
        loadMy();
      } catch (err) {
        alert(err.message);
      } finally {
        send.disabled = false;
      }
    };
    card.append(form);

    if (item.author === currentUser || role === 'admin') {
      const del = el('button', 'Удалить вопрос', 'small danger');
      del.style.marginTop = '8px';
      del.onclick = async () => {
        if (!confirm('Удалить вопрос?')) return;
        try {
          await api('/api/items/' + item.id, 'DELETE');
          loadItems();
          loadMy();
        } catch (err) {
          alert(err.message);
        }
      };
      card.append(del);
    }
  }
  return card;
}

$('itemForm').onsubmit = async (e) => {
  e.preventDefault();
  $('itemError').textContent = '';
  const f = e.target;
  const submit = f.querySelector('button');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    await api('/api/items', 'POST', {
      title: f.title.value,
      body: f.body.value,
      category: f.category.value,
    });
    f.reset();
    loadItems();
  } catch (err) {
    $('itemError').textContent = err.message;
  } finally {
    submit.disabled = false;
  }
};

// раздел "Мои записи"
async function loadMy() {
  if (!token) return;
  const requestedToken = token;
  const version = ++myVersion;
  const box = $('myRecords');
  try {
    const list = await api('/api/records/my');
    if (version !== myVersion || requestedToken !== token) return;
    box.innerHTML = '';
    if (!list.length) box.append(el('p', 'Вы пока никому не отвечали', 'hint'));
    for (const r of list) {
      const row = el('div', undefined, 'item');
      row.append(el('div', 'К вопросу: ' + r.item_title, 'meta'));
      row.append(el('p', r.body));
      if (r.rating) row.append(el('span', 'Оценка: ' + r.rating + '/5', 'meta'));
      box.append(row);
    }
  } catch (err) {
    if (version === myVersion && requestedToken === token) box.textContent = err.message;
  }
}

// самый первый шаг задания: сервер отдаёт массив из кода, страница рисует карточки
$('demoBtn').onclick = async () => {
  const box = $('demoList');
  try {
    const list = await api('/api/demo');
    box.innerHTML = '';
    for (const d of list) {
      const card = el('div', undefined, 'item');
      card.append(el('h3', d.title));
      card.append(el('span', 'Цена: ' + d.price, 'meta'));
      box.append(card);
    }
  } catch (err) {
    box.textContent = err.message;
  }
};

for (const c of CATEGORIES) {
  $('categoryFilter').append(new Option(c, c));
  $('itemForm').category.append(new Option(c, c));
}
$('loadBtn').onclick = loadItems;
$('categoryFilter').onchange = loadItems;
$('sortSelect').onchange = loadItems;
$('searchInput').oninput = loadItems;

showUser();
loadMy();
