<script>
(function(){
  'use strict';
  
  // ============ DOM SELECTORS ============
  const $ = s => document.querySelector(s);
  
  const fx = $('#fx');
  const splash = $('#splash');
  const splashLogo = $('#splashLogo');
  const partnersBtn = $('#partnersBtn');
  const partnersList = $('#partnersList');
  const partnersPanel = partnersList ? partnersList.querySelector('.panel') : null;
  const historyBtn = $('#historyBtn');
  const buyBtn = $('#buyBtn');
  const prePurchaseArea = $('#prePurchaseArea');
  const postPurchaseArea = $('#postPurchaseArea');
  const usedArea = $('#usedArea');
  const cupCountEl = $('#cupCount');
  const openCodeBtn = $('#openCodeBtn');
  const cupSvg = $('#cupSvg');
  const returnPurchaseBtn = $('#returnPurchaseBtn');
  const buyAgainBtn = $('#buyAgainBtn');
  
  const overlay = $('#overlay');
  const popup = $('#popup');
  const popupContent = $('#popupContent');
  const popupActions = $('#popupActions');
  const popupClose = $('#popupClose');
  
  // ============ CONFIGURATION ============
  const API_BASE_URL = 'https://coffeepass-production.up.railway.app';
  const MAX_CUPS = 12;
  const SUBSCRIPTION_PRICE = 2000;
  
  // State
  let state = {
    purchased: false,
    remaining: 0,
    month: null,
    subscription: null,
    partners: []
  };
  
  let user = null;
  let token = null;
  let tg = window.Telegram?.WebApp;
  
  // ============ VISUAL EFFECTS ============
  
  function createBeans() {
    for(let i = 0; i < 9; i++) {
      const b = document.createElement('div');
      b.className = 'bean';
      const left = Math.random() * 100;
      const dur = 8000 + Math.random() * 12000;
      b.style.left = left + 'vw';
      b.style.width = (10 + Math.random() * 24) + 'px';
      b.style.height = (8 + Math.random() * 16) + 'px';
      b.style.background = 'rgba(255,255,255,' + (0.04 + Math.random() * 0.1) + ')';
      b.style.borderRadius = (8 + Math.random() * 10) + 'px / 6px';
      b.style.animationDuration = dur + 'ms';
      b.style.animationDelay = (-Math.random() * dur) + 'ms';
      b.style.animationTimingFunction = 'cubic-bezier(.22,1.0,.36,1.0)';
      fx.appendChild(b);
    }
  }
  
  function haptic(name) {
    try {
      if (tg && tg.HapticFeedback) {
        switch(name) {
          case 'strong': tg.HapticFeedback.impactOccurred('heavy'); break;
          case 'confirm': tg.HapticFeedback.notificationOccurred('success'); break;
          case 'splash': tg.HapticFeedback.impactOccurred('medium'); break;
          default: tg.HapticFeedback.selectionChanged();
        }
      }
    } catch(e) {}
  }
  
  // ============ TELEGRAM WEBAPP INTEGRATION ============
  
  // Получаем данные Telegram пользователя
  function getTelegramUserData() {
    if (!tg) {
      console.log('⚠️ Не в Telegram WebApp, используем тестовые данные');
      return {
        id: Math.floor(Math.random() * 1000000),
        first_name: 'Тестовый',
        username: 'testuser' + Date.now(),
        language_code: 'ru'
      };
    }
    
    try {
      // Инициализируем WebApp
      tg.ready();
      tg.expand();
      
      // Получаем данные пользователя
      const initData = tg.initData;
      const user = tg.initDataUnsafe.user;
      
      console.log('📱 Telegram WebApp данные:', {
        initData: initData?.substring(0, 100) + '...',
        user: user
      });
      
      if (user) {
        console.log('✅ Telegram пользователь найден:', user.first_name, '(ID:', user.id + ')');
        return user;
      } else {
        console.log('⚠️ Telegram пользователь не найден в initDataUnsafe');
        
        // Пробуем получить из initData строки
        if (initData) {
          const params = new URLSearchParams(initData);
          const userStr = params.get('user');
          if (userStr) {
            try {
              const parsedUser = JSON.parse(decodeURIComponent(userStr));
              console.log('✅ Пользователь из initData:', parsedUser);
              return parsedUser;
            } catch(e) {
              console.error('❌ Ошибка парсинга user из initData:', e);
            }
          }
        }
        
        return null;
      }
      
    } catch (error) {
      console.error('❌ Ошибка получения данных Telegram:', error);
      return null;
    }
  }
  
  // ============ API INTEGRATION ============
  
  async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    try {
      console.log(`📡 API Request: ${endpoint}`);
      const response = await fetch(url, {
        ...options,
        headers
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        console.error(`❌ API Error ${response.status}:`, data);
        throw new Error(data.error || `API Error ${response.status}`);
      }
      
      console.log(`✅ API Response:`, data);
      return data;
      
    } catch (error) {
      console.error('❌ API Request Error:', error);
      throw error;
    }
  }
  
  // Telegram authentication
  async function authenticateWithTelegram() {
    try {
      console.log('🔑 Начинаем авторизацию...');
      
      // Получаем данные пользователя из Telegram
      const telegramUser = getTelegramUserData();
      
      if (!telegramUser) {
        throw new Error('Не удалось получить данные Telegram');
      }
      
      // Получаем initData от Telegram WebApp
      let initData = '';
      if (tg && tg.initData) {
        initData = tg.initData;
      } else {
        // Если нет initData, создаем его из данных пользователя
        const userData = {
          id: telegramUser.id,
          first_name: telegramUser.first_name,
          username: telegramUser.username || '',
          language_code: telegramUser.language_code || 'ru'
        };
        initData = `user=${encodeURIComponent(JSON.stringify(userData))}&auth_date=${Math.floor(Date.now()/1000)}`;
      }
      
      console.log('📤 Отправляем данные на сервер...');
      const response = await apiRequest('/api/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData })
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Ошибка авторизации');
      }
      
      token = response.token;
      user = response.user;
      
      console.log(`✅ Авторизован: ${user.first_name} (ID: ${user.id}, Telegram ID: ${user.telegram_id})`);
      console.log(`🔐 Токен: ${token.substring(0, 30)}...`);
      
      // Сохраняем токен в localStorage для восстановления сессии
      localStorage.setItem('coffeepass_token', token);
      localStorage.setItem('coffeepass_user', JSON.stringify(user));
      
      // Загружаем состояние пользователя
      await loadUserState();
      
      return true;
      
    } catch (error) {
      console.error('❌ Ошибка авторизации:', error);
      
      // Пробуем восстановить сессию из localStorage
      const savedToken = localStorage.getItem('coffeepass_token');
      const savedUser = localStorage.getItem('coffeepass_user');
      
      if (savedToken && savedUser) {
        console.log('🔄 Восстанавливаем сессию из localStorage...');
        token = savedToken;
        user = JSON.parse(savedUser);
        await loadUserState();
        return true;
      }
      
      showPopup(
        `<div style="text-align:center">
          <h3 style="font-weight:900;margin-bottom:12px">Ошибка авторизации</h3>
          <p class="small-muted">Попробуйте обновить страницу</p>
        </div>`, 
        [{text:'Обновить', cls:'btn primary', cb: ()=>{ location.reload(); }}]
      );
      return false;
    }
  }
  
  // Load user state from server
  async function loadUserState() {
    try {
      console.log('🔄 Загружаем состояние пользователя...');
      const data = await apiRequest('/api/user/state');
      
      state = {
        purchased: data.purchased || false,
        remaining: data.remaining || 0,
        month: data.month,
        subscription: data.subscription,
        partners: data.partners || []
      };
      
      console.log('✅ Состояние загружено:', {
        purchased: state.purchased,
        remaining: state.remaining,
        month: state.month
      });
      
      // Сохраняем состояние в localStorage для быстрого восстановления
      localStorage.setItem('coffeepass_state', JSON.stringify(state));
      
      renderByState();
      
    } catch (error) {
      console.error('❌ Ошибка загрузки состояния:', error);
      
      // Если токен недействителен, пробуем переавторизоваться
      if (error.message.includes('401') || error.message.includes('токен') || error.message.includes('token')) {
        console.log('🔄 Токен устарел, пробуем переавторизоваться...');
        localStorage.removeItem('coffeepass_token');
        localStorage.removeItem('coffeepass_user');
        localStorage.removeItem('coffeepass_state');
        await authenticateWithTelegram();
      } else {
        // Используем сохраненное состояние
        const savedState = localStorage.getItem('coffeepass_state');
        if (savedState) {
          console.log('📂 Используем сохраненное состояние из localStorage');
          state = JSON.parse(savedState);
          renderByState();
        }
      }
    }
  }
  
  // Process purchase
  async function processPurchase(count) {
    try {
      console.log(`💰 Начинаем покупку ${count} чашек...`);
      
      const response = await apiRequest('/api/purchase', {
        method: 'POST',
        body: JSON.stringify({ cups: count })
      });
      
      if (response.success) {
        console.log(`✅ Покупка успешна:`, response);
        
        // Обновляем локальное состояние
        state.purchased = true;
        state.remaining = response.remaining || (state.remaining + count);
        if (response.subscription) {
          state.subscription = response.subscription;
        }
        
        // Сохраняем обновленное состояние
        localStorage.setItem('coffeepass_state', JSON.stringify(state));
        
        haptic('confirm');
        hidePopup();
        renderByState();
        
        // Показываем успешное сообщение
        showPopup(
          `<div style="text-align:center">
            <div style="font-size:48px;margin-bottom:16px">🎉</div>
            <div style="font-weight:900;font-size:20px;margin-bottom:12px">Оплачено успешно!</div>
            <div class="small-muted">
              Вы добавили <strong>${count}</strong> чашек.<br>
              Теперь доступно <strong style="color:var(--fg)">${state.remaining} чашек</strong>
            </div>
          </div>`, 
          [{text:'Отлично!', cls:'btn primary', cb: hidePopup}]
        );
        
        return true;
      }
      
    } catch (error) {
      console.error('❌ Ошибка покупки:', error);
      
      showPopup(
        `<div style="text-align:center">
          <div style="color:#ff6b6b;font-weight:900;font-size:18px;margin-bottom:12px">Ошибка оплаты</div>
          <p class="small-muted">${error.message || 'Попробуйте снова'}</p>
        </div>`, 
        [{text:'Повторить', cls:'btn primary', cb: () => processPurchase(count)},
         {text:'Отмена', cls:'btn', cb: hidePopup}]
      );
    }
  }
  
  // Generate code for partner
  async function generateCodeForPartner(partnerName) {
    try {
      console.log(`🔐 Генерируем код для партнера: ${partnerName}`);
      
      const response = await apiRequest('/api/codes/generate', {
        method: 'POST',
        body: JSON.stringify({ partner_name: partnerName })
      });
      
      if (response.success) {
        console.log(`✅ Код сгенерирован: ${response.code}, осталось: ${response.remaining} чашек`);
        
        // Обновляем локальное состояние
        state.remaining = response.remaining;
        
        // Сохраняем обновленное состояние
        localStorage.setItem('coffeepass_state', JSON.stringify(state));
        
        return response.code;
      }
      
    } catch (error) {
      console.error('❌ Ошибка генерации кода:', error);
      throw error;
    }
  }
  
  // Load user history
  async function loadHistory() {
    try {
      const data = await apiRequest('/api/history');
      return data;
    } catch (error) {
      console.error('❌ Ошибка загрузки истории:', error);
      return { codes: [], payments: [] };
    }
  }
  
  // ============ UI FUNCTIONS ============
  
  function showSplashThenHide() {
    haptic('splash');
    
    if (!splash || !splashLogo) {
      renderByState();
      return;
    }
    
    splash.classList.remove('hidden');
    splash.setAttribute('aria-hidden', 'false');
    splashLogo.style.transform = 'translateY(8px) scale(.985)';
    splashLogo.style.opacity = '0.9';
    
    setTimeout(() => {
      splashLogo.style.transform = 'translateY(0) scale(1)';
      splashLogo.style.opacity = '1';
    }, 50);
    
    setTimeout(() => {
      splash.classList.add('hidden');
      splash.setAttribute('aria-hidden', 'true');
      
      setTimeout(() => {
        try {
          splash.style.display = 'none';
        } catch(e) {}
      }, 700);
    }, 1400);
  }
  
  function renderByState() {
    const now = new Date();
    const curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    
    // Month reset logic
    if (state.month && state.month !== curMonth) {
      state.purchased = false;
      state.remaining = 0;
      state.month = curMonth;
    }
    
    if (state.purchased && state.remaining > 0) {
      prePurchaseArea.style.display = 'none';
      postPurchaseArea.style.display = 'flex';
      usedArea.style.display = 'none';
      
      if (cupCountEl) {
        cupCountEl.style.opacity = '0.5';
        cupCountEl.textContent = `${state.remaining} чашек`;
        setTimeout(() => {
          cupCountEl.style.transition = 'opacity 0.4s cubic-bezier(.22,1.0,.36,1.0)';
          cupCountEl.style.opacity = '1';
        }, 50);
      }
      
      if (returnPurchaseBtn) {
        returnPurchaseBtn.style.display = state.remaining < MAX_CUPS ? '' : 'none';
      }
    } else if (state.purchased && state.remaining === 0) {
      prePurchaseArea.style.display = 'none';
      postPurchaseArea.style.display = 'none';
      usedArea.style.display = 'flex';
    } else {
      prePurchaseArea.style.display = 'flex';
      postPurchaseArea.style.display = 'none';
      usedArea.style.display = 'none';
    }
  }
  
  function formatPrice(x) {
    return Math.round(x).toLocaleString('ru-RU') + ' ₽';
  }
  
  function openPurchaseDialog() {
    const remaining = state.remaining || 0;
    const hasSub = !!state.purchased;
    const need = Math.max(0, MAX_CUPS - remaining);
    
    if (hasSub && remaining > 0) {
      if (need === 0) {
        showPopup(
          `<div style="font-weight:900;font-size:20px">Пропуск заполнен</div>
          <div class="small-muted" style="margin-top:12px">
            У вас уже <strong>${remaining}/${MAX_CUPS}</strong> чашек.
          </div>`, 
          [{text:'Понятно', cls:'btn primary', cb: hidePopup}]
        );
        return;
      }
      renderTopUpDialog(1, need, need, need, false);
    } else {
      renderTopUpDialog(1, MAX_CUPS, MAX_CUPS, MAX_CUPS, true);
    }
  }
  
  function renderTopUpDialog(minCount, maxCount, defaultCount, need, isNewSubscription) {
    const perCup = SUBSCRIPTION_PRICE / MAX_CUPS;
    const initialPrice = Math.round(perCup * defaultCount);
    
    const html = `<div style="font-weight:900;font-size:20px">
        ${isNewSubscription ? 'Оформить пропуск' : 'Докупить чашки'}
      </div>
      <div class="small-muted" style="margin-top:12px">
        ${isNewSubscription 
          ? 'Выберите количество чашек для покупки.' 
          : `Вам не хватает <strong>${need}</strong> чашек до заполнения пропуска.`}
      </div>
      
      <div class="purchase-range" style="margin-top:24px">
        <input id="cupRange" type="range" min="${minCount}" max="${maxCount}" value="${defaultCount}" />
        <div class="range-value" id="rangeValue">${defaultCount}</div>
      </div>
      
      <div style="margin-top:20px;text-align:center;padding:16px;background:rgba(255,255,255,0.02);border-radius:12px">
        <div class="small-muted">Цена за чашку: ${formatPrice(perCup)}</div>
        <div style="margin-top:8px;font-weight:900;font-size:24px" id="totalPrice">${formatPrice(initialPrice)}</div>
      </div>`;
    
    showPopup(html, [
      { text: 'Отмена', cls: 'btn', cb: hidePopup },
      { 
        text: `Оплатить ${defaultCount} — ${formatPrice(initialPrice)}`, 
        cls: 'btn primary', 
        cb: () => { 
          const cnt = Number(document.getElementById('cupRange').value || defaultCount); 
          processPurchase(cnt); 
        }
      }
    ]);
    
    setTimeout(() => {
      const range = document.getElementById('cupRange');
      const valEl = document.getElementById('rangeValue');
      const priceEl = document.getElementById('totalPrice');
      
      if (!range) return;
      
      range.addEventListener('input', () => {
        const v = Number(range.value);
        valEl.textContent = v;
        const price = Math.round(perCup * v);
        priceEl.textContent = formatPrice(price);
        
        const payBtn = Array.from(popupActions.querySelectorAll('button'))
          .find(b => b.classList.contains('primary'));
        if (payBtn) {
          payBtn.textContent = `Оплатить ${v} — ${formatPrice(price)}`;
        }
      });
    }, 40);
  }
  
  async function showCodeAndUse() {
    if (!state.purchased || state.remaining <= 0) {
      showPopup(
        `<div style="font-weight:900;font-size:20px">Коды недоступны</div>
        <div class="small-muted" style="margin-top:12px">
          У вас нет доступных чашек.
        </div>`, 
        [{text:'Купить пропуск', cls:'btn primary', cb: () => {
          hidePopup();
          openPurchaseDialog();
        }}]
      );
      return;
    }
    
    let partners = state.partners;
    if (partners.length === 0) {
      try {
        partners = await apiRequest('/api/partners');
        state.partners = partners;
      } catch (error) {
        console.error('Ошибка загрузки партнеров:', error);
        partners = [
          { id: 1, name: "Кофейня на Набережной", address: "ул. Набережная, 12" },
          { id: 2, name: "Teatral Coffee", address: "ул. Театральная, 5" },
          { id: 3, name: "Горка Кофе", address: "пл. Ворота, 1" },
          { id: 4, name: "Кофе и Пермь", address: "ул. Ленина, 44" }
        ];
      }
    }
    
    const partnerHtml = partners.map(p => `
      <div class="partner-item" data-name="${p.name}"
           style="padding:16px;border-radius:12px;border:1px solid rgba(255,255,255,0.05);
                  margin-bottom:8px;cursor:pointer;transition:all .3s cubic-bezier(.22,1.0,.36,1.0);">
        <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
          <div>
            <div style="font-weight:900;font-size:16px">${p.name}</div>
            <div class="small-muted" style="margin-top:4px">${p.description || ''}</div>
          </div>
          <div style="font-size:12px;color:var(--muted);text-align:right">
            ${p.address || ''}
          </div>
        </div>
      </div>
    `).join('');
    
    showPopup(
      `<div style="font-weight:900;font-size:20px">Выберите партнера</div>
      <div class="small-muted" style="margin-top:12px">
        Где будете забирать кофе?
      </div>
      <div style="margin-top:20px;max-height:320px;overflow-y:auto;padding-right:8px;">
        ${partnerHtml}
      </div>`, 
      [{text: 'Отмена', cls: 'btn', cb: hidePopup}],
      { disableClose: false }
    );
    
    setTimeout(() => {
      document.querySelectorAll('.partner-item').forEach(item => {
        item.addEventListener('click', async () => {
          const partnerName = item.dataset.name;
          haptic('confirm');
          
          item.style.background = 'rgba(255,255,255,0.05)';
          item.style.borderColor = 'rgba(255,255,255,0.1)';
          
          try {
            const code = await generateCodeForPartner(partnerName);
            
            const html = `<div style="text-align:center">
              <div style="font-weight:900;font-size:20px">Ваш код</div>
              <div class="small-muted" style="margin-top:12px">
                Покажите этот код кассиру в<br>
                <strong>${partnerName}</strong>
              </div>
              
              <div style="margin-top:24px;padding:24px;background:rgba(255,255,255,0.03);
                         border-radius:16px;border:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:48px;font-weight:900;letter-spacing:8px;font-family:'Courier New',monospace;
                           background:linear-gradient(90deg, #fff, rgba(255,255,255,0.8));
                           -webkit-background-clip:text;background-clip:text;color:transparent;">
                  ${code}
                </div>
              </div>
              
              <div style="margin-top:20px;padding:12px;background:rgba(255,255,255,0.02);
                         border-radius:12px;border:1px solid rgba(255,255,255,0.05);">
                <div class="small-muted" style="font-size:12px">
                  ⚠️ Код одноразовый, осталось ${state.remaining} чашек
                </div>
              </div>
            </div>`;
            
            showPopup(html, 
              [{text: 'Готово', cls: 'btn primary', cb: () => {
                hidePopup();
                renderByState();
                
                if (cupSvg) {
                  cupSvg.classList.remove('used-anim');
                  void cupSvg.offsetWidth;
                  cupSvg.classList.add('used-anim');
                  setTimeout(() => haptic('confirm'), 300);
                }
              }}], 
              { disableClose: false }
            );
            
          } catch (error) {
            console.error('Ошибка генерации кода:', error);
            showPopup(
              `<div style="text-align:center">
                <div style="color:#ff6b6b;font-weight:900;font-size:18px;margin-bottom:12px">Ошибка</div>
                <p class="small-muted">${error.message || 'Не удалось сгенерировать код'}</p>
              </div>`, 
              [{text: 'OK', cls:'btn primary', cb: hidePopup}]
            );
          }
        });
      });
    }, 50);
  }
  
  function showPopup(html, actions = [], options = {}) {
    try {
      popupContent.innerHTML = html;
      popupActions.innerHTML = '';
      
      actions.forEach(a => {
        const btn = document.createElement('button');
        btn.className = a.cls || 'btn';
        btn.textContent = a.text;
        btn.style.transition = 'all 0.3s cubic-bezier(.22,1.0,.36,1.0)';
        
        btn.onclick = () => {
          haptic('tap');
          try {
            (a.cb || (() => {}))();
          } catch(e) {
            console.error(e);
          }
        };
        
        popupActions.appendChild(btn);
      });
      
      const disableClose = options.disableClose === true;
      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden', 'false');
      
      if (disableClose) {
        overlay.dataset.noclose = 'true';
        popupClose.style.display = 'none';
      } else {
        overlay.dataset.noclose = 'false';
        popupClose.style.display = '';
      }
      
      popup.style.transform = 'translateY(20px) scale(0.98)';
      popup.style.opacity = '0';
      
      setTimeout(() => {
        popup.style.transition = 'all 0.5s cubic-bezier(.22,1.0,.36,1.0)';
        popup.style.transform = 'translateY(0) scale(1)';
        popup.style.opacity = '1';
      }, 10);
      
      const firstBtn = popupActions.querySelector('button');
      if (firstBtn) {
        setTimeout(() => firstBtn.focus(), 100);
      }
    } catch(e) {
      console.error('Popup error:', e);
    }
  }
  
  function hidePopup() {
    try {
      popup.style.transform = 'translateY(20px) scale(0.98)';
      popup.style.opacity = '0';
      
      setTimeout(() => {
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.dataset.noclose = 'false';
        popupClose.style.display = '';
        
        popup.style.transition = 'none';
        popup.style.transform = '';
        popup.style.opacity = '';
      }, 300);
    } catch(e) {
      console.error('Hide popup error:', e);
    }
  }
  
  async function openHistory() {
    try {
      const historyData = await loadHistory();
      
      const codesRows = (historyData.codes || []).map(h => `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05)">
          <td style="padding:12px 0;color:var(--muted);font-size:13px;width:140px">
            ${new Date(h.created_at).toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </td>
          <td style="padding:12px 0;font-weight:900;font-family:'Courier New',monospace">
            ${h.code}
          </td>
          <td style="padding:12px 0;color:${h.is_used ? '#ff6b6b' : '#51cf66'};font-weight:700">
            ${h.is_used ? 'Использован' : 'Активен'}
          </td>
          <td style="padding:12px 0;color:var(--muted);font-size:13px">
            ${h.partner_name || '—'}
          </td>
        </tr>
      `).join('') || `
        <tr>
          <td colspan="4" style="padding:24px;text-align:center;color:var(--muted)">
            Кодов пока нет
          </td>
        </tr>`;
      
      const paymentsRows = (historyData.payments || []).map(p => `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05)">
          <td style="padding:12px 0;color:var(--muted);font-size:13px;width:140px">
            ${new Date(p.created_at).toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </td>
          <td style="padding:12px 0;font-weight:700">
            ${p.cups_added} чашек
          </td>
          <td style="padding:12px 0;font-weight:900;color:var(--fg)">
            ${p.amount} ₽
          </td>
        </tr>
      `).join('') || `
        <tr>
          <td colspan="3" style="padding:24px;text-align:center;color:var(--muted)">
            Платежей пока нет
          </td>
        </tr>`;
      
      const html = `<div style="font-weight:900;font-size:20px">История</div>
        <div class="small-muted" style="margin-top:12px">
          Ваши коды и платежи
        </div>
        
        <div style="margin-top:24px">
          <div style="font-weight:900;font-size:16px;margin-bottom:16px;padding-bottom:8px;
                     border-bottom:1px solid rgba(255,255,255,0.08)">
            Коды
          </div>
          <div style="max-height:200px;overflow-y:auto">
            <table style="width:100%;font-size:14px">
              <thead>
                <tr style="border-bottom:1px solid rgba(255,255,255,0.1)">
                  <th style="text-align:left;padding-bottom:12px;color:var(--muted);font-weight:600">Время</th>
                  <th style="text-align:left;padding-bottom:12px;color:var(--muted);font-weight:600">Код</th>
                  <th style="text-align:left;padding-bottom:12px;color:var(--muted);font-weight:600">Статус</th>
                  <th style="text-align:left;padding-bottom:12px;color:var(--muted);font-weight:600">Партнер</th>
                </tr>
              </thead>
              <tbody>${codesRows}</tbody>
            </table>
          </div>
        </div>
        
        <div style="margin-top:32px">
          <div style="font-weight:900;font-size:16px;margin-bottom:16px;padding-bottom:8px;
                     border-bottom:1px solid rgba(255,255,255,0.08)">
            Платежи
          </div>
          <div style="max-height:160px;overflow-y:auto">
            <table style="width:100%;font-size:14px">
              <thead>
                <tr style="border-bottom:1px solid rgba(255,255,255,0.1)">
                  <th style="text-align:left;padding-bottom:12px;color:var(--muted);font-weight:600">Время</th>
                  <th style="text-align:left;padding-bottom:12px;color:var(--muted);font-weight:600">Количество</th>
                  <th style="text-align:left;padding-bottom:12px;color:var(--muted);font-weight:600">Сумма</th>
                </tr>
              </thead>
              <tbody>${paymentsRows}</tbody>
            </table>
          </div>
        </div>`;
      
      showPopup(html, [{text: 'Закрыть', cls: 'btn primary', cb: hidePopup}]);
    } catch (error) {
      console.error('Ошибка загрузки истории:', error);
      showPopup(
        `<div style="text-align:center">
          <div style="font-weight:900;font-size:18px;margin-bottom:12px">История</div>
          <p class="small-muted">${error.message || 'Функция временно недоступна'}</p>
        </div>`,
        [{text: 'OK', cls: 'btn primary', cb: hidePopup}]
      );
    }
  }
  
  async function initApp() {
    createBeans();
    
    // Инициализируем Telegram WebApp если есть
    if (tg) {
      console.log('🤖 Инициализируем Telegram WebApp...');
      tg.ready();
      tg.expand();
      
      // Устанавливаем тему
      if (tg.colorScheme === 'dark') {
        document.documentElement.style.setProperty('--bg', '#070707');
      }
      
      console.log('✅ Telegram WebApp готов');
      console.log('📱 Платформа:', tg.platform);
      console.log('👤 Пользователь доступен:', !!tg.initDataUnsafe?.user);
    }
    
    showSplashThenHide();
    
    // Авторизуемся
    await authenticateWithTelegram();
    
    // Event listeners
    if (buyBtn) buyBtn.addEventListener('click', () => { haptic('strong'); openPurchaseDialog(); });
    if (openCodeBtn) openCodeBtn.addEventListener('click', () => { haptic('confirm'); showCodeAndUse(); });
    if (historyBtn) historyBtn.addEventListener('click', () => { haptic('tap'); openHistory(); });
    
    if (returnPurchaseBtn) {
      returnPurchaseBtn.addEventListener('click', () => {
        haptic('tap');
        prePurchaseArea.style.display = 'flex';
        postPurchaseArea.style.display = 'none';
        usedArea.style.display = 'none';
        
        prePurchaseArea.style.opacity = '0';
        prePurchaseArea.style.transform = 'translateY(10px)';
        setTimeout(() => {
          prePurchaseArea.style.transition = 'all 0.4s cubic-bezier(.22,1.0,.36,1.0)';
          prePurchaseArea.style.opacity = '1';
          prePurchaseArea.style.transform = 'translateY(0)';
        }, 10);
        
        setTimeout(() => { if (buyBtn) buyBtn.focus(); }, 400);
      });
    }
    
    if (buyAgainBtn) {
      buyAgainBtn.addEventListener('click', () => {
        haptic('tap');
        prePurchaseArea.style.display = 'flex';
        postPurchaseArea.style.display = 'none';
        usedArea.style.display = 'none';
        
        prePurchaseArea.style.opacity = '0';
        prePurchaseArea.style.transform = 'translateY(10px)';
        setTimeout(() => {
          prePurchaseArea.style.transition = 'all 0.4s cubic-bezier(.22,1.0,.36,1.0)';
          prePurchaseArea.style.opacity = '1';
          prePurchaseArea.style.transform = 'translateY(0)';
        }, 10);
        
        setTimeout(() => { if (buyBtn) buyBtn.focus(); }, 400);
      });
    }
    
    if (partnersBtn) {
      partnersBtn.addEventListener('click', () => {
        haptic('tap');
        const open = partnersList.classList.toggle('open');
        partnersBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
        partnersList.setAttribute('aria-hidden', open ? 'false' : 'true');
      });
    }
    
    if (partnersPanel) {
      partnersPanel.addEventListener('click', (e) => {
        const item = e.target.closest('.partner-item');
        if (!item) return;
        haptic('tap');
        const name = item.dataset.name;
        
        showPopup(
          `<div style="font-weight:900;font-size:20px">${name}</div>
          <div class="small-muted" style="margin-top:12px">
            ${item.querySelector('small').textContent}
          </div>
          <div style="margin-top:16px;padding:12px;background:rgba(255,255,255,0.02);
                     border-radius:12px;border:1px solid rgba(255,255,255,0.05);">
            <div style="color:var(--fg);font-weight:600">Адрес:</div>
            <div style="margin-top:4px;color:var(--muted)">
              ${item.querySelector('div[style*="font-size:12px"]').textContent}
            </div>
          </div>`, 
          [{text:'Ок', cls:'btn primary', cb: hidePopup}]
        );
      });
    }
    
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#partnersBtn') && !e.target.closest('#partnersList')) {
        partnersList.classList.remove('open');
        partnersList.setAttribute('aria-hidden', 'true');
        partnersBtn.setAttribute('aria-pressed', 'false');
      }
    });
    
    if (popupClose) popupClose.addEventListener('click', () => { haptic('tap'); hidePopup(); });
    
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && overlay.dataset.noclose !== 'true') {
          haptic('tap');
          hidePopup();
        }
      });
    }
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('show')) {
        if (overlay.dataset.noclose !== 'true') hidePopup();
      }
      if (e.key === 'Escape' && partnersList.classList.contains('open')) {
        partnersList.classList.remove('open');
        partnersList.setAttribute('aria-hidden', 'true');
        partnersBtn.setAttribute('aria-pressed', 'false');
      }
    });
    
    console.log('✅ CoffeePass полностью инициализирован');
    console.log(`🌐 API: ${API_BASE_URL}`);
    console.log(`👤 Пользователь: ${user ? user.first_name : 'не авторизован'}`);
    console.log(`💰 Состояние: ${state.remaining} чашек, purchased: ${state.purchased}`);
  }
  
  setTimeout(() => {
    initApp();
  }, 100);
  
})();
</script>
