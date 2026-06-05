const socket = io();

// STATE
let currentUser = null;
let currentChannelId = 'global';
let isRegisterMode = false;
let contextMenu = null;
let replyToMessage = null;
let editingMessageId = null;
let typingTimeout = null;

const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2346/2346-preview.mp3');
notificationSound.volume = 0.5;

// DOM
const els = {
    login: document.getElementById('login-screen'),
    userInput: document.getElementById('username-input'),
    passInput: document.getElementById('password-input'),
    error: document.getElementById('error-msg'),
    authTitle: document.getElementById('auth-title'),
    submitBtn: document.getElementById('submit-btn'),
    toggleText: document.getElementById('toggle-text'),
    
    myUser: document.getElementById('my-username'),
    myBal: document.getElementById('my-balance'),
    myAv: document.getElementById('my-avatar'),
    adminBtn: document.getElementById('admin-btn'),
    
    chatTitle: document.getElementById('chat-title'),
    online: document.getElementById('online-counter'),
    chanList: document.getElementById('channels-list'),
    msgs: document.getElementById('messages-container'),
    
    input: document.getElementById('message-input'),
    fileInput: document.getElementById('file-input'),
    typing: document.getElementById('typing-indicator'),
    
    replyBar: document.getElementById('reply-bar'),
    replyInfo: document.getElementById('reply-info'),
    
    pinnedBar: document.getElementById('pinned-bar'),
    pinnedText: document.getElementById('pinned-text'),
    
    adminModal: document.getElementById('admin-modal')
};

// --- AUTH ---
function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    els.error.innerText = '';
    els.authTitle.innerText = isRegisterMode ? "Регистрация" : "Вход";
    els.submitBtn.innerText = isRegisterMode ? "Создать" : "Войти";
    els.toggleText.innerText = isRegisterMode ? "Есть аккаунт?" : "Нет аккаунта?";
}

function submitAuth() {
    const u = els.userInput.value.trim();
    const p = els.passInput.value.trim();
    if(!u || !p) return els.error.innerText = "Заполните поля";
    socket.emit('auth', { username: u, password: p, type: isRegisterMode ? 'register' : 'login' });
}

socket.on('auth-error', msg => {
    els.error.innerText = msg;
    setTimeout(() => els.error.innerText = '', 4000);
});

socket.on('error', msg => console.warn('Server error:', msg));

socket.on('login-success', user => {
    currentUser = user;
    els.login.classList.add('hidden');
    updateUI(user);
    if(user.isAdmin) els.adminBtn.classList.remove('hidden');
});

function updateUI(user) {
    els.myUser.innerText = user.username + (user.isAdmin ? ' [A]' : '');
    els.myBal.innerText = `⭐ ${user.stars}`;
    if(user.avatarUrl) {
        els.myAv.innerHTML = `<img src="${user.avatarUrl}" alt="avatar">`;
        els.myAv.style.background = 'transparent';
    } else {
        els.myAv.innerText = user.username[0].toUpperCase();
        els.myAv.style.background = user.color || '#5865F2';
    }
    if(user.isNitro) {
        els.myUser.style.color = '#5865F2';
    } else {
        els.myUser.style.removeProperty('color');
    }
}

socket.on('update-user', u => { currentUser = u; updateUI(u); });
socket.on('update-online', c => { 
    if(els.online) {
        els.online.innerText = `(${c} ${c === 1 ? 'online' : 'online'})`; 
    }
});

// --- CHANNELS ---
function createChannelPrompt() {
    const name = prompt("Название канала:");
    if(name) socket.emit('create-channel', name);
}

