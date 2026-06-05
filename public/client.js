const socket = io();

let currentUser = null;
let currentChannelId = 'global';
let isRegisterMode = false;
let contextMenu = null;
let replyToMessage = null;
let editingMessageId = null;
let typingTimeout = null;

const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2346/2346-preview.mp3');
notificationSound.volume = 0.3;

// DOM Elements
const $ = id => document.getElementById(id);
const els = {
    login: $('auth-modal'),
    userInput: $('username-input'),
    passInput: $('password-input'),
    error: $('error-msg'),
    authTitle: $('auth-title'),
    submitBtn: $('submit-btn'),
    toggleText: $('toggle-text'),
    
    myUser: $('my-username'),
    myBal: $('my-balance'),
    myAv: $('my-avatar'),
    adminBtn: $('admin-btn'),
    
    chatTitle: $('chat-title'),
    online: $('online-counter'),
    msgs: $('messages-container'),
    
    input: $('message-input'),
    fileInput: $('file-input'),
    typing: $('typing-indicator'),
    
    replyBar: $('reply-bar'),
    replyInfo: $('reply-info'),
    
    pinnedBar: $('pinned-bar'),
    pinnedText: $('pinned-text'),
    
    adminModal: $('admin-modal'),
    
    friendsList: $('friends-list'),
    dmList: $('dm-list'),
    onlineBadge: $('online-badge'),
    friendsOnlineBadge: $('friends-online-badge'),
    shopBalance: $('shop-balance'),
    friendsGrid: $('friends-grid'),
    shopGrid: $('shop-grid')
};

// View management
function switchView(view) {
    document.querySelectorAll('.server-icon').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    $(`${view}-view`).classList.remove('hidden');
}

// Auth
function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    els.error.innerText = '';
    els.authTitle.innerText = isRegisterMode ? "Создание аккаунта" : "Добро пожаловать";
    els.submitBtn.innerText = isRegisterMode ? "Создать" : "Войти";
    els.toggleText.innerText = isRegisterMode ? "Уже есть аккаунт?" : "Нет аккаунта?";
}

function submitAuth() {
    const u = els.userInput.value.trim();
    const p = els.passInput.value.trim();
    if(!u || !p) return els.error.innerText = "Заполните все поля";
    socket.emit('auth', { username: u, password: p, type: isRegisterMode ? 'register' : 'login' });
}

socket.on('login-success', user => {
    currentUser = user;
    els.login.classList.add('hidden');
    updateUI(user);
    if(user.isAdmin) els.adminBtn.classList.remove('hidden');
    if(els.shopBalance) els.shopBalance.innerText = user.stars;
});

function updateUI(user) {
    els.myUser.textContent = user.username + (user.isAdmin ? ' [A]' : '');
    els.myBal.textContent = `⭐ ${user.stars}`;
    if(user.avatarUrl) {
        els.myAv.innerHTML = `<img src="${user.avatarUrl}" alt="avatar">`;
    } else {
        els.myAv.textContent = user.username[0].toUpperCase();
        els.myAv.style.background = user.color || '#5865F2';
    }
}

socket.on('update-user', u => {
    currentUser = u;
    updateUI(u);
    if(els.shopBalance) els.shopBalance.innerText = u.stars;
});

socket.on('update-online', c => {
    els.online.textContent = `(${c} ${c === 1 ? 'онлайн' : 'онлайн'})`;
    els.onlineBadge.textContent = c;
    els.friendsOnlineBadge.textContent = c;
});

// Friends/Users
socket.on('update-users', users => {
    renderFriendsList(users);
    renderFriendsGrid(users);
});

function renderFriendsList(users) {
    if(!els.friendsList) return;
    els.friendsList.innerHTML = '';
    
    Object.keys(users).forEach(name => {
        if(name === currentUser?.username) return;
        const u = users[name];
        
        const div = document.createElement('div');
        div.className = 'friend-item';
        div.innerHTML = `
            <div class="friend-avatar">${name[0]}</div>
            <span class="friend-name">${escapeHtml(name)}${u.isAdmin ? ' [A]' : ''}${u.isNitro ? ' ★' : ''}</span>
        `;
        els.friendsList.appendChild(div);
    });
}

function renderFriendsGrid(users) {
    if(!els.friendsGrid) return;
    els.friendsGrid.innerHTML = '';
    
    Object.keys(users).forEach(name => {
        if(name === currentUser?.username) return;
        const u = users[name];
        
        const card = document.createElement('div');
        card.className = 'friend-card';
        card.innerHTML = `
            <div class="friend-card-avatar">${name[0]}</div>
            <div class="friend-card-info">
                <div class="friend-card-name">${escapeHtml(name)}<span class="nitro-star">${u.isNitro ? ' ★' : ''}</span></div>
                <div class="friend-card-status">В сети</div>
            </div>
        `;
        els.friendsGrid.appendChild(card);
    });
}

// Chat
function sendMessage() {
    const text = els.input.value.trim();
    if(!text) return;
    
    if(editingMessageId) {
        socket.emit('edit-message', { id: editingMessageId, newText: text });
        cancelReply();
    } else {
        socket.emit('send-message', { text, replyTo: replyToMessage, channelId: currentChannelId });
    }
    els.input.value = '';
}

