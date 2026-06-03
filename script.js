/* =================================================================
   ТУР В ГОРЫ — Ала-Арча Экспресс
   script.js
   ================================================================= */

/* =========== TELEGRAM BOT НАСТРОЙКИ ===========
   Шаги настройки:
   1. Откройте Telegram → найдите @BotFather → /newbot
   2. Скопируйте полученный токен и вставьте в TELEGRAM_BOT_TOKEN ниже
   3. Откройте @userinfobot → отправьте /start → скопируйте ваш ID
      (или ID канала, если хотите получать заявки в канал — добавьте
       бота в админы канала)
   4. Вставьте ID в TELEGRAM_CHAT_ID ниже
   ВНИМАНИЕ: эти значения также можно ввести в админ-панели
   во вкладке «Telegram» — они сохранятся в localStorage браузера.
   =============================================== */

const DEFAULT_CONFIG = {
  // БЕЗОПАСНОСТЬ: токен НЕ хранится в коде (его увидел бы любой посетитель).
  // Основной канал заявок — WhatsApp (см. BUSINESS_WHATSAPP ниже), он не требует
  // секретов. Если хотите получать заявки и в Telegram со СВОЕГО устройства —
  // войдите как админ → вкладка «Telegram» → вставьте токен и Chat ID. Эти данные
  // сохранятся только в вашем браузере (localStorage), а не в коде сайта.
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: '',
  PRICE_PER_PERSON: 2000  // сом
};

/* Логин и пароль администратора по умолчанию.
   Войти: кнопка «Войти» в шапке (на телефоне — в меню ☰). */
const ADMIN_LOGIN = 'admin';
const ADMIN_PASSWORD = 'Aibek_2248';

/* WhatsApp координатора — мгновенный канал, работает без настройки.
   Заявка открывается у клиента в WhatsApp уже заполненной. */
const BUSINESS_WHATSAPP = '996555015405';

/* Безопасный Telegram через серверный «посредник» (Google Apps Script или
   Cloudflare Worker). Токен хранится на сервере, а НЕ в коде сайта.
   Сюда сайт шлёт заявки — посредник пересылает их в Telegram для ВСЕХ
   посетителей. Вставьте сюда URL после развёртывания. Если пусто —
   Telegram для посетителей выключен, заявки идут в WhatsApp. */
const TELEGRAM_PROXY_URL = 'https://script.google.com/macros/s/AKfycbzFI8kEcPODEugKqKfyxxzANanZrUoniv-ib-BV3_jE4NWf2n0Ngj6AG9a6uZDHMtU/exec';

/* Всего мест на одну смену (автобус) */
const SEATS_TOTAL = 19;

/* Последняя отправленная бронь (для кнопки «Продублировать в WhatsApp») */
let _lastBooking = null;

/* ===== STORAGE KEYS ===== */
const K = {
  USERS:    'aa_users',
  CURRENT:  'aa_current',
  BOOKINGS: 'aa_bookings',
  REVIEWS:  'aa_reviews',
  CONFIG:   'aa_config',
  THEME:    'aa_theme'
};

/* ===== HELPERS ===== */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  del(key) { try { localStorage.removeItem(key); } catch {} }
};

function getConfig() {
  return { ...DEFAULT_CONFIG, ...store.get(K.CONFIG, {}) };
}
function setConfig(patch) {
  const cur = store.get(K.CONFIG, {});
  store.set(K.CONFIG, { ...cur, ...patch });
}

/* Simple obfuscation for password storage (NOT secure crypto — just so
   passwords aren't readable in plain DevTools view). For real production
   use a backend. */
async function hashPassword(text) {
  if (window.crypto?.subtle) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return btoa(unescape(encodeURIComponent(text))) + '_b64';
}

