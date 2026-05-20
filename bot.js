const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const express = require('express');

// ========== ВЕБ-СЕРВЕР ДЛЯ ПИНГОВ (чтобы бот не засыпал) ==========
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is alive!');
});

app.get('/keep-alive', (req, res) => {
    res.send('Still alive!');
});

app.listen(PORT, () => {
    console.log(`✅ Keep-alive server running on port ${PORT}`);
});

// ========== DISCORD БОТ ==========
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages
    ]
});

// Токен берётся из переменной окружения (БЕЗОПАСНО!)
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error('❌ ОШИБКА: Токен не найден! Добавьте переменную окружения DISCORD_TOKEN');
    process.exit(1);
}

// Папки для звуков
const SOUNDS_DIR = path.join(__dirname, 'sounds');
const AUDIO_DIR = path.join(SOUNDS_DIR, 'audio');

// Создаём папки если их нет
if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ========== ФУНКЦИИ ДЛЯ РАБОТЫ СО ЗВУКАМИ ==========
function getUserSound(userId) {
    const configPath = path.join(SOUNDS_DIR, `user_${userId}.json`);
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return config.soundFile;
        } catch (e) {
            console.error(`Ошибка чтения файла ${userId}:`, e);
            return null;
        }
    }
    return null;
}

function setUserSound(userId, soundFile) {
    const configPath = path.join(SOUNDS_DIR, `user_${userId}.json`);
    fs.writeFileSync(configPath, JSON.stringify({ soundFile, updatedAt: new Date().toISOString() }));
}

function removeUserSound(userId) {
    const configPath = path.join(SOUNDS_DIR, `user_${userId}.json`);
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
}

function getAllSounds() {
    if (!fs.existsSync(AUDIO_DIR)) return [];
    const files = fs.readdirSync(AUDIO_DIR);
    return files.filter(f => /\.(mp3|wav|ogg|flac)$/i.test(f));
}

function getSoundPath(userId) {
    const soundFile = getUserSound(userId);
    if (soundFile) {
        const customPath = path.join(AUDIO_DIR, soundFile);
        if (fs.existsSync(customPath)) return customPath;
    }
    const defaultPath = path.join(AUDIO_DIR, 'default.mp3');
    return fs.existsSync(defaultPath) ? defaultPath : null;
}

// ========== ВОСПРОИЗВЕДЕНИЕ ЗВУКА ==========
async function playSound(guild, channelId, soundPath) {
    try {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) return;
        
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
        });
        
        const player = createAudioPlayer();
        const resource = createAudioResource(soundPath);
        
        player.play(resource);
        connection.subscribe(player);
        
        player.on(AudioPlayerStatus.Idle, () => {
            connection.destroy();
        });
        
        player.on('error', error => {
            console.error('Ошибка воспроизведения:', error);
            connection.destroy();
        });
    } catch (error) {
        console.error('Ошибка подключения к голосовому каналу:', error);
    }
}

// ========== ОБРАБОТКА ВХОДА В ГОЛОСОВОЙ КАНАЛ ==========
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const userId = newState.member.id;
    
    if (!oldState.channelId && newState.channelId) {
        console.log(`🔊 ${newState.member.user.tag} зашёл в ${newState.channel.name}`);
        
        const soundPath = getSoundPath(userId);
        if (soundPath) {
            console.log(`🎵 Играю звук для ${userId}: ${path.basename(soundPath)}`);
            await playSound(newState.guild, newState.channelId, soundPath);
        } else {
            console.log(`⚠️ Нет звука для ${userId} и нет default.mp3`);
        }
    }
});