els.input?.addEventListener('keypress', e => e.key === 'Enter' && sendMessage());
els.input?.addEventListener('input', () => socket.emit('typing'));

socket.on('message', renderMessage);
socket.on('load-messages', msgs => {
    els.msgs.innerHTML = '';
    msgs.forEach(m => renderMessage(m, false));
    scrollToBottom();
});

socket.on('clear-chat', () => els.msgs.innerHTML = '');

function renderMessage(msg, playSound = true) {
    if(!msg?.id || document.getElementById(`m-${msg.id}`)) return;
    
    const div = document.createElement('div');
    div.id = `m-${msg.id}`;
    div.className = msg.type === 'system' ? 'message system' : 
        (msg.username === currentUser?.username ? 'message my-message' : 'message other-message');
    
    if(msg.type !== 'system') {
        div.oncontextmenu = e => showContextMenu(e, msg);
    }
    
    const color = /^#[0-9A-Fa-f]{6}$/.test(msg.userColor) ? msg.userColor : '#ccc';
    const replyHtml = msg.replyTo ? 
        `<div class="reply-quote">Ответ: ${escapeHtml(msg.replyTo.username)}: ${escapeHtml(msg.replyTo.text)}</div>` : '';
    const badges = (msg.isAdmin ? ' [A]' : '') + (msg.isNitro ? ' ★' : '');
    const edited = msg.isEdited ? '<span class="edited">(изм.)</span>' : '';
    
    div.innerHTML = msg.image 
        ? `${replyHtml}<img src="${escapeHtml(msg.image)}" class="chat-img"> ${edited}`
        : `${replyHtml}<div class="meta" style="color:${color}">${escapeHtml(msg.username)}${badges}</div>
          <div class="text">${escapeHtml(msg.text || '')}</div>${edited}`;
    
    els.msgs.appendChild(div);
    if(playSound) scrollToBottom();
}

function scrollToBottom() { els.msgs.scrollTop = els.msgs.scrollHeight; }

function escapeHtml(text) {
    if(!text) return '';
    return text.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

// Context menu
function showContextMenu(e, msg) {
    e.preventDefault();
    if(contextMenu) contextMenu.remove();
    
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    
    const isMe = msg.username === currentUser?.username;
    addMenuItem('Ответить', () => startReply(msg));
    if(isMe) addMenuItem('Редактировать', () => startEdit(msg));
    if(isMe || currentUser?.isAdmin) addMenuItem('Удалить', () => {
        if(confirm('Удалить сообщение?')) socket.emit('delete-message', msg.id);
    }, true);
    if(currentUser?.isAdmin) addMenuItem('📌 Закрепить', () => socket.emit('pin-message', msg.id));
    
    document.body.appendChild(contextMenu);
}

function addMenuItem(text, callback, isDanger = false) {
    const item = document.createElement('div');
    item.className = `context-item ${isDanger ? 'danger' : ''}`;
    item.textContent = text;
    item.onclick = () => { callback(); contextMenu.remove(); };
    contextMenu.appendChild(item);
}

document.onclick = () => contextMenu?.remove();

function startReply(msg) {
    replyToMessage = { username: msg.username, text: msg.text || 'медиа' };
    editingMessageId = null;
    els.replyBar.classList.remove('hidden');
    els.replyInfo.textContent = `В ответ: ${msg.username}`;
}

function startEdit(msg) {
    editingMessageId = msg.id;
    replyToMessage = null;
    els.replyBar.classList.remove('hidden');
    els.replyInfo.textContent = 'Редактирование';
    els.input.value = msg.text || '';
}

function cancelReply() {
    replyToMessage = null;
    editingMessageId = null;
    els.replyBar.classList.add('hidden');
    els.input.value = '';
}

// Utils
els.fileInput?.addEventListener('change', e => {
    const file = e.target.files[0];
    if(file) {
        const reader = new FileReader();
        reader.onload = ev => socket.emit('send-message', { 
            text: '', 
            image: ev.target.result, 
            channelId: currentChannelId 
        });
        reader.readAsDataURL(file);
    }
    e.target.value = '';
});

els.myAv?.addEventListener('click', () => {
    const url = prompt('URL аватара:');
    if(url) socket.emit('change-avatar', url);
});

// Window exports
window.switchView = switchView;
window.buyNitro = () => { if(confirm('Купить Nitro за 500 звёзд?')) socket.emit('buy-nitro'); };
window.toggleAdmin = () => els.adminModal.classList.toggle('hidden');
window.adminGetStars = () => { socket.emit('admin-give-stars'); alert('+1000 ⭐'); };
window.adminClearChat = () => { if(confirm('Очистить чат?')) socket.emit('admin-clear-chat'); };
window.cancelReply = cancelReply;
window.unpinMessage = () => { if(currentUser?.isAdmin && confirm('Открепить?')) socket.emit('unpin-message'); };
window.toggleSidebar = () => document.querySelector('.channel-sidebar')?.classList.toggle('open');
window.toggleProfile = () => document.querySelector('.profile-panel')?.classList.toggle('open');