function uid(prefix = 'AA') {
  return prefix + '-' + Date.now().toString(36).toUpperCase() + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(s) {
  return ({ pending:'Ожидает', confirmed:'Подтверждено', cancelled:'Отменено', completed:'Завершено' })[s] || s;
}

/* =================================================================
   TOAST NOTIFICATIONS
   ================================================================= */
function toast(message, type = 'info', timeout = 3800) {
  const c = $('#toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type !== 'info' ? type : '');
  const icons = { info:'ℹ️', success:'✅', error:'❌', warning:'⚠️' };
  el.innerHTML = `<span>${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  }, timeout);
}

/* =================================================================
   NAVIGATION
   ================================================================= */
function goTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const header = $('#site-header');
  const offset = header ? header.offsetHeight : 0;
  const top = el.getBoundingClientRect().top + window.pageYOffset - offset - 8;
  window.scrollTo({ top, behavior: 'smooth' });
  closeMobileMenu();
}

function toggleMobileMenu() {
  let overlay = $('.mobile-nav-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'mobile-nav-overlay';
    document.body.appendChild(overlay);
  }
  // Если открываем — пересобираем содержимое под текущий вход в аккаунт
  if (!overlay.classList.contains('open')) {
    overlay.innerHTML = '';
    const items = [
      ['Как это работает','how-it-works'],
      ['Что входит','whats-included'],
      ['Расписание','schedule'],
      ['Галерея','gallery'],
      ['Отзывы','reviews'],
      ['Цена','pricing'],
      ['Контакты','contact']
    ];
    items.forEach(([label, id]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => { goTo(id); closeMobileMenu(); };
      overlay.appendChild(b);
    });

    // Блок аккаунта
    const acc = document.createElement('div');
    acc.className = 'mobile-nav-auth';
    const u = getCurrentUser();
    const mk = (label, fn, cls) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = () => { closeMobileMenu(); fn(); };
      return b;
    };
    if (!u) {
      acc.appendChild(mk('Войти', () => openAuthModal('login')));
      acc.appendChild(mk('Регистрация', () => openAuthModal('register'), 'mobile-nav-primary'));
    } else {
      const hi = document.createElement('div');
      hi.className = 'mobile-nav-hi';
      hi.textContent = (u.name || u.login) + (u.role === 'admin' ? ' (админ)' : '');
      acc.appendChild(hi);
      acc.appendChild(mk('Мой профиль', openProfile));
      if (u.role === 'admin') acc.appendChild(mk('Админ-панель', openAdmin, 'mobile-nav-primary'));
      acc.appendChild(mk('Выйти', logout, 'mobile-nav-danger'));
    }
    overlay.appendChild(acc);
  }
  overlay.classList.toggle('open');
  $('#menu-toggle').classList.toggle('open');
}
function closeMobileMenu() {
  $('.mobile-nav-overlay')?.classList.remove('open');
  $('#menu-toggle')?.classList.remove('open');
}

/* =================================================================
   FAQ ACCORDION
   ================================================================= */
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const isOpen = item.classList.contains('open');
  $$('.faq-item.open').forEach(i => i.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

/* =================================================================
   THEME (dark/light)
   ================================================================= */
function applyTheme(t) {
  if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}
function initTheme() {
  const saved = store.get(K.THEME);
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const t = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(t);
  $('#theme-toggle')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    store.set(K.THEME, next);
  });
}

/* =================================================================
   AUTH
   ================================================================= */
async function ensureAdminUser() {
  const users = store.get(K.USERS, []);
  const pwHash = await hashPassword(ADMIN_PASSWORD);
  const admin = users.find(u => u.login === ADMIN_LOGIN);
  if (!admin) {
    users.push({
      id: uid('USR'),
      name: 'Администратор',
      login: ADMIN_LOGIN,
      email: 'admin@local',
      phone: '',
      password: pwHash,
      role: 'admin',
      createdAt: new Date().toISOString()
    });
  } else {
    // Гарантируем актуальный пароль и роль администратора
    admin.password = pwHash;
    admin.role = 'admin';
  }
  store.set(K.USERS, users);
}

function getCurrentUser() {
  const id = store.get(K.CURRENT);
  if (!id) return null;
  return store.get(K.USERS, []).find(u => u.id === id) || null;
}
function setCurrentUser(user) {
  if (user) store.set(K.CURRENT, user.id);
  else store.del(K.CURRENT);
  renderHeaderAuth();
}

function renderHeaderAuth() {
  const u = getCurrentUser();
  const authArea = $('#auth-area');
  const userArea = $('#user-area');
  const adminItem = $('#admin-menu-item');
  if (u) {
    authArea.classList.add('hidden');
    userArea.classList.remove('hidden');
    $('#user-avatar').textContent = (u.name || u.login || 'A').slice(0,1).toUpperCase();
    $('#user-name').textContent = u.name || u.login;
    adminItem.classList.toggle('hidden', u.role !== 'admin');
  } else {
    authArea.classList.remove('hidden');
    userArea.classList.add('hidden');
  }
}

function openAuthModal(tab = 'login') {
  switchAuthTab(tab);
  openModal('auth-modal');
}
function switchAuthTab(tab) {
  $$('#auth-modal .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-login').classList.toggle('hidden', tab !== 'login');
  $('#tab-register').classList.toggle('hidden', tab !== 'register');
}

function toggleUserMenu() {
  const a = $('#user-area');
  a.classList.toggle('open');
  $('#user-chip').setAttribute('aria-expanded', a.classList.contains('open'));
}
document.addEventListener('click', e => {
  const a = $('#user-area');
  if (a && a.classList.contains('open') && !a.contains(e.target)) a.classList.remove('open');
});

function logout() {
  setCurrentUser(null);
  toast('Вы вышли из аккаунта');
}

function openProfile() {
  if (!getCurrentUser()) return openAuthModal('login');
  renderProfile();
  openModal('profile-modal');
  $('#user-area')?.classList.remove('open');
}

async function handleLogin(e) {
  e.preventDefault();
  const id = $('#login-email').value.trim();
  const pw = $('#login-password').value;
  if (!id || !pw) return toast('Заполните все поля', 'warning');
  const users = store.get(K.USERS, []);
  const hash = await hashPassword(pw);
  const u = users.find(u => (u.login === id || u.email === id) && u.password === hash);
  if (!u) return toast('Неверный логин или пароль', 'error');
  setCurrentUser(u);
  closeModal('auth-modal');
  toast(`Добро пожаловать, ${u.name || u.login}!`, 'success');
  $('#login-form').reset();
}

async function handleRegister(e) {
  e.preventDefault();
  const name = $('#reg-name').value.trim();
  const email = $('#reg-email').value.trim().toLowerCase();
  const phone = $('#reg-phone').value.trim();
  const pw = $('#reg-password').value;
  if (!name || !email || !pw) return toast('Заполните обязательные поля', 'warning');
  if (pw.length < 6) return toast('Пароль слишком короткий', 'warning');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Некорректный e-mail', 'warning');
  const users = store.get(K.USERS, []);
  if (users.find(u => u.email === email)) return toast('Этот e-mail уже зарегистрирован', 'error');
  const user = {
    id: uid('USR'),
    name, login: email, email, phone,
    password: await hashPassword(pw),
    role: 'user',
    createdAt: new Date().toISOString()
  };
  users.push(user);
  store.set(K.USERS, users);
  setCurrentUser(user);
  closeModal('auth-modal');
  toast(`Аккаунт создан. Добро пожаловать, ${name}!`, 'success');
  $('#register-form').reset();
}

/* =================================================================
   PROFILE RENDER
   ================================================================= */
function renderProfile() {
  const u = getCurrentUser();
  if (!u) return;
  $('#profile-avatar').textContent = (u.name || u.login || 'A').slice(0,1).toUpperCase();
  $('#profile-name').textContent = u.name || u.login;
  $('#profile-email').textContent = u.email || u.login;

  const all = store.get(K.BOOKINGS, []);
  const mine = all.filter(b => b.userId === u.id || b.email === u.email);
  const today = new Date().toISOString().slice(0,10);
  $('#profile-total').textContent = mine.length;
  $('#profile-upcoming').textContent = mine.filter(b => b.date >= today && b.status !== 'cancelled').length;
  $('#profile-done').textContent = mine.filter(b => b.status === 'completed').length;

  const list = $('#my-bookings');
  if (!mine.length) {
    list.innerHTML = `<div class="empty-state">У вас пока нет бронирований.<br/>
      <button class="btn-link" onclick="closeModal('profile-modal'); goTo('pricing')" style="color:var(--green);font-weight:600;">Забронировать первую поездку →</button></div>`;
    return;
  }
  list.innerHTML = mine
    .sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map(b => bookingCardHTML(b, true))
    .join('');
}

function bookingCardHTML(b, allowCancel) {
  const isCancellable = allowCancel && (b.status === 'pending' || b.status === 'confirmed') && b.date >= new Date().toISOString().slice(0,10);
  return `
    <div class="booking-card">
      <div class="b-main">
        <div class="b-id">№ ${escapeHtml(b.id)}</div>
        <div class="b-date">${fmtDate(b.date)} · ${b.time === 'evening' ? '🌅 Вечер' : '☀️ Утро'}</div>
        <div class="b-meta">
          <span>👥 ${b.seats} мест</span>
          <span>💵 ${b.total} сом</span>
        </div>
      </div>
      <div class="b-actions">
        <span class="status-chip status-${b.status}">${statusLabel(b.status)}</span>
        ${isCancellable ? `<button class="action-btn danger" onclick="cancelMyBooking('${b.id}')">Отменить</button>` : ''}
      </div>
    </div>`;
}

function cancelMyBooking(id) {
  if (!confirm('Отменить эту бронь?')) return;
  const list = store.get(K.BOOKINGS, []);
  const i = list.findIndex(b => b.id === id);
  if (i < 0) return;
  list[i].status = 'cancelled';
  list[i].cancelledAt = new Date().toISOString();
  store.set(K.BOOKINGS, list);
  renderProfile();
  toast('Бронь отменена', 'success');
}

/* =================================================================
   BOOKING FORM
   ================================================================= */
function recalcPrice() {
  const seats = +$('#seats').value || 1;
  const price = getConfig().PRICE_PER_PERSON;
  $('#price-per-person').textContent = price;
  $('#price-total').textContent = `Итого: ${(seats * price).toLocaleString('ru-RU')} сом`;
  updateAvailability();
}

/* Сколько мест уже забронировано на конкретную дату+смену (без отменённых) */
function getBookedSeats(date, time) {
  return store.get(K.BOOKINGS, [])
    .filter(b => b.date === date && b.time === time && b.status !== 'cancelled')
    .reduce((sum, b) => sum + (+b.seats || 0), 0);
}

/* Обновляет индикатор «Свободно X из 19 мест» под ценой */
function updateAvailability() {
  const wrap = $('#seat-avail');
  if (!wrap) return;
  const date = $('#date')?.value;
  const time = $('#time')?.value;
  const fill = $('#seat-avail-fill');
  const text = $('#seat-avail-text');

  if (!date) {
    wrap.classList.remove('low', 'full');
    if (fill) fill.style.width = '0%';
    text.textContent = 'Выберите дату и смену';
    return;
  }

  const booked = getBookedSeats(date, time);
  const free = Math.max(0, SEATS_TOTAL - booked);
  const pct = Math.round((booked / SEATS_TOTAL) * 100);
  if (fill) fill.style.width = pct + '%';

  wrap.classList.toggle('full', free === 0);
  wrap.classList.toggle('low', free > 0 && free <= 5);

  const shift = time === 'evening' ? 'вечер' : 'утро';
  text.textContent = free === 0
    ? `Мест нет на ${fmtDate(date)} (${shift}) — выберите другой день`
    : `Свободно ${free} из ${SEATS_TOTAL} мест · ${fmtDate(date)}, ${shift}`;
}

/* Текст брони для WhatsApp (без Markdown) */
function buildBookingText(b) {
  const shift = b.time === 'evening' ? 'Вечер (16:00–21:00)' : 'Утро (10:00–15:00)';
  return [
    'Здравствуйте! Хочу забронировать тур в Ала-Арчу.',
    '',
    `№ брони: ${b.id}`,
    `Имя: ${b.name}`,
    `Телефон: ${b.phone}`,
    `Дата: ${fmtDate(b.date)}`,
    `Смена: ${shift}`,
    `Мест: ${b.seats}`,
    `Сумма: ${b.total.toLocaleString('ru-RU')} сом`,
    b.comment ? `Комментарий: ${b.comment}` : null
  ].filter(Boolean).join('\n');
}

/* Открывает WhatsApp координатора с заполненной заявкой */
function sendBookingToWhatsApp(b) {
  const url = `https://wa.me/${BUSINESS_WHATSAPP}?text=${encodeURIComponent(buildBookingText(b))}`;
  window.open(url, '_blank');
}

/* Кнопка в блоке успеха */
function resendLastWhatsApp() {
  if (_lastBooking) sendBookingToWhatsApp(_lastBooking);
}

function validateBookingForm() {
  $$('.field-error').forEach(s => s.textContent = '');
  $$('#booking-form input, #booking-form select').forEach(i => i.classList.remove('invalid'));

  let ok = true;
  const name = $('#name').value.trim();
  const phone = $('#phone').value.trim();
  const date = $('#date').value;

  if (name.length < 2) {
    $('#name').classList.add('invalid');
    $('[data-for="name"]').textContent = 'Введите имя';
    ok = false;
  }
  const phoneClean = phone.replace(/[^\d+]/g,'');
  if (phoneClean.length < 9) {
    $('#phone').classList.add('invalid');
    $('[data-for="phone"]').textContent = 'Введите корректный номер';
    ok = false;
  }
  if (!date) {
    $('#date').classList.add('invalid');
    $('[data-for="date"]').textContent = 'Выберите дату';
    ok = false;
  } else {
    const today = new Date(); today.setHours(0,0,0,0);
    const picked = new Date(date);
    if (picked < today) {
      $('#date').classList.add('invalid');
      $('[data-for="date"]').textContent = 'Дата не может быть в прошлом';
      ok = false;
    } else {
      const day = picked.getDay(); // 0=Sun,5=Fri,6=Sat
      if (![0,5,6].includes(day)) {
        $('#date').classList.add('invalid');
        $('[data-for="date"]').textContent = 'Только Пт, Сб, Вс';
        ok = false;
      }
    }
  }

  // Проверка свободных мест на выбранную дату+смену
  if (ok && date) {
    const seats = +$('#seats').value || 1;
    const free = SEATS_TOTAL - getBookedSeats(date, $('#time').value);
    if (seats > free) {
      $('#date').classList.add('invalid');
      $('[data-for="date"]').textContent = free > 0
        ? `Осталось только ${free} мест на эту смену`
        : 'Мест на эту смену нет — выберите другой день';
      ok = false;
    }
  }
  return ok;
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  if (!validateBookingForm()) return;

  const submitBtn = $('#submit-btn');
  const spinner = submitBtn.querySelector('.btn-spinner');
  const text = submitBtn.querySelector('.btn-text');
  submitBtn.disabled = true;
  spinner.hidden = false;
  text.textContent = 'Отправляем...';

  const user = getCurrentUser();
  const cfg = getConfig();
  const seats = +$('#seats').value || 1;
  const booking = {
    id: uid('BK'),
    userId: user?.id || null,
    name: $('#name').value.trim(),
    phone: $('#phone').value.trim(),
    email: user?.email || '',
    date: $('#date').value,
    time: $('#time').value,
    seats,
    comment: $('#comment').value.trim(),
    total: seats * cfg.PRICE_PER_PERSON,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  // Save locally first (so admin always sees it)
  const list = store.get(K.BOOKINGS, []);
  list.push(booking);
  store.set(K.BOOKINGS, list);
  _lastBooking = booking;

  // Доставка в Telegram: сначала безопасный воркер (для всех посетителей),
  // затем — прямой токен из localStorage (если админ настроил на своём устройстве)
  let tgOk = false;
  try {
    tgOk = await sendBookingViaProxy(booking);
    if (!tgOk) tgOk = await sendBookingToTelegram(booking);
  } catch (err) {
    console.warn('Telegram send failed', err);
  }

  submitBtn.disabled = false;
  spinner.hidden = true;
  text.textContent = 'Отправить заявку';

  // Success UI
  $('#booking-form').hidden = true;
  $('#booking-id-show').textContent = booking.id;
  $('#success-block').hidden = false;
  updateAvailability();

  if (tgOk) {
    toast('Заявка отправлена в Telegram ✅', 'success');
  } else {
    // Telegram не настроен или не доставлено — открываем WhatsApp координатора
    toast('Открываем WhatsApp координатора — отправьте сообщение 👉', 'info', 5500);
    sendBookingToWhatsApp(booking);
  }
}

function resetForm() {
  $('#booking-form').hidden = false;
  $('#success-block').hidden = true;
  $('#booking-form').reset();
  recalcPrice();
}

/* Безопасная отправка в Telegram через серверный посредник.
   Токен на стороне сервера — работает для всех посетителей.
   Google Apps Script не отдаёт CORS-заголовки, поэтому шлём в режиме
   no-cors с типом text/plain (тело — JSON-строка). Ответ при этом
   «непрозрачный» — если запрос ушёл без сетевой ошибки, считаем успехом
   (заявка также сохраняется локально, а WhatsApp остаётся как резерв). */
async function sendBookingViaProxy(b) {
  if (!TELEGRAM_PROXY_URL) return false;
  try {
    await fetch(TELEGRAM_PROXY_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(b)
    });
    return true;
  } catch (err) {
    console.warn('Proxy send failed', err);
    return false;
  }
}

/* Определяет Chat ID из последнего сообщения боту (нужен один /start).
   Возвращает строку chat_id или '' если бот ещё не получал сообщений. */
async function resolveChatId(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates`);
    const data = await res.json();
    if (!data.ok || !data.result?.length) return '';
    // Берём chat последнего сообщения
    for (let i = data.result.length - 1; i >= 0; i--) {
      const msg = data.result[i].message || data.result[i].my_chat_member;
      const id = msg?.chat?.id;
      if (id != null) return String(id);
    }
    return '';
  } catch { return ''; }
}

async function sendBookingToTelegram(b) {
  const cfg = getConfig();
  const tok = cfg.TELEGRAM_BOT_TOKEN;
  let chat = cfg.TELEGRAM_CHAT_ID;
  if (!tok) return false;
  // Авто-определение Chat ID, если ещё не задан
  if (!chat) {
    chat = await resolveChatId(tok);
    if (chat) setConfig({ TELEGRAM_CHAT_ID: chat });
    else return false;
  }

  const lines = [
    '🏔 *НОВАЯ ЗАЯВКА — Ала-Арча Экспресс*',
    '',
    `🆔 *№:* \`${b.id}\``,
    `👤 *Имя:* ${b.name}`,
    `📱 *Телефон:* ${b.phone}`,
    b.email ? `✉️ *E-mail:* ${b.email}` : null,
    `📅 *Дата:* ${fmtDate(b.date)}`,
    `🕐 *Смена:* ${b.time === 'evening' ? '🌅 Вечер (16:00–21:00)' : '☀️ Утро (10:00–15:00)'}`,
    `👥 *Мест:* ${b.seats}`,
    `💵 *Сумма:* ${b.total.toLocaleString('ru-RU')} сом`,
    b.comment ? `💬 *Комментарий:* ${b.comment}` : null,
    '',
    `_Отправлено: ${fmtDateTime(b.createdAt)}_`
  ].filter(Boolean).join('\n');

  const url = `https://api.telegram.org/bot${encodeURIComponent(tok)}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text: lines,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    })
  });
  const data = await res.json().catch(() => ({}));
  return res.ok && data.ok;
}

/* =================================================================
   ADMIN PANEL
   ================================================================= */
function openAdmin() {
  const u = getCurrentUser();
  if (!u || u.role !== 'admin') return toast('Доступ только для администратора', 'error');
  renderAdminBookings();
  renderAdminStats();
  renderAdminUsers();
  loadTelegramSettings();
  openModal('admin-modal');
  $('#user-area')?.classList.remove('open');
}

function switchAdminTab(id) {
  $$('#admin-modal .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  ['adm-bookings','adm-stats','adm-users','adm-settings'].forEach(t => {
    $('#'+t).classList.toggle('hidden', t !== id);
  });
}

function renderAdminBookings() {
  const search = $('#admin-search').value.trim().toLowerCase();
  const filter = $('#admin-filter').value;
  const all = store.get(K.BOOKINGS, [])
    .sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const filtered = all.filter(b => {
    if (filter !== 'all' && b.status !== filter) return false;
    if (search && !(`${b.name} ${b.phone}`.toLowerCase().includes(search))) return false;
    return true;
  });
  const list = $('#admin-bookings');
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">Заявок нет.</div>`;
    return;
  }
  list.innerHTML = filtered.map(b => `
    <div class="admin-card">
      <div class="ac-main">
        <div class="ac-row">
          <span class="ac-name">${escapeHtml(b.name)}</span>
          <span class="status-chip status-${b.status}">${statusLabel(b.status)}</span>
          <span class="ac-id">${escapeHtml(b.id)}</span>
        </div>
        <div class="ac-row ac-meta">
          <span>📅 ${fmtDate(b.date)}</span>
          <span>${b.time === 'evening' ? '🌅 Вечер' : '☀️ Утро'}</span>
          <span>👥 ${b.seats} мест</span>
          <span>💵 ${b.total} сом</span>
        </div>
        <div class="ac-row ac-meta">
          <a href="tel:${escapeHtml(b.phone)}">📱 ${escapeHtml(b.phone)}</a>
          <a href="https://wa.me/${b.phone.replace(/\D/g,'')}" target="_blank" rel="noopener">WhatsApp →</a>
          ${b.comment ? `<span>💬 ${escapeHtml(b.comment)}</span>` : ''}
        </div>
      </div>
      <div class="ac-actions">
        ${b.status !== 'confirmed' ? `<button class="action-btn success" onclick="setBookingStatus('${b.id}','confirmed')">✓ Подтвердить</button>` : ''}
        ${b.status !== 'completed' ? `<button class="action-btn" onclick="setBookingStatus('${b.id}','completed')">Завершить</button>` : ''}
        ${b.status !== 'cancelled' ? `<button class="action-btn danger" onclick="setBookingStatus('${b.id}','cancelled')">✕ Отменить</button>` : ''}
        <button class="action-btn danger" onclick="deleteBooking('${b.id}')">🗑</button>
      </div>
    </div>`).join('');
}