// ========== КОМАНДЫ ==========
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    
    const args = message.content.split(' ');
    const cmd = args[0].toLowerCase();
    
    // Тестовая команда
    if (cmd === '!test') {
        await message.reply('✅ Бот работает!');
        console.log(`!test от ${message.author.tag}`);
    }
    
    // Список доступных звуков
    if (cmd === '!listsounds') {
        const sounds = getAllSounds();
        if (sounds.length === 0) {
            return message.reply('📁 Нет звуков в папке `sounds/audio/`. Добавьте .mp3 файлы через GitHub.');
        }
        const current = getUserSound(message.author.id) || 'default.mp3 (или нет)';
        await message.reply(`**Доступные звуки:**\n${sounds.map(s => `• ${s}`).join('\n')}\n\n🎵 Ваш звук: ${current}\n\n\`!setsound имя.mp3\` - установить себе\n\`!removesound\` - сбросить`);
    }
    
    // Установить звук себе
    if (cmd === '!setsound') {
        const fileName = args[1];
        if (!fileName) return message.reply('❌ Укажите имя файла. Пример: `!setsound my_sound.mp3`');
        
        const soundPath = path.join(AUDIO_DIR, fileName);
        if (!fs.existsSync(soundPath)) return message.reply(`❌ Файл "${fileName}" не найден. Используйте \`!listsounds\` чтобы увидеть доступные звуки.`);
        
        setUserSound(message.author.id, fileName);
        await message.reply(`✅ Установлен звук: **${fileName}**`);
    }
    
    // Удалить свой звук
    if (cmd === '!removesound') {
        removeUserSound(message.author.id);
        await message.reply(`✅ Ваш звук удалён. Будет играть default.mp3 (если есть)`);
    }
    
    // Узнать свой звук
    if (cmd === '!mysound') {
        const sound = getUserSound(message.author.id);
        if (sound) await message.reply(`🎵 Ваш звук: **${sound}**`);
        else await message.reply(`🎵 У вас нет индивидуального звука. Будет default.mp3`);
    }
    
    // ========== АДМИН-КОМАНДЫ ==========
    
    // Выдать звук другому пользователю
    if (cmd === '!setsoundfor') {
        if (!message.member.permissions.has('Administrator')) {
            return message.reply('❌ У вас нет прав администратора!');
        }
        
        const targetUser = message.mentions.users.first();
        const fileName = args[2];
        
        if (!targetUser) {
            return message.reply('❌ Укажите пользователя: `!setsoundfor @пользователь звук.mp3`');
        }
        
        if (!fileName) {
            return message.reply('❌ Укажите звук: `!setsoundfor @пользователь звук.mp3`');
        }
        
        const soundPath = path.join(AUDIO_DIR, fileName);
        if (!fs.existsSync(soundPath)) {
            return message.reply(`❌ Файл "${fileName}" не найден. Список звуков: \`!listsounds\``);
        }
        
        setUserSound(targetUser.id, fileName);
        await message.reply(`✅ Пользователю **${targetUser.tag}** назначен звук: **${fileName}**`);
    }
    
    // Удалить звук у другого пользователя
    if (cmd === '!removesoundfor') {
        if (!message.member.permissions.has('Administrator')) {
            return message.reply('❌ У вас нет прав администратора!');
        }
        
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.reply('❌ Укажите пользователя: `!removesoundfor @пользователь`');
        }
        
        removeUserSound(targetUser.id);
        await message.reply(`✅ У пользователя **${targetUser.tag}** удалён звук (будет default.mp3)`);
    }
    
    // Показать всех пользователей с настроенными звуками
    if (cmd === '!usersounds') {
        if (!message.member.permissions.has('Administrator')) {
            return message.reply('❌ У вас нет прав администратора!');
        }
        
        const files = fs.readdirSync(SOUNDS_DIR);
        const userFiles = files.filter(f => f.startsWith('user_') && f.endsWith('.json'));
        
        if (userFiles.length === 0) {
            return message.reply('📋 Ни у кого нет настроенного звука');
        }
        
        let result = '**📋 Пользователи с настроенными звуками:**\n';
        for (const file of userFiles) {
            const userId = file.replace('user_', '').replace('.json', '');
            const config = JSON.parse(fs.readFileSync(path.join(SOUNDS_DIR, file), 'utf8'));
            
            try {
                const user = await client.users.fetch(userId);
                result += `• ${user.tag}: **${config.soundFile}**\n`;
            } catch(e) {
                result += `• ${userId}: **${config.soundFile}**\n`;
            }
        }
        await message.reply(result);
    }
});

// ========== ЗАПУСК БОТА ==========
client.once('ready', () => {
    console.log(`✅ Бот запущен как ${client.user.tag}`);
    console.log(`📁 Звуки должны лежать в: ${AUDIO_DIR}`);
    console.log(`🎵 Доступно звуков: ${getAllSounds().length}`);
    console.log(`💡 Команды: !test, !listsounds, !setsound, !removesound, !mysound`);
    console.log(`👑 Админ-команды: !setsoundfor @user, !removesoundfor @user, !usersounds`);
});

client.login(TOKEN);