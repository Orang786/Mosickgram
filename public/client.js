const socket = io();

let currentUser = null;
let currentChannelId = 'global';
let isRegisterMode = false;
let contextMenu = null;
let replyToMessage = null;
let editingMessageId = null;

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
    myStars: $('my-stars'),
    myAv: $('my-avatar'),
    adminBtn: $('admin-btn'),
    
    chatTitle: $('chat-title'),
    online: $('online-counter'),
    msgs: $('messages-container'),
    
    input: $('message-input'),
    fileInput: $('file-input'),
    
    replyBar: $('reply-bar'),
    replyInfo: $('reply-info'),
    
    pinnedBar: $('pinned-bar'),
    pinnedText: $('pinned-text'),
    
    adminModal: $('admin-modal'),
    chatList: $('chat-list'),
    profileStars: $('profile-stars')
};

// View management
function switchView(view) {
    document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
    els.chatList.querySelector('.chat-item')?.classList.add('active');
}

function openChat(channelId) {
    currentChannelId = channelId;
    if(els.chatTitle) els.chatTitle.textContent = 'Глобальный чат';
    socket.emit('join-channel', channelId);
}

// Auth
function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    els.error.textContent = '';
    els.authTitle.textContent = isRegisterMode ? "Создание аккаунта" : "Telegram";
}

function submitAuth() {
    const username = els.userInput.value.trim();
    const password = els.passInput.value.trim();
    if(!username || !password) {
        els.error.textContent = "Заполните все поля";
        return;
    }
    socket.emit('auth', {
        username: username,
        password: password,
        type: isRegisterMode ? 'register' : 'login'
    });
}

socket.on('auth-error', msg => {
    els.error.textContent = msg;
    setTimeout(() => els.error.textContent = '', 4000);
});

socket.on('login-success', user => {
    currentUser = user;
    els.login.classList.add('hidden');
    updateUI(user);
    if(user.isAdmin) els.adminBtn.classList.remove('hidden');
});

function updateUI(user) {
    if(els.myUser) els.myUser.textContent = user.username;
    if(els.myStars) els.myStars.textContent = `⭐ ${user.stars}`;
    if(user.avatarUrl) {
        if(els.myAv) els.myAv.innerHTML = `<img src="${user.avatarUrl}" alt="avatar">`;
    } else {
        if(els.myAv) {
            els.myAv.textContent = user.username ? user.username[0].toUpperCase() : '?';
            els.myAv.style.background = user.color || '#0088cc';
        }
    }
}

socket.on('update-user', u => {
    currentUser = u;
    updateUI(u);
});

socket.on('update-online', c => {
    if(els.online) els.online.textContent = `(${c} онлайн)`;
});

// Messages
function sendMessage() {
    const text = els.input.value.trim();
    if(!text) return;
    
    if(editingMessageId) {
        socket.emit('edit-message', { id: editingMessageId, newText: text });
        cancelReply();
    } else {
        socket.emit('send-message', {
            text: text,
            replyTo: replyToMessage,
            channelId: currentChannelId
        });
    }
    els.input.value = '';
}

els.input?.addEventListener('keypress', e => {
    if(e.key === 'Enter') sendMessage();
});

socket.on('message', renderMessage);
socket.on('load-messages', msgs => {
    if(els.msgs) {
        els.msgs.innerHTML = '';
        msgs.forEach(m => renderMessage(m, false));
        scrollToBottom();
    }
});

socket.on('clear-chat', () => {
    if(els.msgs) els.msgs.innerHTML = '';
});

socket.on('message-updated', d => {
    const el = document.getElementById(`m-${d.id}`);
    if(el) {
        const textEl = el.querySelector('.message-text');
        if(textEl) {
            textEl.textContent = d.newText;
            const edited = el.querySelector('.edited-mark');
            if(!edited) {
                textEl.insertAdjacentHTML('afterend', '<span class="edited-mark">(изм.)</span>');
            }
        }
    }
});

socket.on('message-deleted', id => {
    const el = document.getElementById(`m-${id}`);
    if(el) el.remove();
});

