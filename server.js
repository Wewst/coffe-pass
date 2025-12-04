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
      await pool.query(
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
      );
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