function setBookingStatus(id, status) {
  const list = store.get(K.BOOKINGS, []);
  const i = list.findIndex(b => b.id === id);
  if (i < 0) return;
  list[i].status = status;
  list[i].updatedAt = new Date().toISOString();
  store.set(K.BOOKINGS, list);
  renderAdminBookings();
  renderAdminStats();
  toast('Статус обновлён: ' + statusLabel(status), 'success');
}

function deleteBooking(id) {
  if (!confirm('Удалить заявку безвозвратно?')) return;
  const list = store.get(K.BOOKINGS, []).filter(b => b.id !== id);
  store.set(K.BOOKINGS, list);
  renderAdminBookings();
  renderAdminStats();
  toast('Заявка удалена');
}

function renderAdminStats() {
  const all = store.get(K.BOOKINGS, []);
  $('#st-total').textContent = all.length;
  $('#st-pending').textContent = all.filter(b => b.status === 'pending').length;
  $('#st-confirmed').textContent = all.filter(b => b.status === 'confirmed').length;
  const revenue = all
    .filter(b => b.status === 'confirmed' || b.status === 'completed')
    .reduce((s,b) => s + (b.total || 0), 0);
  $('#st-revenue').textContent = revenue.toLocaleString('ru-RU');

  // Bar chart: last 7 days
  const bars = $('#chart-bars');
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0,10);
    const count = all.filter(b => (b.createdAt || '').slice(0,10) === iso).length;
    days.push({ iso, count, label: d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit' }) });
  }
  const max = Math.max(1, ...days.map(d => d.count));
  bars.innerHTML = days.map(d => {
    const h = Math.max(4, (d.count / max) * 160);
    return `<div class="bar" style="height:${h}px">
      ${d.count > 0 ? `<span class="bar-val">${d.count}</span>` : ''}
      <span class="bar-label">${d.label}</span>
    </div>`;
  }).join('');
}

