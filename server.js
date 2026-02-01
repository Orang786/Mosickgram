//require('dotenv').config();
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

// === ПОДКЛЮЧЕНИЕ К MONGODB ===
// Берем ссылку из переменных окружения (на Render) или используем локальную строку
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://OrangLaut:HWyWKxTP8pZGwzWT@mosickgram.jpqqle6.mongodb.net/?appName=Mosickgram';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// === СХЕМЫ БАЗЫ ДАННЫХ ===
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    stars: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    isNitro: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    color: String,
    avatarUrl: String,
    joinedAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
    channelId: { type: String, default: 'global' },
    username: String,
    type: String, // 'user', 'image', 'system'
    text: String,
    image: String,
    replyTo: Object,
    isEdited: { type: Boolean, default: false },
    userColor: String,
    isAdmin: Boolean,
    isNitro: Boolean,
    avatarUrl: String,
    timestamp: { type: Date, default: Date.now }
});

const ChannelSchema = new mongoose.Schema({
    channelId: { type: String, unique: true },
    name: String,
    desc: String,
    pinnedMessageId: String // ID сообщения
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const Channel = mongoose.model('Channel', ChannelSchema);

// Создаем дефолтный канал при старте, если нет
async function initDB() {
    const globalChan = await Channel.findOne({ channelId: 'global' });
    if (!globalChan) {
        await new Channel({ channelId: 'global', name: 'Global Chat', desc: 'Главный сервер' }).save();
    }
}
initDB();

let activeSockets = {}; // socket.id -> username (Кэш онлайна)

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
                const isAdmin = username.toLowerCase() === 'admin';

                const newUser = new User({
                    username,
                    password: hashedPassword,
                    stars: isAdmin ? 999999 : 0,
                    isAdmin, isNitro: isAdmin,
                    color: '#' + Math.floor(Math.random()*16777215).toString(16)
                });
                await newUser.save();
                loginUser(socket, newUser);

            } else {
                const user = await User.findOne({ username });
                if (!user) return socket.emit('auth-error', 'Пользователь не найден');
                
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) return socket.emit('auth-error', 'Неверный пароль');
                if (user.isBanned) return socket.emit('auth-error', 'ВЫ ЗАБАНЕНЫ');

                loginUser(socket, user);
            }
        } catch (e) {
            console.error(e);
        }
    });

    async function loginUser(socket, user) {
        activeSockets[socket.id] = user.username;
        socket.emit('login-success', user);
        
        // Загружаем каналы
        const channels = await Channel.find();
        // Преобразуем массив в объект для клиента {id: {name...}}
        const channelsData = {};
        channels.forEach(c => channelsData[c.channelId] = { name: c.name, desc: c.desc, pinnedId: c.pinnedMessageId });
        socket.emit('update-channels', channelsData);

        joinChannel(socket, 'global');
        io.emit('update-online', Object.keys(activeSockets).length);
    }

    // === КАНАЛЫ ===
    socket.on('create-channel', async (name) => {
        const username = activeSockets[socket.id];
        if (!username) return;
        
        const id = 'chan-' + Date.now();
        await new Channel({ channelId: id, name, desc: `Создал: ${username}` }).save();
        
        // Обновляем список у всех
        const channels = await Channel.find();
        const channelsData = {};
        channels.forEach(c => channelsData[c.channelId] = { name: c.name, desc: c.desc });
        io.emit('update-channels', channelsData);
    });

    socket.on('join-channel', (id) => joinChannel(socket, id));

    async function joinChannel(socket, channelId) {
        // Выход из прошлых
        socket.rooms.forEach(room => { if(room !== socket.id) socket.leave(room); });
        socket.join(channelId);
        
        // Грузим последние 50 сообщений
        const msgs = await Message.find({ channelId }).sort({ timestamp: 1 }).limit(100);
        
        // Преобразуем для клиента (форматируем время и id)
        const clientMsgs = msgs.map(m => formatMsg(m));
        
        socket.emit('load-messages', clientMsgs);
        socket.emit('set-active-channel', channelId);

        // Закреп
        const channel = await Channel.findOne({ channelId });
        if(channel && channel.pinnedMessageId) {
            const pinnedMsg = await Message.findById(channel.pinnedMessageId);
            if(pinnedMsg) socket.emit('update-pinned', formatMsg(pinnedMsg));
        } else {
            socket.emit('update-pinned', null);
        }
    }

    // === СООБЩЕНИЯ ===
    socket.on('send-message', async (data) => {
        const username = activeSockets[socket.id];
        if (!username) return;

        const user = await User.findOne({ username });
        if (user.isBanned) return;

        if (data.text && data.text.startsWith('/')) return handleCommand(socket, user, data.text);

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

    // === УДАЛЕНИЕ И РЕДАКТИРОВАНИЕ ===
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

    // === PIN ===
    socket.on('pin-message', async (id) => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({username});
        if(!user || !user.isAdmin) return;

        const msg = await Message.findById(id);
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
         if(room) {
             await Channel.findOneAndUpdate({ channelId: room }, { pinnedMessageId: null });
             io.to(room).emit('update-pinned', null);
         }
    });

    // === ПРОЧЕЕ ===
    socket.on('typing', () => {
        const u = activeSockets[socket.id];
        if(u) socket.broadcast.emit('display-typing', u);
    });

    socket.on('change-avatar', async (url) => {
        const username = activeSockets[socket.id];
        await User.findOneAndUpdate({ username }, { avatarUrl: url });
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

    socket.on('admin-give-stars', async () => {
        const username = activeSockets[socket.id];
        const user = await User.findOne({ username });
        if(user.isAdmin) {
            user.stars += 1000; await user.save();
            socket.emit('update-user', user);
        }
    });
    
    socket.on('admin-clear-chat', async () => {
         const username = activeSockets[socket.id];
         const user = await User.findOne({ username });
         if(user.isAdmin) {
             await Message.deleteMany({}); // Удаляет ВСЕ сообщения
             io.emit('clear-chat');
         }
    });

    socket.on('disconnect', () => {
        delete activeSockets[socket.id];
        io.emit('update-online', Object.keys(activeSockets).length);
    });
});

// Форматирование для клиента (MongoDB использует _id, а клиент ждет id)
function formatMsg(m) {
    if(!m) return null;
    return {
        id: m._id.toString(), // Конвертируем Mongo ID в строку
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

async function handleCommand(socket, user, text) {
    if (!user.isAdmin) return;
    const [cmd, target] = text.split(' ');
    if (cmd === '/ban' && target) {
        await User.findOneAndUpdate({ username: target }, { isBanned: true });
        io.emit('message', { type: 'system', text: `⛔ ${target} забанен.` });
    }
    if (cmd === '/unban' && target) {
        await User.findOneAndUpdate({ username: target }, { isBanned: false });
    }
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => console.log('Server running on port ' + PORT));

