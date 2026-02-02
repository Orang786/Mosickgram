document.addEventListener('DOMContentLoaded', () => {
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
        nitroColor: document.getElementById('nitro-color-picker'),
        adminBtn: document.getElementById('admin-btn'),
        
        chatTitle: document.getElementById('chat-title'),
        online: document.getElementById('online-counter'),
        chanList: document.getElementById('channels-list'),
        dmsList: document.getElementById('dms-list'),
        msgs: document.getElementById('messages-container'),
        
        input: document.getElementById('message-input'),
        fileInput: document.getElementById('file-input'),
        avatarInput: document.getElementById('avatar-input'),
        typing: document.getElementById('typing-indicator'),
        
        replyBar: document.getElementById('reply-bar'),
        replyInfo: document.getElementById('reply-info'),
        pinnedBar: document.getElementById('pinned-bar'),
        pinnedText: document.getElementById('pinned-text'),
        
        sidebar: document.querySelector('.sidebar'),
        welcome: document.getElementById('welcome-screen'),
        emojiPicker: document.getElementById('emoji-picker'),
        
        adminPanel: document.getElementById('admin-panel'),
        usersList: document.getElementById('admin-users-list'),
        
        payModal: document.getElementById('payment-modal'),
        nitroModal: document.getElementById('nitro-modal')
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
        els.welcome.classList.remove('hidden');
    });

    function updateUI(user) {
        currentUser = user;
        els.myUser.innerText = user.username + (user.isAdmin ? ' (A)' : '');
        els.myBal.innerText = `★ ${user.stars}`;
        
        // Color
        if (user.customColor) els.myUser.style.color = user.customColor;
        else if (user.isNitro) els.myUser.style.color = '#a29bfe';
        else els.myUser.style.color = '#fff';

        // Avatar
        if(user.avatarUrl) {
            els.myAv.innerHTML = `<img src="${user.avatarUrl}">`;
            els.myAv.style.background = 'transparent';
        } else {
            els.myAv.innerText = user.username[0].toUpperCase();
            els.myAv.style.background = user.color || '#555';
        }
        
        if(user.isNitro) {
            els.nitroColor.classList.remove('hidden');
            els.nitroColor.value = user.customColor || '#ffffff';
        }
    }

    socket.on('update-user', u => { currentUser = u; updateUI(u); });
    socket.on('update-online', c => { if(els.online) els.online.innerText = `(${c} online)`; });

    // --- PAYMENT & NITRO ---
    function openPaymentModal() { els.payModal.classList.remove('hidden'); }
    function openNitroModal() { els.nitroModal.classList.remove('hidden'); }
    function closeModals() { els.payModal.classList.add('hidden'); els.nitroModal.classList.add('hidden'); }
    
    window.topUp = function(amount) {
        const btn = event.target; const oldText = btn.innerText;
        btn.innerText = "Обработка...";
        setTimeout(() => {
            socket.emit('top-up-balance', amount);
            btn.innerText = oldText; alert("Успешно!"); closeModals();
        }, 1000);
    };

    window.buyNitroAction = function() {
        if (currentUser.isNitro) return alert("Уже есть Nitro!");
        if (currentUser.stars < 500) {
            if(confirm("Не хватает звезд! Пополнить?")) { closeModals(); openPaymentModal(); }
            return;
        }
        socket.emit('buy-nitro'); closeModals();
    };

    socket.on('payment-error', msg => alert(msg));
    els.nitroColor.addEventListener('change', (e) => socket.emit('change-name-color', e.target.value));

    // --- SIDEBAR TABS ---
    function switchSidebarView(view) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`tab-btn-${view}`).classList.add('active');
        document.getElementById('channels-view').classList.add('hidden');
        document.getElementById('dms-view').classList.add('hidden');
        document.getElementById(`${view}-view`).classList.remove('hidden');
    }

    // --- CHANNELS & DMs ---
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
            div.id = `chan-${id}`;
            div.onclick = () => switchChannel(id, c.name);
            div.innerHTML = `<div class="avatar" style="font-size:0.8rem; background:#333">${c.name[0]}</div><div class="chat-info"><h4>${c.name}</h4></div>`;
            els.chanList.appendChild(div);
        });
    });

    socket.on('update-dms', (dms) => {
        els.dmsList.innerHTML = '';
        dms.forEach(username => {
            const participants = [currentUser.username, username].sort();
            const dmId = `dm_${participants[0]}_${participants[1]}`;
            const div = document.createElement('div');
            div.className = `chat-item ${dmId === currentChannelId ? 'active' : ''}`;
            div.id = `dm-${username}`;
            div.onclick = () => startDM(username);
            div.innerHTML = `<div class="avatar" style="font-size:0.8rem; background: var(--accent-color)">${username[0].toUpperCase()}</div><div class="chat-info"><h4>${username}</h4><p>Личный чат</p></div>`;
            els.dmsList.appendChild(div);
        });
    });

    function startDM(targetUsername) {
        socket.emit('start-dm', targetUsername);
        switchSidebarView('dms');
    }
    
    socket.on('force-join-dm', (data) => {
        switchSidebarView('dms');
        switchChannel(data.dmId, data.target);
    });

    function switchChannel(id, name) {
        if(id === currentChannelId) return;
        currentChannelId = id;
        els.chatTitle.innerText = name || 'Чат';
        els.msgs.innerHTML = '';
        els.welcome.classList.add('hidden');
        if(window.innerWidth <= 768) els.sidebar.classList.remove('open');
        document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
        const activeItem = document.getElementById(`chan-${id}`) || document.getElementById(`dm-${name}`); 
        if (activeItem) activeItem.classList.add('active');
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
            let content = msg.image ? `<img src="${msg.image}" class="chat-image" onclick="window.open(this.src)">` : `<div class="text">${escapeHtml(msg.text)}</div>`;
            if(msg.isEdited) content += `<span class="edited-mark">(изм.)</span>`;
            
            const nameColor = msg.userColor || '#fff';
            
            div.innerHTML = `<div class="meta"><span style="color:${nameColor}">${msg.username}</span>${badges}</div>${replyHtml} ${content}`;
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
    function toggleEmoji() { if(els.emojiPicker) els.emojiPicker.classList.toggle('hidden'); }
    if(els.emojiPicker) {
        els.emojiPicker.addEventListener('emoji-click', event => {
            els.input.value += event.detail.unicode; els.input.focus();
        });
    }
    document.addEventListener('click', (e) => {
        const isBtn = e.target.innerText === '😃' || e.target.closest('.attach-btn');
        const isPkr = e.target.tagName === 'EMOJI-PICKER';
        if (!isBtn && !isPkr && els.emojiPicker && !els.emojiPicker.classList.contains('hidden')) els.emojiPicker.classList.add('hidden');
    });

    // --- ADMIN ---
    function toggleAdmin() {
        if (!currentUser || !currentUser.isAdmin) return alert("Доступ запрещен!");
        els.adminPanel.classList.toggle('hidden');
        if (!els.adminPanel.classList.contains('hidden')) socket.emit('admin-get-data');
    }
    window.switchAdminTab = function(tabName) {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('hidden'));
        document.querySelectorAll('.admin-menu-item').forEach(i => i.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.remove('hidden');
        event.target.classList.add('active');
    };
    socket.on('admin-data-received', (data) => {
        const { users, stats } = data;
        document.getElementById('stat-total-users').innerText = stats.totalUsers;
        document.getElementById('stat-msgs').innerText = stats.totalMessages;
        document.getElementById('stat-online').innerText = stats.onlineUsers;
        els.usersList.innerHTML = '';
        users.forEach(u => {
            const tr = document.createElement('tr');
            let roles = '';
            if (u.isAdmin) roles += '<span class="badge admin">ADMIN</span>';
            if (u.isNitro) roles += '<span class="badge nitro">NITRO</span>';
            if (u.isBanned) roles += '<span class="badge banned">BANNED</span>';
            if (!roles) roles = '<span style="color:#555">-</span>';
            tr.innerHTML = `<td><span class="status-dot ${u.isOnline ? 'online' : 'offline'}"></span> <b>${escapeHtml(u.username)}</b></td><td>${u.isOnline ? '<span style="color:#00b894">Online</span>' : 'Offline'}</td><td>${roles}</td><td><button class="act-btn btn-ban" onclick="adminAction('${u._id}', 'ban')">${u.isBanned ? 'Разбанить' : 'Бан'}</button><button class="act-btn btn-promote" onclick="adminAction('${u._id}', 'promote')">${u.isAdmin ? 'Снять Adm' : 'Дать Adm'}</button><button class="act-btn" style="background:#ffeaa7" onclick="adminAction('${u._id}', 'nitro')">Nitro</button></td>`;
            els.usersList.appendChild(tr);
        });
    });
    window.adminAction = function(userId, action) {
        if (!confirm(`Выполнить: ${action}?`)) return;
        socket.emit('admin-user-action', { userId, action });
    };
    socket.on('admin-action-success', () => socket.emit('admin-get-data'));

    // --- MENU ---
    document.onclick = (e) => { if(contextMenu && !e.target.closest('.context-menu')) contextMenu.remove(); };
    function showCtx(e, msg, isMe, isAdmin) {
        e.preventDefault();
        if(contextMenu) contextMenu.remove();
        contextMenu = document.createElement('div');
        contextMenu.className = 'context-menu';
        contextMenu.style.top = e.clientY + 'px';
        contextMenu.style.left = e.clientX + 'px';
        if (msg.username !== currentUser.username) addCtxItem('💬 Написать лично', () => startDM(msg.username));
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
    function startReply(msg) { replyToMessage = { username: msg.username, text: msg.text || 'Медиа' }; editingMessageId = null; els.replyBar.classList.remove('hidden'); els.replyInfo.innerText = `В ответ ${msg.username}`; els.input.focus(); }
    function startEdit(msg) { editingMessageId = msg.id; replyToMessage = null; els.replyBar.classList.remove('hidden'); els.replyInfo.innerText = "Редактирование"; els.input.value = msg.text; els.input.focus(); }
    function cancelReply() { replyToMessage = null; editingMessageId = null; els.replyBar.classList.add('hidden'); els.input.value = ''; }
    function toggleSidebar() { els.sidebar.classList.toggle('open'); }
    socket.on('display-typing', u => { els.typing.innerText = `${u} печатает...`; els.typing.classList.remove('hidden'); clearTimeout(typingTimeout); typingTimeout = setTimeout(() => els.typing.classList.add('hidden'), 2000); });

    els.fileInput.onchange = function() {
        const f = this.files[0];
        if(f) {
            const limit = currentUser.isNitro ? 10 * 1024 * 1024 : 1 * 1024 * 1024;
            if (f.size > limit) return alert(currentUser.isNitro ? "Слишком большой файл (Макс 10Мб)" : "Купите Nitro для загрузки файлов > 1Мб!");
            const r = new FileReader();
            r.onload = e => socket.emit('send-message', { text:'', image:e.target.result, channelId: currentChannelId });
            r.readAsDataURL(f);
        } this.value = '';
    }

    els.myAv.onclick = () => { els.avatarInput.click(); };
    els.avatarInput.onchange = function() {
        const file = this.files[0];
        if (!file) return;
        if (file.size > 1024 * 1024) { alert("Файл слишком большой! Макс 1Мб."); this.value = ''; return; }
        const reader = new FileReader();
        reader.onload = (e) => { socket.emit('change-avatar', e.target.result); };
        reader.readAsDataURL(file);
        this.value = '';
    };

    // EXPORTS
    window.submitAuth = submitAuth;
    window.toggleAuthMode = toggleAuthMode;
    window.createChannelPrompt = createChannelPrompt;
    window.buyNitro = () => { if(confirm('Купить Nitro?')) socket.emit('buy-nitro'); };
    window.toggleAdmin = toggleAdmin;
    window.adminGetStars = () => { socket.emit('admin-give-stars'); alert('+1000'); };
    window.adminClearChat = () => { if(confirm('Очистить?')) socket.emit('admin-clear-chat'); };
    window.toggleEmoji = toggleEmoji;
    window.unpinMessage = unpinMessage;
    window.cancelReply = cancelReply;
    window.toggleSidebar = toggleSidebar;
    window.sendMessage = sendMessage;
    window.switchSidebarView = switchSidebarView;
    window.openPaymentModal = openPaymentModal;
    window.openNitroModal = openNitroModal;
    window.closeModals = closeModals;
    window.buyNitroAction = buyNitroAction;
});