function renderAdminUsers() {
  const users = store.get(K.USERS, []);
  const wrap = $('#admin-users');
  if (!users.length) { wrap.innerHTML = '<div class="empty-state">Пользователей нет</div>'; return; }
  wrap.innerHTML = users.map(u => `
    <div class="admin-card">
      <div class="ac-main">
        <div class="ac-row">
          <span class="ac-name">${escapeHtml(u.name || u.login)}</span>
          <span class="status-chip status-${u.role === 'admin' ? 'confirmed' : 'completed'}">${u.role === 'admin' ? 'Админ' : 'Пользователь'}</span>
        </div>
        <div class="ac-row ac-meta">
          <span>✉️ ${escapeHtml(u.email)}</span>
          ${u.phone ? `<span>📱 ${escapeHtml(u.phone)}</span>` : ''}
          <span>📅 ${fmtDate(u.createdAt)}</span>
        </div>
      </div>
      <div class="ac-actions">
        ${u.login !== 'admin' ? `<button class="action-btn danger" onclick="deleteUser('${u.id}')">🗑 Удалить</button>` : ''}
      </div>
    </div>`).join('');
}

function deleteUser(id) {
  if (!confirm('Удалить пользователя?')) return;
  const users = store.get(K.USERS, []).filter(u => u.id !== id);
  store.set(K.USERS, users);
  if (store.get(K.CURRENT) === id) setCurrentUser(null);
  renderAdminUsers();
  toast('Пользователь удалён');
}