socket.on('update-channels', channels => {
    els.chanList.innerHTML = '';
    Object.keys(channels).forEach(id => {
        const c = channels[id];
        const div = document.createElement('div');
        div.className = `chat-item ${id === currentChannelId ? 'active' : ''}`;
        div.onclick = () => switchChannel(id);
        div.innerHTML = `
            <div class="avatar" style="font-size:0.75rem; background:#5865F2;">${c.name[0]}</div>
            <div class="chat-info"><h4>${c.name}</h4></div>
        `;
        els.chanList.appendChild(div);
    });
    if(channels[currentChannelId]) els.chatTitle.innerText = channels[currentChannelId].name;
});

function switchChannel(id) {
    if(id === currentChannelId) return;
    currentChannelId = id;
    els.msgs.innerHTML = '';
    socket.emit('join-channel', id);
}

socket.on('set-active-channel', id => currentChannelId = id);

// --- MESSAGES ---
function sendMessage() {
    const text = els.input.value;
    if(!text.trim()) return;
    
    if(editingMessageId) {
        socket.emit('edit-message', { id: editingMessageId, newText: text });
        cancelReply();
    } else {
        socket.emit('send-message', { text, replyTo: replyToMessage, channelId: currentChannelId });
        cancelReply();
    }
    els.input.value = '';
    socket.emit('typing-stop');
}
els.input.addEventListener('keypress', e => { if(e.key === 'Enter') sendMessage(); });
els.input.addEventListener('input', () => socket.emit('typing'));

socket.on('message', msg => renderMessage(msg));
socket.on('load-messages', msgs => {
    els.msgs.innerHTML = '';
    msgs.forEach(m => renderMessage(m, false));
    scrollToBottom();
});
socket.on('clear-chat', () => els.msgs.innerHTML = '');

function renderMessage(msg, playSound = true) {
    if(!msg || !msg.id) return;
    if(document.getElementById(`msg-${msg.id}`)) return;
    
    const div = document.createElement('div');
    div.id = `msg-${msg.id}`;
    
    if(msg.type === 'system') {
        div.className = 'message system-msg';
        div.innerText = msg.text;
    } else {
        const isMe = currentUser && msg.username === currentUser.username;
        div.className = `message ${isMe ? 'my-msg' : 'other-msg'}`;
        
        div.oncontextmenu = (e) => showCtx(e, msg, isMe, currentUser.isAdmin);

        let replyHtml = msg.replyTo ? `<div class="reply-quote">${escapeHtml(msg.replyTo.username)}: ${escapeHtml(msg.replyTo.text)}</div>` : '';
        let badges = '';
        if(msg.isAdmin) badges += ' <span style="color:#ff7675">[A]</span>';
        if(msg.isNitro) badges += ' <span style="color:#ffeaa7">★</span>';
        
        const userColor = msg.userColor || '#ccc';
        const safeColor = /^#[0-9A-Fa-f]{6}$/.test(userColor) ? userColor : '#ccc';
        
        let content = msg.image 
            ? `<img src="${escapeHtml(msg.image)}" class="chat-image" onclick="window.open(this.src)">` 
            : `<div class="text">${escapeHtml(msg.text)}</div>`;
            
        if(msg.isEdited) content += `<span class="edited-mark">(изм.)</span>`;

        div.innerHTML = `
            <div class="meta"><span style="color:${safeColor}">${escapeHtml(msg.username)}</span>${badges}</div>
            ${replyHtml} ${content}
        `;
        
        if(!isMe && playSound) notificationSound.play().catch(()=>{});
    }
    els.msgs.appendChild(div);
    if(playSound) scrollToBottom();
}

