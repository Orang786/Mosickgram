require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 });

app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI; 
if (!MONGO_URI) console.error("❌ MONGO_URI Error");

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✅ MongoDB Connected');
        initDB();
    })
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- СХЕМЫ ---
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    stars: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    isNitro: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    color: String,
    avatarUrl: String,
    joinedAt: { type: Date, default: Date.now },
    // НОВОЕ: Список открытых диалогов (массив никнеймов собеседников)
    openDMs: [{ type: String }] 
});

const MessageSchema = new mongoose.Schema({
    channelId: { type: String, default: 'global' },
    username: String,
    type: String, 
    text: String,
    image: String,
    replyTo: Object,
    isEdited: { type: Boolean, default: false },
    isNitro: Boolean,
    isAdmin: Boolean,
    userColor: String,
    avatarUrl: String,
    timestamp: { type: Date, default: Date.now }
});

const ChannelSchema = new mongoose.Schema({
    channelId: { type: String, unique: true },
    name: String,
    desc: String,
    pinnedMessageId: String
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const Channel = mongoose.model('Channel', ChannelSchema);

async function initDB() {
    try {
        const globalChan = await Channel.findOne({ channelId: 'global' });
        if (!globalChan) {
            await new Channel({ channelId: 'global', name: 'Global Chat', desc: 'Главный сервер' }).save();
        }
    } catch (e) { console.error(e); }
}

let activeSockets = {}; // socket.id -> username

io.on('connection', (socket) => {

    // === АВТОРИЗАЦИЯ ===
    socket.on('auth', async (data) => {
        const { username, password, type } = data;
        if (!username || !password) return socket.emit('auth-error', 'Заполните поля');

        try {
            if (type === 'register') {
                const exists = await User.findOne({ username });
                if (exists) return socket.emit('auth-error', 'Ник занят');
                if (username.length > 15) return socket.emit('auth-error', 'Длинный ник');

                const hashedPassword = await bcrypt.hash(password, 10);
                const newUser = new User({
                    username,
                    password: hashedPassword,
                    color: '#' + Math.floor(Math.random()*16777215).toString(16),
                    openDMs: []
                });
                await newUser.save();
                loginUser(socket, newUser);

            } else {
                const user = await User.findOne({ username });
                if (!user) return socket.emit('auth-error', 'Пользователь не найден');
                
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) return socket.emit('auth-error', 'Неверный пароль');
                if (user.isBanned) return socket.emit('auth-error', '⛔ ВЫ ЗАБАНЕНЫ!');

                loginUser(socket, user);
            }
        } catch (e) { console.error(e); }
    });

    async function loginUser(socket, user) {
        activeSockets[socket.id] = user.username;
        socket.emit('login-success', user);
        
        // 1. Отправляем Каналы
        const channels = await Channel.find();
        const channelsData = {};
        channels.forEach(c => channelsData[c.channelId] = { name: c.name, desc: c.desc });
        socket.emit('update-channels', channelsData);

        // 2. Отправляем ЛС (Direct Messages)
        // Берем список собеседников из базы и отправляем клиенту
        socket.emit('update-dms', user.openDMs || []);

        joinChannel(socket, 'global');
        io.emit('update-online', Object.keys(activeSockets).length);
    }

    // === КАНАЛЫ (ПУБЛИЧНЫЕ) ===
    socket.on('create-channel', async (name) => {
        const username = activeSockets[socket.id];
        if (!username) return;
        const id = 'chan-' + Date.now();
        await new Channel({ channelId: id, name, desc: `Создал: ${username}` }).save();
        
        const channels = await Channel.find();
        const channelsData = {};
        channels.forEach(c => channelsData[c.channelId] = { name: c.name, desc: c.desc });
        io.emit('update-channels', channelsData);
    });

    // === ЛИЧНЫЕ СООБЩЕНИЯ (НОВОЕ) ===
    socket.on('start-dm', async (targetUsername) => {
        const myName = activeSockets[socket.id];
        if (!myName || myName === targetUsername) return;

        // Проверяем, существует ли цель
        const targetUser = await User.findOne({ username: targetUsername });
        if (!targetUser) return;

        // Добавляем друг друга в списки openDMs (если еще нет)
        await User.updateOne({ username: myName }, { $addToSet: { openDMs: targetUsername } });
        await User.updateOne({ username: targetUsername }, { $addToSet: { openDMs: myName } });

        // Обновляем список ЛС у меня
        const me = await User.findOne({ username: myName });
        socket.emit('update-dms', me.openDMs);

        // Обновляем список ЛС у собеседника (если он онлайн)
        for (let [sockId, name] of Object.entries(activeSockets)) {
            if (name === targetUsername) {
                const him = await User.findOne({ username: targetUsername });
                io.to(sockId).emit('update-dms', him.openDMs);
            }
        }

        // Формируем ID комнаты: 'dm_user1_user2' (сортируем по алфавиту, чтобы ID был одинаковым для обоих)
        const participants = [myName, targetUsername].sort();
        const dmId = `dm_${participants[0]}_${participants[1]}`;
        
        // Сразу переключаем инициатора на этот чат
        socket.emit('force-join-dm', { dmId, target: targetUsername });
    });

    // === ВХОД В ЧАТ (ОБЩИЙ ИЛИ ЛС) ===
    socket.on('join-channel', async (id) => {
        const username = activeSockets[socket.id];
        if(!username) return;

        // ПРОВЕРКА ДОСТУПА К ЛС
        if (id.startsWith('dm_')) {
            // ID выглядит как dm_UserA_UserB. Проверяем, есть ли мое имя в ID.
            if (!id.includes(username)) {
                return socket.emit('message', { type: 'system', text: '⛔ Нет доступа к этому чату' });
            }
        }

        socket.rooms.forEach(room => { if(room !== socket.id) socket.leave(room); });
        socket.join(id);
        
        const msgs = await Message.find({ channelId: id }).sort({ timestamp: 1 }).limit(100);
        socket.emit('load-messages', msgs.map(m => formatMsg(m)));
        socket.emit('set-active-channel', id);

        // Закрепы только для публичных каналов
        if (!id.startsWith('dm_')) {
            const channel = await Channel.findOne({ channelId: id });
            if(channel && channel.pinnedMessageId) {
                const pinnedMsg = await Message.findById(channel.pinnedMessageId);
                if(pinnedMsg) socket.emit('update-pinned', formatMsg(pinnedMsg));
            } else {
                socket.emit('update-pinned', null);
            }
        } else {
            socket.emit('update-pinned', null);
        }
    });

    // === СООБЩЕНИЯ ===
    socket.on('send-message', async (data) => {
        const username = activeSockets[socket.id];
        if (!username) return;
        const user = await User.findOne({ username });
        if (user.isBanned) return;
        if (data.text && data.text.startsWith('/')) return;

        const newMsg = new Message({
            channelId: data.channelId || 'global',
            username: user.username,
            type: data.image ? 'image' : 'user',
            text: data.text || '',
            image: data.image || null,
            replyTo: data.replyTo,
            isNitro: user.isNitro,
            isAdmin: user.isAdmin,
            userColor: user.color,
            avatarUrl: user.avatarUrl
        });

        const savedMsg = await newMsg.save();
        io.to(savedMsg.channelId).emit('message', formatMsg(savedMsg));
    });

    socket.on('delete-message', async (id) => {
        const username = activeSockets[socket.id];
        const msg = await Message.findById(id);
        if(!msg) return;
        const user = await User.findOne({ username });
        if (msg.username === username || user.isAdmin) {
            await Message.findByIdAndDelete(id);
            io.emit('message-deleted', id);
        }
    });

    socket.on('edit-message', async (data) => {
        const username = activeSockets[socket.id];
        const msg = await Message.findById(data.id);
        if(msg && msg.username === username) {
            msg.text = data.newText;
            msg.isEdited = true;
            await msg.save();
            io.emit('message-updated', { id: msg._id, newText: msg.text });
        }
    });

    socket.on('pin-message', async (id) => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({username});
        // Пин только если админ и это не ЛС
        const msg = await Message.findById(id);
        if(!user || !user.isAdmin || msg.channelId.startsWith('dm_')) return;
        
        if(msg) {
            await Channel.findOneAndUpdate({ channelId: msg.channelId }, { pinnedMessageId: id });
            io.to(msg.channelId).emit('update-pinned', formatMsg(msg));
        }
    });
    
    socket.on('unpin-message', async () => {
         const username = activeSockets[socket.id];
         const user = await User.findOne({username});
         if(!user || !user.isAdmin) return;
         const room = Array.from(socket.rooms).find(r => r !== socket.id);
         if(room && !room.startsWith('dm_')) {
             await Channel.findOneAndUpdate({ channelId: room }, { pinnedMessageId: null });
             io.to(room).emit('update-pinned', null);
         }
    });

    // === USER TOOLS ===
    socket.on('typing', () => {
        const u = activeSockets[socket.id];
        // Нужно отправлять тайпинг только в комнату, где сидит юзер, но для простоты шлем всем в комнате
        // (Socket.io сам разрулит broadcast.to(room), но тут нужно знать комнату. 
        // Пока оставим глобально или можно допилить)
        if(u) socket.broadcast.emit('display-typing', u);
    });

    socket.on('change-avatar', async (dataUri) => {
        const username = activeSockets[socket.id];
        await User.findOneAndUpdate({ username }, { avatarUrl: dataUri });
        const updated = await User.findOne({ username });
        socket.emit('update-user', updated);
    });
    
    socket.on('buy-nitro', async () => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({ username });
        if(user.stars >= 500) {
            user.stars -= 500; user.isNitro = true;
            await user.save();
            socket.emit('update-user', user);
        }
    });

    // === ADMIN ===
    socket.on('admin-get-data', async () => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({ username });
        if (!user || !user.isAdmin) return;

        const allUsers = await User.find({}, 'username stars isAdmin isBanned isNitro joinedAt');
        const stats = {
            totalUsers: allUsers.length,
            totalMessages: await Message.countDocuments(),
            onlineUsers: Object.keys(activeSockets).length
        };
        const usersList = allUsers.map(u => ({
            _id: u._id,
            username: u.username,
            stars: u.stars,
            isAdmin: u.isAdmin,
            isBanned: u.isBanned,
            isNitro: u.isNitro,
            isOnline: Object.values(activeSockets).includes(u.username),
            joinedAt: u.joinedAt ? u.joinedAt.toLocaleDateString() : '?'
        }));
        socket.emit('admin-data-received', { users: usersList, stats });
    });

    socket.on('admin-user-action', async (data) => {
        const adminName = activeSockets[socket.id];
        const admin = await User.findOne({ username: adminName });
        if (!admin || !admin.isAdmin) return;
        const { userId, action } = data;
        const targetUser = await User.findById(userId);
        if (!targetUser) return;
        if (action === 'ban') {
            targetUser.isBanned = !targetUser.isBanned;
            if (targetUser.isBanned) {
                for (let [sockId, name] of Object.entries(activeSockets)) {
                    if (name === targetUser.username) {
                        io.to(sockId).emit('auth-error', 'ВЫ БЫЛИ ЗАБАНЕНЫ АДМИНИСТРАТОРОМ');
                        io.sockets.sockets.get(sockId)?.disconnect();
                    }
                }
            }
        } else if (action === 'promote') {
            targetUser.isAdmin = !targetUser.isAdmin;
        } else if (action === 'nitro') {
            targetUser.isNitro = !targetUser.isNitro;
        }
        await targetUser.save();
        socket.emit('admin-action-success'); 
    });

    socket.on('admin-clear-chat', async () => {
         const username = activeSockets[socket.id];
         const user = await User.findOne({ username });
         if(user.isAdmin) {
             await Message.deleteMany({});
             io.emit('clear-chat');
         }
    });
    
    socket.on('admin-give-stars', async () => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({ username });
        if(user.isAdmin) {
            user.stars += 1000; await user.save();
            socket.emit('update-user', user);
        }
    });

    socket.on('disconnect', () => {
        delete activeSockets[socket.id];
        io.emit('update-online', Object.keys(activeSockets).length);
    });
});

function formatMsg(m) {
    if(!m) return null;
    return {
        id: m._id.toString(),
        channelId: m.channelId,
        username: m.username,
        type: m.type,
        text: m.text,
        image: m.image,
        replyTo: m.replyTo,
        isEdited: m.isEdited,
        isNitro: m.isNitro,
        isAdmin: m.isAdmin,
        userColor: m.userColor,
        avatarUrl: m.avatarUrl,
        time: m.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