function exportCsv() {
  const all = store.get(K.BOOKINGS, []);
  if (!all.length) return toast('Нет данных для экспорта', 'warning');
  const rows = [
    ['ID','Имя','Телефон','E-mail','Дата','Смена','Мест','Сумма','Статус','Комментарий','Создано']
  ];
  all.forEach(b => rows.push([
    b.id, b.name, b.phone, b.email || '',
    b.date, b.time === 'evening' ? 'Вечер' : 'Утро',
    b.seats, b.total, statusLabel(b.status), b.comment || '', b.createdAt
  ]));
  const csv = '\uFEFF' + rows.map(r =>
    r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bookings-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('CSV экспортирован', 'success');
}

/* =================================================================
   TELEGRAM SETTINGS
   ================================================================= */
function loadTelegramSettings() {
  const c = getConfig();
  $('#tg-token').value = c.TELEGRAM_BOT_TOKEN || '';
  $('#tg-chat').value  = c.TELEGRAM_CHAT_ID || '';
  $('#tg-price').value = c.PRICE_PER_PERSON || 2000;
}
function saveTelegramSettings() {
  setConfig({
    TELEGRAM_BOT_TOKEN: $('#tg-token').value.trim(),
    TELEGRAM_CHAT_ID:   $('#tg-chat').value.trim(),
    PRICE_PER_PERSON:   +$('#tg-price').value || 2000
  });
  recalcPrice();
  toast('Настройки сохранены', 'success');
}
async function testTelegram() {
  const status = $('#tg-status');
  status.classList.remove('show','ok','err');
  status.textContent = 'Отправка тестового сообщения...';
  status.classList.add('show');
  try {
    const ok = await sendBookingToTelegram({
      id: 'TEST-' + Date.now().toString(36).toUpperCase(),
      name: 'Тестовый клиент', phone: '+996 700 000 000',
      date: new Date().toISOString().slice(0,10),
      time: 'morning', seats: 2,
      total: 4000, comment: 'Это тестовая заявка из админ-панели',
      createdAt: new Date().toISOString()
    });
    if (ok) {
      status.classList.add('ok');
      status.textContent = '✅ Готово! Сообщение отправлено в Telegram.';
    } else {
      status.classList.add('err');
      status.textContent = '❌ Не отправлено. Проверьте Token и Chat ID.';
    }
  } catch (e) {
    status.classList.add('err');
    status.textContent = '❌ Ошибка: ' + (e.message || 'сеть недоступна');
  }
}

/* =================================================================
   REVIEWS
   ================================================================= */
const DEFAULT_REVIEWS = [
  { id: uid('RV'), name: 'Айгуль', rating: 5, text: 'Невероятно удобно! Не нужно было ни о чём думать — приехали, всё включено, координатор всё рассказал. Виды просто космос!', date: '2026-05-12' },
  { id: uid('RV'), name: 'Бакыт', rating: 5, text: 'Брал на семью из 4 человек. Дети в восторге от фуникулёра, родители — от того, что не пришлось стоять в очередях. Спасибо!', date: '2026-04-28' },
  { id: uid('RV'), name: 'Marina', rating: 4, text: 'Очень классный сервис. Автобус чистый, поездка комфортная. Единственное — хотелось бы чуть больше времени наверху.', date: '2026-04-15' }
];
function getReviews() {
  let r = store.get(K.REVIEWS);
  if (!Array.isArray(r) || !r.length) {
    store.set(K.REVIEWS, DEFAULT_REVIEWS);
    return DEFAULT_REVIEWS;
  }
  return r;
}
function renderReviews() {
  const wrap = $('#reviews-grid');
  const list = getReviews();
  wrap.innerHTML = list.map(r => `
    <div class="review-card fade-up visible">
      <div class="review-head">
        <div class="review-avatar">${escapeHtml((r.name||'A').slice(0,1).toUpperCase())}</div>
        <div>
          <div class="review-name">${escapeHtml(r.name)}</div>
          <div class="review-date">${fmtDate(r.date)}</div>
        </div>
      </div>
      <div class="review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
      <div class="review-text">${escapeHtml(r.text)}</div>
    </div>`).join('');
}

let _reviewRating = 5;
function openReviewModal() {
  _reviewRating = 5;
  updateRatingUI();
  openModal('review-modal');
}
function updateRatingUI() {
  $$('#rating-input button').forEach(b => {
    b.classList.toggle('active', +b.dataset.rate <= _reviewRating);
  });
}
function handleReviewSubmit(e) {
  e.preventDefault();
  const name = $('#rev-name').value.trim();
  const text = $('#rev-text').value.trim();
  if (!name || text.length < 5) return toast('Заполните имя и текст отзыва', 'warning');
  const list = getReviews();
  list.unshift({
    id: uid('RV'), name, rating: _reviewRating, text,
    date: new Date().toISOString().slice(0,10)
  });
  store.set(K.REVIEWS, list);
  renderReviews();
  closeModal('review-modal');
  $('#review-form').reset();
  toast('Спасибо за отзыв!', 'success');
}

/* =================================================================
   GALLERY / LIGHTBOX
   ================================================================= */
function initGallery() {
  $$('.gallery-item').forEach(el => {
    el.style.setProperty('--bg-image', `url("${el.dataset.img}")`);
    el.style.backgroundImage = `url("${el.dataset.img}")`;
  });
}
let _lbIndex = 0;
function openLightbox(i) {
  _lbIndex = i;
  showLightboxImg();
  $('#lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
}
function showLightboxImg() {
  const items = $$('.gallery-item');
  if (!items.length) return;
  if (_lbIndex < 0) _lbIndex = items.length - 1;
  if (_lbIndex >= items.length) _lbIndex = 0;
  $('#lightbox-img').src = items[_lbIndex].dataset.img;
}
function lightboxStep(d, e) {
  if (e) e.stopPropagation();
  _lbIndex += d;
  showLightboxImg();
}
function closeLightbox(e) {
  const t = e && e.target;
  if (t && t.classList && (t.classList.contains('lightbox-prev') || t.classList.contains('lightbox-next'))) return;
  if (t && t.tagName === 'IMG') return;
  $('#lightbox').hidden = true;
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => {
  if ($('#lightbox')?.hidden === false) {
    if (e.key === 'Escape') closeLightbox({});
    if (e.key === 'ArrowLeft') lightboxStep(-1);
    if (e.key === 'ArrowRight') lightboxStep(1);
  }
  if (e.key === 'Escape') {
    $$('.modal:not([hidden])').forEach(m => m.hidden = true);
    document.body.style.overflow = '';
  }
});

/* =================================================================
   MODAL HELPERS
   ================================================================= */
function openModal(id) {
  $('#' + id).hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  $('#' + id).hidden = true;
  document.body.style.overflow = '';
}

/* =================================================================
   ANIMATIONS
   ================================================================= */
function initFadeUp() {
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  $$('.fade-up').forEach(el => observer.observe(el));
}

function animateCount(el, target, duration = 1400) {
  const start = performance.now();
  const initial = +el.textContent.replace(/\D/g,'') || 0;
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(initial + (target - initial) * eased).toLocaleString('ru-RU');
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function initCounters() {
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = +entry.target.dataset.count || 0;
        animateCount(entry.target, target);
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });
  $$('[data-count]').forEach(el => observer.observe(el));
}

function initRipple() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('.btn-primary, .btn-submit, .btn-book');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const r = document.createElement('span');
    r.className = 'ripple';
    const size = Math.max(rect.width, rect.height);
    r.style.width = r.style.height = size + 'px';
    r.style.left = (e.clientX - rect.left - size/2) + 'px';
    r.style.top  = (e.clientY - rect.top - size/2) + 'px';
    btn.appendChild(r);
    setTimeout(() => r.remove(), 600);
  });
}

