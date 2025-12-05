const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

console.log('Подключение к PostgreSQL...');

// Создание таблиц
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        cups_remaining INTEGER DEFAULT 0,
        month VARCHAR(7),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        amount INTEGER NOT NULL,
        cups_added INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        code VARCHAR(20) UNIQUE NOT NULL,
        partner_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partners (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        address VARCHAR(500)
      );
      
      INSERT INTO partners (name, address) VALUES
        ('Кофейня на Набережной', 'ул. Набережная, 12'),
        ('Teatral Coffee', 'ул. Театральная, 5'),
        ('Горка Кофе', 'пл. Ворота, 1'),
        ('Кофе и Пермь', 'ул. Ленина, 44')
      ON CONFLICT (name) DO NOTHING;
    `);
    
    console.log('Таблицы созданы');
    
  } catch (error) {
    console.log('Ошибка создания таблиц:', error.message);
  }
}

// Генерация токена
function generateToken(userId, telegramId) {
  return Buffer.from(`${userId}:${telegramId}`).toString('base64');
}

// Health Check
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Партнеры
app.get('/api/partners', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM partners ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Авторизация Telegram - ПРОСТО И РАБОЧЕ
app.post('/api/auth/telegram', async (req, res) => {
  try {
    console.log('Получены данные от клиента:', req.body);
    
    // Получаем данные пользователя
    const { telegramUser } = req.body;
    
    if (!telegramUser || !telegramUser.id) {
      return res.status(400).json({ success: false, error: 'Нет данных пользователя' });
    }
    
    console.log('Telegram пользователь:', telegramUser);
    
    // Находим или создаем пользователя
    let user;
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramUser.id]
    );
    
    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];
      console.log('Найден существующий пользователь:', user.first_name);
    } else {
      // СОЗДАЕМ НОВОГО ПОЛЬЗОВАТЕЛЯ С ДАННЫМИ ИЗ TELEGRAM
      const newUser = await pool.query(
        `INSERT INTO users (telegram_id, username, first_name, last_name) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [
          telegramUser.id,
          telegramUser.username || '',
          telegramUser.first_name,
          telegramUser.last_name || ''
        ]
      );
      user = newUser.rows[0];
      console.log('Создан новый пользователь:', user.first_name);
      
      // Создаем подписку
      const currentMonth = new Date().toISOString().slice(0, 7);
      await pool.query(
        `INSERT INTO subscriptions (user_id, cups_remaining, month) 
         VALUES ($1, $2, $3)`,
        [user.id, 0, currentMonth]
      );
    }
    
    // Генерируем токен
    const token = generateToken(user.id, user.telegram_id);
    
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name
      }
    });
    
  } catch (error) {
    console.log('Ошибка авторизации:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// Получить состояние пользователя
app.get('/api/user/state', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Нет токена' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = Buffer.from(token, 'base64').toString();
    const [userId, telegramId] = decoded.split(':');
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    // Получаем пользователя
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND telegram_id = $2',
      [userId, telegramId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const user = userResult.rows[0];
    
    // Находим подписку
    const subscriptionResult = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE user_id = $1 AND month = $2`,
      [user.id, currentMonth]
    );
    
    let subscription = subscriptionResult.rows[0];
    if (!subscription) {
      // Создаем подписку
      await pool.query(
        `INSERT INTO subscriptions (user_id, cups_remaining, month) 
         VALUES ($1, $2, $3)`,
        [user.id, 0, currentMonth]
      );
      subscription = { cups_remaining: 0, month: currentMonth };
    }
    
    // Получаем партнеров
    const partnersResult = await pool.query('SELECT * FROM partners');
    
    res.json({
      purchased: subscription.cups_remaining > 0,
      remaining: subscription.cups_remaining,
      month: subscription.month,
      partners: partnersResult.rows,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        first_name: user.first_name,
        username: user.username
      }
    });
    
  } catch (error) {
    console.log('Ошибка получения состояния:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

// Покупка
app.post('/api/purchase', async (req, res) => {
  try {
    const { cups } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Нет токена' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = Buffer.from(token, 'base64').toString();
    const [userId, telegramId] = decoded.split(':');
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    const totalPrice = Math.round(167 * cups);
    
    // Обновляем подписку
    await pool.query(
      `UPDATE subscriptions 
       SET cups_remaining = cups_remaining + $1
       WHERE user_id = $2 AND month = $3`,
      [cups, userId, currentMonth]
    );
    
    // Сохраняем платеж
    await pool.query(
      `INSERT INTO payments (user_id, amount, cups_added) 
       VALUES ($1, $2, $3)`,
      [userId, totalPrice, cups]
    );
    
    // Получаем обновленное количество
    const updatedResult = await pool.query(
      `SELECT cups_remaining FROM subscriptions 
       WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    res.json({
      success: true,
      remaining: updatedResult.rows[0].cups_remaining
    });
    
  } catch (error) {
    console.log('Ошибка покупки:', error);
    res.status(500).json({ error: error.message });
  }
});

// Генерация кода
app.post('/api/codes/generate', async (req, res) => {
  try {
    const { partner_name } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Нет токена' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = Buffer.from(token, 'base64').toString();
    const [userId, telegramId] = decoded.split(':');
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    // Генерируем код
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code;
    
    while (true) {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const check = await pool.query('SELECT id FROM codes WHERE code = $1', [code]);
      if (check.rows.length === 0) break;
    }
    
    // Сохраняем код
    await pool.query(
      `INSERT INTO codes (user_id, code, partner_name) 
       VALUES ($1, $2, $3)`,
      [userId, code, partner_name]
    );
    
    // Уменьшаем чашки
    await pool.query(
      `UPDATE subscriptions 
       SET cups_remaining = cups_remaining - 1
       WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    // Получаем обновленное количество
    const updatedResult = await pool.query(
      `SELECT cups_remaining FROM subscriptions 
       WHERE user_id = $1 AND month = $2`,
      [userId, currentMonth]
    );
    
    res.json({
      success: true,
      code: code,
      remaining: updatedResult.rows[0].cups_remaining
    });
    
  } catch (error) {
    console.log('Ошибка генерации кода:', error);
    res.status(500).json({ error: error.message });
  }
});

// История
app.get('/api/history', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Нет токена' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = Buffer.from(token, 'base64').toString();
    const [userId, telegramId] = decoded.split(':');
    
    // Коды
    const codesResult = await pool.query(
      `SELECT * FROM codes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );
    
    // Платежи
    const paymentsResult = await pool.query(
      `SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );
    
    res.json({
      codes: codesResult.rows,
      payments: paymentsResult.rows
    });
    
  } catch (error) {
    console.log('Ошибка получения истории:', error);
    res.status(500).json({ error: error.message });
  }
});

// Запуск сервера
async function startServer() {
  try {
    await initDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log('Сервер запущен на порту ' + PORT);
    });
    
  } catch (error) {
    console.log('Ошибка запуска:', error);
  }
}

startServer();
