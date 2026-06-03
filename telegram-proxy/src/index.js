/* =================================================================
   Cloudflare Worker — безопасный посредник для Telegram
   Токен (TELEGRAM_BOT_TOKEN) и Chat ID (TELEGRAM_CHAT_ID) хранятся
   как секреты Cloudflare и НИКОГДА не попадают в код сайта.
   Сайт шлёт сюда POST с данными брони, воркер пересылает их в Telegram.
   ================================================================= */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return iso; }
}

function buildText(b) {
  const shift = b.time === 'evening' ? '🌅 Вечер (16:00–21:00)' : '☀️ Утро (10:00–15:00)';
  return [
    '🏔 *НОВАЯ ЗАЯВКА — Ала-Арча Экспресс*',
    '',
    b.id ? `🆔 *№:* \`${b.id}\`` : null,
    `👤 *Имя:* ${b.name || '—'}`,
    `📱 *Телефон:* ${b.phone || '—'}`,
    b.email ? `✉️ *E-mail:* ${b.email}` : null,
    `📅 *Дата:* ${fmtDate(b.date)}`,
    `🕐 *Смена:* ${shift}`,
    `👥 *Мест:* ${b.seats || 1}`,
    b.total ? `💵 *Сумма:* ${Number(b.total).toLocaleString('ru-RU')} сом` : null,
    b.comment ? `💬 *Комментарий:* ${b.comment}` : null
  ].filter(Boolean).join('\n');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ ok: true, msg: 'Telegram proxy is running' });

    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      return json({ ok: false, error: 'Secrets not configured' }, 500);
    }

    let b;
    try { b = await request.json(); }
    catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    // Минимальная защита от мусора
    if (!b || !b.name || !b.phone) {
      return json({ ok: false, error: 'Missing fields' }, 400);
    }

    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const tgRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: buildText(b),
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
    const tg = await tgRes.json().catch(() => ({}));
    return json({ ok: tgRes.ok && tg.ok });
  }
};
