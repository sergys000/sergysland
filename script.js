// SergysLand — магазин и оплата по банковским реквизитам
const SERVER_IP = "sergysland.duckdns.org";

const PAYMENT_DETAILS = {
    recipient: "МОРДОВЕЦ ТАТЬЯНА",
    bank: "СБЕР-БАНК",
    card: "2202 2084 0285 9178",
    phone: "+7 (995)464-67-08",
    note: "В назначении платежа укажите привелегию и ваш ник."
};

const PRODUCTS = {
    VIP: {
        month: { price: 50, label: "VIP • 1 месяц", command: "lp user {player} parent set vip" }
    },
    PREMIUM: {
        month: { price: 100, label: "PREMIUM • 1 месяц", command: "lp user {player} parent set premium" }
    },
    DELUXE: {
        month: { price: 250, label: "DELUXE • 1 месяц", command: "lp user {player} parent set deluxe" },
        forever: { price: 350, label: "DELUXE • навсегда", command: "lp user {player} parent set deluxe" }
    },
    PRIME: {
        month: { price: 388, label: "PRIME • 1 месяц", command: "lp user {player} parent set prime" },
        forever: { price: 500, label: "PRIME • навсегда", command: "lp user {player} parent set prime" }
    },
    STORM: {
        month: { price: 800, label: "STORM • 1 месяц", command: "lp user {player} parent set storm" },
        forever: { price: 909, label: "STORM • навсегда", command: "lp user {player} parent set storm" }
    },
    GOD: {
        month: { price: 900, label: "GOD • 1 месяц", command: "lp user {player} parent set god" },
        forever: { price: 1200, label: "GOD • навсегда", command: "lp user {player} parent set god" }
    }
};

document.addEventListener("DOMContentLoaded", () => {
    const ipElement = document.getElementById("serverIp");
    if (ipElement) ipElement.textContent = SERVER_IP;
    loadServerStatus();
    setInterval(loadServerStatus, 60000);
});

function buy(rank, period = "month") {
    const product = PRODUCTS[rank]?.[period];
    if (!product) {
        showToast("Этот вариант покупки пока не настроен");
        return;
    }

    const old = document.getElementById("shopModal");
    if (old) old.remove();

    const order = "SL-" + Date.now().toString().slice(-8);
    const modal = document.createElement("div");
    modal.id = "shopModal";
    modal.innerHTML = `
      <div class="shop-backdrop" onclick="closeShopModal(event)"></div>
      <div class="shop-modal" role="dialog" aria-modal="true">
        <button class="shop-close" onclick="closeShopModal()">×</button>
        <div class="shop-step">ЗАКАЗ ${order}</div>
        <h2>Покупка ${escapeHtml(rank)}</h2>
        <p class="shop-muted">Вы выбрали: <b>${escapeHtml(product.label)}</b>. Введите Minecraft-ник, переведите указанную сумму и сохраните номер заказа.</p>
        <label class="shop-label">Minecraft-ник</label>
        <input id="shopPlayer" class="shop-input" maxlength="16" placeholder="Например: sergys000" autocomplete="off">
        <div class="shop-price">${product.price} ₽ <small>${period === "forever" ? "навсегда" : "за месяц"}</small></div>
        <div class="requisites">
          <div><span>Получатель</span><b>${escapeHtml(PAYMENT_DETAILS.recipient)}</b></div>
          <div><span>Банк</span><b>${escapeHtml(PAYMENT_DETAILS.bank)}</b></div>
          <div><span>Карта</span><b>${escapeHtml(PAYMENT_DETAILS.card)}</b></div>
          <div><span>Телефон</span><b>${escapeHtml(PAYMENT_DETAILS.phone)}</b></div>
        </div>
        <p class="shop-note">${escapeHtml(PAYMENT_DETAILS.note)}</p>
        <button class="primary shop-copy" onclick="copyOrderData('${order}', '${rank}', '${period}', ${product.price})">⧉ СКОПИРОВАТЬ ДАННЫЕ ЗАКАЗА</button>
        <button class="shop-paid" onclick="markPaid('${order}', '${rank}', '${period}', ${product.price})">Я ОПЛАТИЛ</button>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById("shopPlayer").focus();
}

function closeShopModal(event) {
    if (!event || event.target.classList.contains("shop-backdrop")) {
        const modal = document.getElementById("shopModal");
        if (modal) modal.remove();
    }
}

async function copyOrderData(order, rank, period, price) {
    const player = document.getElementById("shopPlayer")?.value.trim() || "НЕ УКАЗАН";
    const duration = period === "forever" ? "Навсегда" : "1 месяц";
    const text = `SergysLand
Заказ: ${order}
Товар: ${rank}
Срок: ${duration}
Minecraft-ник: ${player}
Сумма: ${price} ₽
Получатель: ${PAYMENT_DETAILS.recipient}
Банк: ${PAYMENT_DETAILS.bank}
Карта: ${PAYMENT_DETAILS.card}
Телефон: ${PAYMENT_DETAILS.phone}
${PAYMENT_DETAILS.note}`;
    try { await navigator.clipboard.writeText(text); showToast("Данные заказа скопированы"); }
    catch { showToast("Не удалось скопировать — перепишите реквизиты вручную"); }
}

function markPaid(order, rank, period, price) {
    const player = document.getElementById("shopPlayer")?.value.trim();
    if (!player || !/^[A-Za-z0-9_]{3,16}$/.test(player)) {
        showToast("Введите корректный Minecraft-ник");
        return;
    }
    localStorage.setItem("sergysland_last_order", JSON.stringify({
        order, rank, period, price, player, createdAt: new Date().toISOString()
    }));
    closeShopModal();
    showToast(`Заказ ${order} сохранён. Передайте номер для проверки оплаты.`);
}


function buyProduct(product, category, price) {
    const old = document.getElementById("shopModal");
    if (old) old.remove();

    const order = "SL-" + Date.now().toString().slice(-8);
    const modal = document.createElement("div");
    modal.id = "shopModal";
    modal.innerHTML = `
      <div class="shop-backdrop" onclick="closeShopModal(event)"></div>
      <div class="shop-modal" role="dialog" aria-modal="true">
        <button class="shop-close" onclick="closeShopModal()">×</button>
        <div class="shop-step">ЗАКАЗ ${order}</div>
        <h2>${escapeHtml(product)}</h2>
        <p class="shop-muted">Категория: <b>${escapeHtml(category)}</b></p>
        <label class="shop-label">Minecraft-ник</label>
        <input id="shopPlayer" class="shop-input" maxlength="16" placeholder="Например: sergys000" autocomplete="off">
        <div class="shop-price">${escapeHtml(price)} ₽</div>
        <div class="requisites">
          <div><span>Получатель</span><b>${escapeHtml(PAYMENT_DETAILS.recipient)}</b></div>
          <div><span>Банк</span><b>${escapeHtml(PAYMENT_DETAILS.bank)}</b></div>
          <div><span>Карта</span><b>${escapeHtml(PAYMENT_DETAILS.card)}</b></div>
          <div><span>Телефон</span><b>${escapeHtml(PAYMENT_DETAILS.phone)}</b></div>
        </div>
        <p class="shop-note">${escapeHtml(PAYMENT_DETAILS.note)}</p>
        <button class="primary shop-copy" onclick="copyProductOrder('${order}', '${escapeJs(product)}', '${escapeJs(category)}', '${escapeJs(price)}')">⧉ СКОПИРОВАТЬ ДАННЫЕ ЗАКАЗА</button>
        <button class="shop-paid" onclick="markProductPaid('${order}', '${escapeJs(product)}', '${escapeJs(category)}', '${escapeJs(price)}')">Я ОПЛАТИЛ</button>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById("shopPlayer").focus();
}