socket.on('update-pinned', msg => {
    if(els.pinnedBar && els.pinnedText) {
        if(msg) {
            els.pinnedBar.classList.remove('hidden');
            els.pinnedText.textContent = `${msg.username}: ${msg.text || 'медиа'}`;
        } else {
            els.pinnedBar.classList.add('hidden');
        }
    }
});

function renderMessage(msg, playSound = true) {
    if(!msg || !msg.id) return;
    if(document.getElementById(`m-${msg.id}`)) return;
    
    const div = document.createElement('div');
    div.id = `m-${msg.id}`;
    div.className = msg.username === currentUser?.username ? 'message my-message' : 'message other-message';
    
    if(msg.type !== 'system') {
        div.oncontextmenu = e => showContextMenu(e, msg);
    }
    
    const color = /^#[0-9A-Fa-f]{6}$/.test(msg.userColor) ? msg.userColor : '#0088cc';
    const replyHtml = msg.replyTo ? 
        `<div class="reply-quote">Ответ: ${escapeHtml(msg.replyTo.username)}: ${escapeHtml(msg.replyTo.text)}</div>` : '';
    const badges = (msg.isAdmin ? ' [A]' : '') + (msg.isNitro ? ' ★' : '');
    const edited = msg.isEdited ? '<span class="edited-mark">(изм.)</span>' : '';
    
    div.innerHTML = `
        <div class="message-header" style="color:${color}">${escapeHtml(msg.username)}${badges}</div>
        ${replyHtml}
        ${msg.image ? `<img src="${escapeHtml(msg.image)}" class="chat-img">` : `<div class="message-text">${escapeHtml(msg.text || '')}</div>`}
        ${edited}
    `;
    
    if(els.msgs) els.msgs.appendChild(div);
    if(playSound) scrollToBottom();
}

function scrollToBottom() {
    if(els.msgs) els.msgs.scrollTop = els.msgs.scrollHeight;
}

function escapeHtml(text) {
    if(!text) return '';
    return String(text).replace(/[&<>'"]/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    })[c]);
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
    item.className = 'context-item';
    if(isDanger) item.classList.add('danger');
    item.textContent = text;
    item.onclick = () => {
        callback();
        if(contextMenu) contextMenu.remove();
    };
    if(contextMenu) contextMenu.appendChild(item);
}

document.onclick = () => {
    if(contextMenu) contextMenu.remove();
};

function startReply(msg) {
    replyToMessage = { username: msg.username, text: msg.text || 'медиа' };
    editingMessageId = null;
    if(els.replyBar) els.replyBar.classList.remove('hidden');
    if(els.replyInfo) els.replyInfo.textContent = `Ответ: ${msg.username}`;
}

function startEdit(msg) {
    editingMessageId = msg.id;
    replyToMessage = null;
    if(els.replyBar) els.replyBar.classList.remove('hidden');
    if(els.replyInfo) els.replyInfo.textContent = 'Редактирование';
    els.input.value = msg.text || '';
}

function cancelReply() {
    replyToMessage = null;
    editingMessageId = null;
    if(els.replyBar) els.replyBar.classList.add('hidden');
    els.input.value = '';
}

// Utils
els.fileInput?.addEventListener('change', e => {
    const file = e.target.files[0];
    if(file) {
        const reader = new FileReader();
        reader.onload = ev => {
            socket.emit('send-message', {
                text: '',
                image: ev.target.result,
                channelId: currentChannelId
            });
        };
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
window.buyNitro = () => {
    if(confirm('Купить Nitro за 500 звёзд?')) {
        socket.emit('buy-nitro');
    }
};
window.toggleAdmin = () => {
    if(els.adminModal) els.adminModal.classList.toggle('hidden');
};
window.adminGetStars = () => {
    socket.emit('admin-give-stars');
    alert('+1000 ⭐');
};
window.adminClearChat = () => {
    if(confirm('Очистить чат?')) {
        socket.emit('admin-clear-chat');
    }
};
window.cancelReply = cancelReply;
window.unpinMessage = () => {
    if(currentUser?.isAdmin && confirm('Открепить?')) {
        socket.emit('unpin-message');
    }
};
window.toggleSidebar = () => {
    document.getElementById('chat-sidebar')?.classList.toggle('open');
};
window.searchChats = query => {
    document.querySelectorAll('.chat-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query.toLowerCase()) ? '' : 'none';
    });
};