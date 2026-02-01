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

// DOM ELEMENTS
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
    
    adminModal: document.getElementById('admin-modal'),
    sidebar: document.querySelector('.sidebar'),
    welcome: document.getElementById('welcome-screen'),
    emojiPicker: document.getElementById('emoji-picker')
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

socket.on('auth-error', msg => els.error.innerText = msg);
socket.on('login-success', user => {
    currentUser = user;
    els.login.classList.add('hidden');
    updateUI(user);
    if(user.isAdmin) els.adminBtn.classList.remove('hidden');
    
    // При входе показываем заглушку, пока не выберут чат
    els.welcome.classList.remove('hidden');
});

function updateUI(user) {
    els.myUser.innerText = user.username + (user.isAdmin ? ' (A)' : '');
    els.myBal.innerText = `★ ${user.stars}`;
    if(user.avatarUrl) {
        els.myAv.innerHTML = `<img src="${user.avatarUrl}">`;
        els.myAv.style.background = 'transparent';
    } else {
        els.myAv.innerText = user.username[0].toUpperCase();
        els.myAv.style.background = user.color || '#555';
    }
    if(user.isNitro) els.myUser.style.color = '#a29bfe';
}

socket.on('update-user', u => { currentUser = u; updateUI(u); });
socket.on('update-online', c => { if(els.online) els.online.innerText = `(${c} online)`; });

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
            <div class="avatar" style="font-size:0.8rem; background:#333">${c.name[0]}</div>
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
    
    // Скрываем приветствие, показываем чат
    els.welcome.classList.add('hidden');
    
    // На мобильном скрываем меню
    if(window.innerWidth <= 768) els.sidebar.classList.remove('open');
    
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

        let replyHtml = msg.replyTo ? `<div class="reply-quote">${msg.replyTo.username}: ${msg.replyTo.text}</div>` : '';
        let badges = '';
        if(msg.isAdmin) badges += ' <span style="color:#ff7675">[A]</span>';
        if(msg.isNitro) badges += ' <span style="color:#ffeaa7">★</span>';
        
        let content = msg.image 
            ? `<img src="${msg.image}" class="chat-image" onclick="window.open(this.src)">` 
            : `<div class="text">${escapeHtml(msg.text)}</div>`;
            
        if(msg.isEdited) content += `<span class="edited-mark">(изм.)</span>`;

        div.innerHTML = `
            <div class="meta"><span style="color:${msg.userColor}">${msg.username}</span>${badges}</div>
            ${replyHtml} ${content}
        `;
        
        if(!isMe && playSound) notificationSound.play().catch(()=>{});
    }
    els.msgs.appendChild(div);
    if(playSound) scrollToBottom();
}

function scrollToBottom() { els.msgs.scrollTop = els.msgs.scrollHeight; }
function escapeHtml(text) { return text ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : ''; }

socket.on('message-updated', d => {
    const el = document.getElementById(`msg-${d.id}`);
    if(el) {
        el.querySelector('.text').innerText = d.newText;
        if(!el.querySelector('.edited-mark')) el.querySelector('.text').insertAdjacentHTML('afterend', '<span class="edited-mark">(изм.)</span>');
    }
});
socket.on('message-deleted', id => { const el = document.getElementById(`msg-${id}`); if(el) el.remove(); });

// --- PINNED ---
socket.on('update-pinned', msg => {
    if(msg) {
        els.pinnedBar.classList.remove('hidden');
        els.pinnedText.innerText = `${msg.username}: ${msg.text || '[Медиа]'}`;
    } else {
        els.pinnedBar.classList.add('hidden');
    }
});
function unpinMessage() { if(currentUser.isAdmin && confirm('Открепить?')) socket.emit('unpin-message'); }

// --- EMOJI ---
function toggleEmoji() { els.emojiPicker.classList.toggle('hidden'); }
document.querySelector('emoji-picker').addEventListener('emoji-click', event => {
    els.input.value += event.detail.unicode;
    els.input.focus();
});
document.addEventListener('click', (e) => {
    const isBtn = e.target.innerText === '😃' || e.target.closest('.attach-btn');
    const isPkr = e.target.tagName === 'EMOJI-PICKER';
    if (!isBtn && !isPkr && !els.emojiPicker.classList.contains('hidden')) els.emojiPicker.classList.add('hidden');
});

// --- MENU & UTILS ---
document.onclick = (e) => { if(contextMenu && !e.target.closest('.context-menu')) contextMenu.remove(); };

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
    if(isAdmin) addCtxItem('📌 Закрепить', () => socket.emit('pin-message', msg.id));
    document.body.appendChild(contextMenu);
}
function addCtxItem(text, cb, isDel=false) {
    const i = document.createElement('div');
    i.className = 'context-menu-item' + (isDel ? ' delete' : '');
    i.innerText = text; i.onclick = cb; contextMenu.appendChild(i);
}

function startReply(msg) {
    replyToMessage = { username: msg.username, text: msg.text || 'Медиа' };
    editingMessageId = null;
    els.replyBar.classList.remove('hidden'); els.replyInfo.innerText = `В ответ ${msg.username}`; els.input.focus();
}
function startEdit(msg) {
    editingMessageId = msg.id; replyToMessage = null;
    els.replyBar.classList.remove('hidden'); els.replyInfo.innerText = "Редактирование"; els.input.value = msg.text; els.input.focus();
}
function cancelReply() {
    replyToMessage = null; editingMessageId = null; els.replyBar.classList.add('hidden'); els.input.value = '';
}
function toggleSidebar() { els.sidebar.classList.toggle('open'); }

socket.on('display-typing', u => {
    els.typing.innerText = `${u} печатает...`; els.typing.classList.remove('hidden');
    clearTimeout(typingTimeout); typingTimeout = setTimeout(() => els.typing.classList.add('hidden'), 2000);
});

els.fileInput.onchange = function() {
    const f = this.files[0];
    if(f) {
        const r = new FileReader();
        r.onload = e => socket.emit('send-message', { text:'', image:e.target.result, channelId: currentChannelId });
        r.readAsDataURL(f);
    } this.value = '';
}

els.myAv.onclick = () => { const u = prompt("URL:"); if(u) socket.emit('change-avatar', u); };
window.createChannelPrompt = createChannelPrompt;
window.buyNitro = () => { if(confirm('Купить Nitro?')) socket.emit('buy-nitro'); };
window.toggleAdmin = () => els.adminModal.classList.toggle('hidden');
window.adminGetStars = () => { socket.emit('admin-give-stars'); alert('+1000'); };
window.adminClearChat = () => { if(confirm('Очистить?')) socket.emit('admin-clear-chat'); };
window.toggleEmoji = toggleEmoji;
window.unpinMessage = unpinMessage;
window.cancelReply = cancelReply;
window.toggleSidebar = toggleSidebar;