function escapeJs(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function copyProductOrder(order, product, category, price) {
    const player = document.getElementById("shopPlayer")?.value.trim() || "НЕ УКАЗАН";
    const text = `SergysLand
Заказ: ${order}
Категория: ${category}
Товар: ${product}
Minecraft-ник: ${player}
Сумма: ${price} ₽
Получатель: ${PAYMENT_DETAILS.recipient}
Банк: ${PAYMENT_DETAILS.bank}
Карта: ${PAYMENT_DETAILS.card}
Телефон: ${PAYMENT_DETAILS.phone}
${PAYMENT_DETAILS.note}`;
    try {
        await navigator.clipboard.writeText(text);
        showToast("Данные заказа скопированы");
    } catch {
        showToast("Не удалось скопировать — перепишите реквизиты вручную");
    }
}

function markProductPaid(order, product, category, price) {
    const player = document.getElementById("shopPlayer")?.value.trim();
    if (!player || !/^[A-Za-z0-9_]{3,16}$/.test(player)) {
        showToast("Введите корректный Minecraft-ник");
        return;
    }
    localStorage.setItem("sergysland_last_order", JSON.stringify({
        order, product, category, price, player, createdAt: new Date().toISOString()
    }));
    closeShopModal();
    showToast(`Заказ ${order} сохранён. Передайте номер для проверки оплаты.`);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
        "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
    }[ch]));
}

function copyIP() { copyServerIp(); }

async function copyServerIp() {
    try { await navigator.clipboard.writeText(SERVER_IP); showToast("IP сервера скопирован: " + SERVER_IP); }
    catch { showToast("IP: " + SERVER_IP); }
}

function showToast(message) {
    let toast = document.getElementById("sergysToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "sergysToast";
        toast.style.cssText = "position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:99999;padding:12px 20px;border-radius:10px;background:rgba(20,20,30,.95);color:#fff;font-size:14px;box-shadow:0 0 20px rgba(160,80,255,.35)";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = "block";
    clearTimeout(window.sergysToastTimer);
    window.sergysToastTimer = setTimeout(() => toast.style.display = "none", 3000);
}

async function loadServerStatus() {
    const statusElement = document.querySelector(".server-status");
    const onlineElement = document.getElementById("online");
    try {
        const response = await fetch("https://api.mcsrvstat.us/3/" + encodeURIComponent(SERVER_IP), { cache: "no-store" });
        if (!response.ok) throw new Error("Status API error");
        const data = await response.json();

        if (data.online) {
            statusElement?.classList.remove("offline");
            statusElement?.classList.add("online");
            if (onlineElement) {
                const players = data.players?.online ?? 0;
                const maxPlayers = data.players?.max ?? 0;
                onlineElement.textContent = `${players}/${maxPlayers}`;
            }
        } else {
            statusElement?.classList.remove("online");
            statusElement?.classList.add("offline");
            if (onlineElement) onlineElement.textContent = "ОФЛАЙН";
        }
    } catch {
        statusElement?.classList.remove("online");
        statusElement?.classList.add("offline");
        if (onlineElement) onlineElement.textContent = "—";
    }
}
