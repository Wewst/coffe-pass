require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: '*', // В продакшене укажите домены Telegram
  credentials: true
}));
app.use(express.json());

// Логирование с именем пользователя Telegram
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// Database connection для Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Проверка подключения
pool.on('connect', () => {
  console.log('✅ Подключено к PostgreSQL на Railway');
});

// Автоматическое создание таблиц
async function initDatabase() {
  console.log('🔄 Инициализация базы данных...');
  
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username VARCHAR(255),
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255),
      language_code VARCHAR(10),
      is_premium BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

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

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      subscription_id INTEGER REFERENCES subscriptions(id),
      amount INTEGER NOT NULL,
      cups_added INTEGER NOT NULL,
      status VARCHAR(20) DEFAULT 'completed',
      payment_method VARCHAR(50),
      transaction_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS codes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      code VARCHAR(20) UNIQUE NOT NULL,
      is_used BOOLEAN DEFAULT false,
      used_at TIMESTAMP,
      partner_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

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
  `;

  try {
    await pool.query(sql);
    console.log('✅ Таблицы созданы/проверены');
    
    const result = await pool.query('SELECT COUNT(*) FROM partners');
    console.log(`📊 Партнеров в базе: ${result.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Ошибка создания таблиц:', error.message);
  }
}

// Остальные функции (авторизация, покупки и т.д.)
// ... [ваш существующий код API] ...

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      service: 'CoffeePass Backend',
      database: 'connected',
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      error: error.message 
    });
  }
});

// Получение партнеров
app.get('/api/partners', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM partners WHERE is_active = true ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Запуск сервера
async function startServer() {
  await initDatabase();
  
  app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🔗 Health check: /api/health`);
    console.log(`💰 Railway Credits: $5/month free`);
  });
}

startServer();
