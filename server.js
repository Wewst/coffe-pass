const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

// Простой health check СРАЗУ
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Подключаемся к БД
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ПАРТНЕРЫ (статические)
app.get('/api/partners', (req, res) => {
  res.json([
    { id: 1, name: 'Кофейня на Набережной', address: 'ул. Набережная, 12' },
    { id: 2, name: 'Teatral Coffee', address: 'ул. Театральная, 5' },
    { id: 3, name: 'Горка Кофе', address: 'пл. Ворота, 1' },
    { id: 4, name: 'Кофе и Пермь', address: 'ул. Ленина, 44' }
  ]);
});

// Запуск сервера СРАЗУ
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(✅ Сервер запущен на порту ${PORT});
  console.log(🌐 Health: http://0.0.0.0:${PORT}/health);
  
  // Инициализация БД в фоне (после запуска)
  setTimeout(async () => {
    try {
      console.log('🔄 Инициализация БД в фоне...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          telegram_id BIGINT UNIQUE NOT NULL,
          first_name VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS subscriptions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          cups_remaining INTEGER DEFAULT 12,
          month VARCHAR(7),
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          amount INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS codes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          code VARCHAR(20) UNIQUE NOT NULL,
          partner_name VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log('✅ Таблицы созданы');
    } catch (err) {
      console.log('⚠️ Ошибка БД (но сервер работает):', err.message);
    }
  }, 5000); // Ждем 5 секунд после запуска
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM получен');
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT  10000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS для фронтенда и Telegram
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Подключаемся к БД
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

console.log('✅ Подключение к PostgreSQL...');

// ============ СОЗДАНИЕ ТАБЛИЦ ============
async function initDatabase() {
  try {
    console.log('🔄 Создаем таблицы...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255),
        language_code VARCHAR(10),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        cups_total INTEGER DEFAULT 12,
        cups_remaining INTEGER DEFAULT 12,
        is_active BOOLEAN DEFAULT true,
        price_paid INTEGER DEFAULT 2000,
        month VARCHAR(7),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subscription_id INTEGER REFERENCES subscriptions(id),
        amount INTEGER NOT NULL,
        cups_added INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        code VARCHAR(20) UNIQUE NOT NULL,
        is_used BOOLEAN DEFAULT false,
        used_at TIMESTAMP,
        partner_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partners (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        address VARCHAR(500),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      INSERT INTO partners (name, description, address) VALUES
        ('Кофейня на Набережной', 'Уют у Камской набережной', 'ул. Набережная, 12'),
        ('Teatral Coffee', 'Рядом с театром', 'ул. Театральная, 5'),
        ('Горка Кофе', 'Терраса у памятника', 'пл. Ворота, 1'),
        ('Кофе и Пермь', 'Классика в центре', 'ул. Ленина, 44')
      ON CONFLICT (name) DO NOTHING;
    `);
    
    console.log('✅ Все таблицы созданы');
    
    // Проверяем партнеров
    const partnersResult = await pool.query('SELECT COUNT(*) as count FROM partners');
    console.log('📊 Партнеров в базе: ' + partnersResult.rows[0].count);
    
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error.message);
  }
}

// ============ API РОУТЫ ============

// 1. Health Check
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Партнеры
app.get('/api/partners', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM partners WHERE is_active = true ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res

.status(500).json({ error: error.message });
  }
});

// 3. АВТОРИЗАЦИЯ TELEGRAM (РАБОЧАЯ)
app.post('/api/auth/telegram', async (req, res) => {
  try {
    console.log('🔑 Получен запрос на авторизацию');
    
    const { initData } = req.body;
    
    if (!initData) {
      return res.status(400).json({ error: 'Нет данных от Telegram' });
    }
    
    let userData;
    
    // Telegram WebApp отправляет данные в формате query string
    // Например: user={"id":123,"first_name":"Ivan"...}&auth_date=...
    if (initData.includes('user=')) {
      const userMatch = initData.match(/user=([^&]*)/);
      if (userMatch && userMatch[1]) {
        try {
          userData = JSON.parse(decodeURIComponent(userMatch[1]));
        } catch (e) {
          console.log('Ошибка парсинга user:', e);
        }
      }
    } 
    // Или если фронтенд отправил уже распарсенный объект
    else if (typeof initData === 'object') {
      userData = initData;
    }
    // Или если это JSON строка
    else if (initData.startsWith('{')) {
      try {
        userData = JSON.parse(initData);
      } catch (e) {
        console.log('Ошибка парсинга JSON:', e);
      }
    }
    
    // Если не получили данные, создаем тестовые
    if (!userData  !userData.id) {
      userData = {
        id: Date.now(),
        first_name: 'Telegram User',
        username: 'telegram_user',
        language_code: 'ru'
      };
      console.log('⚠️ Используем тестовые данные');
    }
    
    console.log('👤 Telegram пользователь: ' + userData.first_name + ' (ID: ' + userData.id + ')');
    
    // Находим или создаем пользователя в БД
    let user;
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [userData.id]
    );
    
    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];
      console.log('👋 Существующий пользователь: ' + user.first_name);
    } else {
      // СОЗДАЕМ НОВОГО ПОЛЬЗОВАТЕЛЯ В БАЗУ!
      const newUser = await pool.query(
        `INSERT INTO users (telegram_id, username, first_name, last_name, language_code) 
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          userData.id,
          userData.username  '',
          userData.first_name  'User',
          userData.last_name  '',
          userData.language_code  'ru'
        ]
      );
      user = newUser.rows[0];
      console.log('✅ СОЗДАН НОВЫЙ ПОЛЬЗОВАТЕЛЬ: ' + user.first_name + ' (ID: ' + user.id + ')');
      
      // Создаем начальную подписку
      const currentMonth = new Date().toISOString().slice(0, 7);
      await pool.query(
        `INSERT INTO subscriptions (user_id, cups_remaining, month) 
         VALUES ($1, $2, $3)`,
        [user.id, 0, currentMonth]
      );
    }
    
    // Простой токен (user_id:telegram_id в base64)
    const token = Buffer.from(user.id + ':' + user.telegram_id).toString('base64');
    
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка авторизации:', error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка авторизации в Telegram'
    });
  }
});