function scrollToBottom() { els.msgs.scrollTop = els.msgs.scrollHeight; }
function escapeHtml(text) { 
    if(!text) return '';
    const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
    return text.replace(/[&<>"']/g, m => map[m]);
}

socket.on('message-updated', d => {
    const el = document.getElementById(`msg-${d.id}`);
    if(el) {
        const textEl = el.querySelector('.text');
        if(textEl) {
            textEl.innerText = d.newText;
            if(!el.querySelector('.edited-mark')) textEl.insertAdjacentHTML('afterend', '<span class="edited-mark">(изм.)</span>');
        }
    }
});
socket.on('message-deleted', id => { const el = document.getElementById(`msg-${id}`); if(el) el.remove(); });

// --- PINNED MESSAGES ---
socket.on('update-pinned', msg => {
    if(msg) {
        els.pinnedBar.classList.remove('hidden');
        els.pinnedText.innerText = `${msg.username}: ${msg.text || '[Медиа]'}`;
    } else {
        els.pinnedBar.classList.add('hidden');
    }
});
function unpinMessage() { // Кнопка крестик на плашке (только для админа сработает на сервере)
    if(currentUser.isAdmin && confirm('Открепить?')) socket.emit('unpin-message');
}

// --- CONTEXT MENU ---
document.onclick = () => { if(contextMenu) contextMenu.remove(); };

function showCtx(e, msg, isMe, isAdmin) {
    e.preventDefault();
    if(contextMenu) contextMenu.remove();
    
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.style.left = e.clientX + 'px';
    
    addCtxItem('Ответить', () => startReply(msg));
    if(isMe) addCtxItem('Изменить', () => startEdit(msg));
    if(isMe || isAdmin) addCtxItem('Удалить', () => { if(confirm('Удалить?')) socket.emit('delete-message', msg.id); }, true);
    
    // Пин только для админа
    if(isAdmin) addCtxItem('📌 Закрепить', () => socket.emit('pin-message', msg.id));

    document.body.appendChild(contextMenu);
}

function addCtxItem(text, cb, isDel=false) {
    const i = document.createElement('div');
    i.className = 'context-menu-item' + (isDel ? ' delete' : '');
    i.innerText = text;
    i.onclick = cb;
    contextMenu.appendChild(i);
}

// --- UTILS ---
function startReply(msg) {
    replyToMessage = { username: msg.username, text: msg.text || 'Медиа' };
    editingMessageId = null;
    els.replyBar.classList.remove('hidden');
    els.replyInfo.innerText = `В ответ ${msg.username}`;
    els.input.focus();
}
function startEdit(msg) {
    editingMessageId = msg.id;
    replyToMessage = null;
    els.replyBar.classList.remove('hidden');
    els.replyInfo.innerText = "Редактирование";
    els.input.value = msg.text || '';
    els.input.focus();
}
function cancelReply() {
    replyToMessage = null; editingMessageId = null;
    els.replyBar.classList.add('hidden'); els.input.value = '';
}
window.cancelReply = cancelReply;
window.unpinMessage = unpinMessage;

socket.on('display-typing', u => {
    els.typing.innerText = `${u} печатает...`;
    els.typing.classList.remove('hidden');
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => els.typing.classList.add('hidden'), 2000);
});

// ACTIONS
els.fileInput.onchange = function() {
    const f = this.files[0];
    if(f) {
        const r = new FileReader();
        r.onload = e => socket.emit('send-message', { text:'', image:e.target.result, channelId: currentChannelId });
        r.readAsDataURL(f);
    }
    this.value = '';
}
els.myAv.onclick = () => { const u = prompt("URL:"); if(u) socket.emit('change-avatar', u); };

window.createChannelPrompt = createChannelPrompt;
window.buyNitro = () => { if(confirm('Купить Nitro?')) socket.emit('buy-nitro'); };
window.toggleAdmin = () => els.adminModal.classList.toggle('hidden');
window.adminGetStars = () => { socket.emit('admin-give-stars'); alert('+1000'); };
window.adminClearChat = () => { if(confirm('Очистить?')) socket.emit('admin-clear-chat'); };

// === МОБИЛЬНОЕ МЕНЮ ===
const sidebar = document.querySelector('.sidebar');

function toggleSidebar() {
    sidebar.classList.toggle('open');
}

// Закрываем меню, если кликнули по каналу (на мобиле)
document.getElementById('channels-list').addEventListener('click', () => {
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
    }
});