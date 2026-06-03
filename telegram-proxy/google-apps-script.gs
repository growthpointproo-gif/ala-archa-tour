/* =================================================================
   Google Apps Script — безопасный приём заявок и отправка в Telegram
   (самый лёгкий бесплатный вариант, без установки программ)

   Токен и Chat ID хранятся ЗДЕСЬ, на серверах Google, и НЕ попадают
   в код сайта. Сайт шлёт сюда заявку, скрипт пересылает её в Telegram.

   КАК ВКЛЮЧИТЬ (5 минут, всё в браузере):
   1. Откройте https://script.google.com  →  «Новый проект».
   2. Удалите весь код в редакторе и вставьте ВЕСЬ этот файл.
   3. Впишите свои значения ниже (TOKEN и CHAT_ID).
   4. Нажмите «Развернуть» (Deploy) → «Новое развёртывание»
      → тип «Веб-приложение» (Web app):
         • Запуск от имени: Я (Me)
         • Доступ: Все (Anyone)
      → «Развернуть» → разрешите доступ для своего Google-аккаунта.
   5. Скопируйте «URL веб-приложения» и пришлите его мне —
      я вставлю его в сайт и переопубликую.
   ================================================================= */

// ВСТАВЬТЕ ВАШИ ЗНАЧЕНИЯ (они остаются только здесь, на серверах Google):
var TELEGRAM_BOT_TOKEN = 'ВСТАВЬТЕ_ТОКЕН_СЮДА';
var TELEGRAM_CHAT_ID   = 'ВСТАВЬТЕ_CHAT_ID_СЮДА';

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents);
    if (!b || !b.name || !b.phone) {
      return _json({ ok: false, error: 'Missing fields' });
    }
    UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: buildText(b),
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return ContentService.createTextOutput('Telegram relay OK');
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function fmtDate(iso) {
  try {
    return Utilities.formatDate(new Date(iso), 'Asia/Bishkek', 'dd.MM.yyyy');
  } catch (e) { return iso; }
}

function buildText(b) {
  var shift = b.time === 'evening' ? '🌅 Вечер (16:00–21:00)' : '☀️ Утро (10:00–15:00)';
  var lines = [
    '🏔 *НОВАЯ ЗАЯВКА — Ала-Арча Экспресс*',
    '',
    b.id ? ('🆔 *№:* `' + b.id + '`') : '',
    '👤 *Имя:* ' + (b.name || '—'),
    '📱 *Телефон:* ' + (b.phone || '—'),
    b.email ? ('✉️ *E-mail:* ' + b.email) : '',
    '📅 *Дата:* ' + fmtDate(b.date),
    '🕐 *Смена:* ' + shift,
    '👥 *Мест:* ' + (b.seats || 1),
    b.total ? ('💵 *Сумма:* ' + Number(b.total).toLocaleString('ru-RU') + ' сом') : '',
    b.comment ? ('💬 *Комментарий:* ' + b.comment) : ''
  ];
  return lines.filter(function (x) { return x; }).join('\n');
}