function initParallax() {
  const layers = $$('.hero-mountains .m-far, .hero-mountains .m-mid, .hero-mountains .m-near');
  if (!layers.length) return;
  let ticking = false;
  const speeds = [0.08, 0.16, 0.28];
  window.addEventListener('scroll', () => {
    if (ticking) return;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      layers.forEach((el, i) => {
        el.style.transform = `translateY(${y * speeds[i]}px)`;
      });
      ticking = false;
    });
    ticking = true;
  });
}

function initHeaderScroll() {
  const h = $('#site-header');
  if (!h) return;
  const onScroll = () => {
    h.classList.toggle('scrolled', window.scrollY > 30);
    const fab = $('#btn-fab');
    if (fab) fab.hidden = window.scrollY < 300;
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* =================================================================
   DATE PICKER MIN
   ================================================================= */
function initDateInput() {
  const d = $('#date');
  if (!d) return;
  const today = new Date();
  d.min = today.toISOString().slice(0,10);
}

function initScrollProgress() {
  const bar = $('#scroll-progress');
  if (!bar) return;
  const update = () => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    const pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
    bar.style.width = pct + '%';
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}

/* =================================================================
   INIT
   ================================================================= */
async function init() {
  // Year
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  initTheme();
  await ensureAdminUser();
  renderHeaderAuth();
  initFadeUp();
  initCounters();
  initRipple();
  initParallax();
  initHeaderScroll();
  initDateInput();
  initScrollProgress();
  initGallery();
  renderReviews();
  recalcPrice();

  // Form bindings
  $('#booking-form')?.addEventListener('submit', handleBookingSubmit);
  $('#seats')?.addEventListener('change', recalcPrice);
  $('#date')?.addEventListener('change', updateAvailability);
  $('#time')?.addEventListener('change', updateAvailability);
  $('#login-form')?.addEventListener('submit', handleLogin);
  $('#register-form')?.addEventListener('submit', handleRegister);
  $('#review-form')?.addEventListener('submit', handleReviewSubmit);

  // Admin filters
  $('#admin-search')?.addEventListener('input', renderAdminBookings);
  $('#admin-filter')?.addEventListener('change', renderAdminBookings);

  // Rating buttons
  $$('#rating-input button').forEach(b => {
    b.addEventListener('click', () => {
      _reviewRating = +b.dataset.rate;
      updateRatingUI();
    });
  });

  // Expose for inline onclick
  Object.assign(window, {
    goTo, toggleFaq, openAuthModal, switchAuthTab, switchAdminTab,
    toggleUserMenu, openProfile, openAdmin, logout, closeModal,
    resetForm, cancelMyBooking, setBookingStatus, deleteBooking,
    deleteUser, exportCsv, saveTelegramSettings, testTelegram,
    openReviewModal, openLightbox, lightboxStep, closeLightbox,
    toggleMobileMenu, resendLastWhatsApp
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