// 4. ПОЛУЧИТЬ СОСТОЯНИЕ ПОЛЬЗОВАТЕЛЯ
app.get('/api/user/state', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Нет токена' });
    
    const token = authHeader.split(' ')[1];
    const decoded = Buffer.from(token, 'base64').toString();
    const [userId, telegramId] = decoded.split(':');
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    // Находим пользователя
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND telegram_id = $2',
      [userId, telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    
    // Находим активную подписку
    const subscriptionResult = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 AND is_active = true AND month = $2`,
      [user.id, currentMonth]
    );
    
    let state = {
      purchased: false,
      remaining: 0,
      month: currentMonth,
      user: { id: user.id, first_name: user.first_name }
    };
    
    if (subscriptionResult.rows.length > 0) {
      const sub = subscriptionResult.rows[0];
      state.purchased = true;
      state.remaining = sub.cups_remaining;
      state.subscription = sub;
    }
    
    // Получаем партнеров
    const partnersResult = await pool.query('SELECT * FROM partners WHERE is_active = true');
    state.partners = partnersResult.rows;
    
    res.json(state);
    
  } catch (error) {
    console.error('❌ Ошибка получения состояния:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

// 5. ПОКУПКА
app.post('/api/purchase', async (req, res) => {
  try {
    const { cups, token } = req.body;
    console.log('💰 Покупка: ' + cups + ' чашек');
    
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    
    const decoded = Buffer.from(token, 'base64').toString();
    const [userId, telegramId] = decoded.split(':');
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    const pricePerCup = 167;
    const totalPrice = Math.round(pricePerCup * cups);
    
    // Обновляем подписку
    await pool.query(
      `UPDATE subscriptions 
       SET cups_remaining = cups_remaining + $1, 
           updated_at = NOW(),
           is_active = true
       WHERE user_id = $2 AND month = $3`,
      [cups, userId, currentMonth]
    );
    
    // СОХРАНЯЕМ ПЛАТЕЖ В БАЗУ
    const paymentResult = await pool.query(
      `INSERT INTO payments (user_id, amount, cups_added, status) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, totalPrice, cups, 'completed']
    );
    
    console.log('✅ Платеж сохранен: ID ' + paymentResult.rows[0].id);
    
    res.json({
      success: true,
      message: 'Оплачено ' + cups + ' чашек',
      payment_id: paymentResult.rows[0].id
    });
    
  } catch (error) {
    console.error('❌ Ошибка покупки:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Генерация кода
app.post('/api/codes/generate', async (req, res) => {
  try {
    const { partner_name, token } = req.body;
    
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    
    const decoded = Buffer.from(token, 'base64').toString();
    const [userId, telegramId] = decoded.split(':');
    
    // Генерируем код
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code;
    let isUnique = false;
    
    while (!isUnique) {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const check = await pool.query('SELECT id FROM codes WHERE code = $1', [code]);
      isUnique = check.rows.length === 0;
    }
    
    // СОХРАНЯЕМ КОД В БАЗУ
    const codeResult = await pool.query(
      `INSERT INTO codes (user_id, code, partner_name) 
       VALUES ($1, $2, $3) RETURNING *`,
      [userId, code, partner_name]
    );

console.log('✅ Код сохранен: ' + code);
    
    // Уменьшаем счетчик чашек
    const currentMonth = new Date().toISOString().slice(0, 7);
    await pool.query(
      `UPDATE subscriptions 
       SET cups_remaining = cups_remaining - 1 
       WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    res.json({
      success: true,
      code: code
    });
    
  } catch (error) {
    console.error('❌ Ошибка генерации кода:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ЗАПУСК СЕРВЕРА ============
async function startServer() {
  try {
    await initDatabase();
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('🚀 Сервер запущен на порту ' + PORT);
      console.log('🌐 URL: https://coffe-pass-production.up.railway.app');
      console.log('✅ Готов к работе!');
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 Получен SIGTERM');
      server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error('❌ Ошибка запуска:', error);
    process.exit(1);
  }
}

startServer();
