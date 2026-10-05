// SergysLand — Supabase chat, reviews and developer panel
(function () {
  let sb = null;
  let selectedRating = 5;
  let currentUser = null;

  const configured = typeof SUPABASE_URL === 'string' &&
    typeof SUPABASE_PUBLISHABLE_KEY === 'string' &&
    SUPABASE_URL.startsWith('http') &&
    !SUPABASE_URL.includes('PASTE_YOUR') &&
    !SUPABASE_PUBLISHABLE_KEY.includes('PASTE_YOUR');

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const date = (v) => new Date(v).toLocaleString('ru-RU', {dateStyle:'short', timeStyle:'short'});

  document.addEventListener('DOMContentLoaded', async () => {
    if (!configured) {
      $('chatStatus').textContent = 'Supabase ещё не подключён — вставь URL и Publishable key в supabase-config.js.';
      $('reviewAverage').textContent = '—';
      return;
    }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    setReviewRating(5);
    await Promise.all([loadReviews(), loadChat()]);
    sb.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      updateAdminUI();
    });
  });

  async function loadReviews() {
    const { data, error } = await sb.from('reviews').select('*').order('created_at', {ascending:false}).limit(50);
    if (error) { $('reviewList').innerHTML = '<div class="chat-empty">Не удалось загрузить отзывы.</div>'; return; }
    const avg = data.length ? (data.reduce((a,r)=>a+r.rating,0)/data.length).toFixed(1) : '—';
    $('reviewAverage').innerHTML = avg === '—' ? '—' : `${avg} <span>★</span><small> / 5 • ${data.length} голосов</small>`;
    $('reviewList').innerHTML = data.length ? data.map(r => `<article class="review-item"><div><b>${esc(r.nickname)}</b><span>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span></div><p>${esc(r.comment || 'Без комментария')}</p><small>${date(r.created_at)}</small></article>`).join('') : '<div class="chat-empty">Будь первым — оставь свой голос!</div>';
  }

  async function loadChat() {
    const { data, error } = await sb.from('support_messages').select('*').order('created_at',{ascending:true}).limit(100);
    if (error) { $('chatStatus').textContent='Не удалось подключиться к чату.'; return; }
    $('chatStatus').textContent='Чат подключён • сообщения обновляются автоматически';
    renderChat(data || []);
    sb.channel('sergysland-community').on('postgres_changes',{event:'INSERT',schema:'public',table:'support_messages'},payload=>appendChat(payload.new)).subscribe();
  }

  function renderChat(items) {
    const box=$('chatMessages');
    if (!items.length) { box.innerHTML='<div class="chat-empty">Пока сообщений нет. Задай первый вопрос!</div>'; return; }
    box.innerHTML=items.map(chatHtml).join(''); box.scrollTop=box.scrollHeight;
  }
  function appendChat(m) {
    const box=$('chatMessages');
    const empty=box.querySelector('.chat-empty'); if(empty) empty.remove();
    box.insertAdjacentHTML('beforeend',chatHtml(m)); box.scrollTop=box.scrollHeight;
    if(currentUser) loadAdminChat();
  }
  function chatHtml(m) { return `<div class="chat-message ${m.author_type==='staff'?'staff':''}"><div class="chat-message-head"><b>${esc(m.author_name)}</b><small>${m.author_type==='staff'?'ПЕРСОНАЛ':'ИГРОК'} • ${date(m.created_at)}</small></div><p>${esc(m.message).replace(/\n/g,'<br>')}</p></div>`; }

  window.sendSupportMessage = async function () {
    if(!sb) return toast('Сначала подключи Supabase.');
    const name=$('chatName').value.trim(), message=$('chatMessage').value.trim();
    if(!name || !message) return toast('Укажи ник и напиши сообщение.');
    if(name.length<2) return toast('Ник слишком короткий.');
    let {data:thread}=await sb.from('support_threads').select('id').eq('status','open').limit(1).maybeSingle();
    if(!thread){ const r=await sb.from('support_threads').insert({visitor_name:name}).select('id').single(); if(r.error)return toast('Ошибка создания чата.'); thread=r.data; }
    const {error}=await sb.from('support_messages').insert({thread_id:thread.id,author_type:'visitor',author_name:name,message});
    if(error) return toast('Не удалось отправить сообщение.');
    $('chatMessage').value=''; toast('Сообщение отправлено.');
  };

  window.setReviewRating = function (n) { selectedRating=n; document.querySelectorAll('#reviewStars button').forEach(b=>b.classList.toggle('active',Number(b.dataset.rating)<=n)); };
  window.submitReview = async function () {
    if(!sb) return toast('Сначала подключи Supabase.');
    const nickname=$('reviewName').value.trim(), comment=$('reviewText').value.trim();
    if(!/^[A-Za-zА-Яа-яЁё0-9_\-]{2,16}$/.test(nickname)) return toast('Ник: 2–16 букв, цифр, _ или -.');
    const {error}=await sb.from('reviews').insert({nickname,rating:selectedRating,comment});
    if(error) return toast(error.code==='23505'?'Этот ник уже голосовал.':'Не удалось сохранить голос.');
    $('reviewName').value=''; $('reviewText').value=''; toast('Спасибо за оценку!'); await loadReviews(); if(currentUser) loadAdminReviews();
  };

  window.adminLogin = async function () {
    if(!sb) return toast('Сначала подключи Supabase.');
    const email=$('adminEmail').value.trim(), password=$('adminPassword').value;
    const {data,error}=await sb.auth.signInWithPassword({email,password});
    if(error) { $('adminLoginStatus').textContent='Неверный email/пароль или аккаунт ещё не подтверждён.'; return; }
    currentUser=data.user; await updateAdminUI();
  };
  window.adminLogout = async function(){ if(sb) await sb.auth.signOut(); currentUser=null; updateAdminUI(); };
  async function updateAdminUI(){
    if(!sb) return;
    if(!currentUser){ $('adminLoginBox').hidden=false; $('adminPanel').hidden=true; return; }
    const {data,error}=await sb.from('staff_members').select('role,email').eq('user_id',currentUser.id).maybeSingle();
    if(error || !data){ $('adminLoginStatus').textContent='У аккаунта нет прав персонала.'; await sb.auth.signOut(); return; }
    $('adminLoginBox').hidden=true; $('adminPanel').hidden=false; $('adminIdentity').textContent=`${data.email || currentUser.email} • ${data.role==='admin'?'разработчик':'модератор'}`;
    await Promise.all([loadAdminReviews(),loadAdminChat(),data.role==='admin'?loadStaff():Promise.resolve()]);
  }
  window.showAdminTab=function(id,btn){ document.querySelectorAll('.admin-tab-content').forEach(x=>x.hidden=true); $(id).hidden=false; document.querySelectorAll('.admin-tab').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); };
  async function loadAdminReviews(){ const {data}=await sb.from('reviews').select('*').order('created_at',{ascending:false}).limit(100); $('adminReviewsList').innerHTML=(data||[]).map(r=>`<div class="admin-row"><div><b>${esc(r.nickname)}</b><span>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span><small>${date(r.created_at)}</small><p>${esc(r.comment||'')}</p></div><div class="admin-actions"><button onclick="editReview('${r.id}','${encodeURIComponent(r.nickname)}')">✏ Изменить ник</button><button onclick="deleteReview('${r.id}')">🗑 Удалить</button></div></div>`).join('')||'<div class="chat-empty">Отзывов пока нет.</div>'; }
  async function loadAdminChat(){ const {data}=await sb.from('support_messages').select('*').order('created_at',{ascending:false}).limit(100); $('adminChatList').innerHTML=`<div class="admin-reply"><input id="staffReplyName" maxlength="32" value="${esc(currentUser?.email?.split('@')[0]||'Персонал')}" placeholder="Имя сотрудника"><textarea id="staffReplyText" maxlength="1000" placeholder="Ответ игрокам…"></textarea><button class="primary" onclick="sendStaffReply()">ОТВЕТИТЬ</button></div>`+(data||[]).map(m=>`<div class="admin-row"><div><b>${esc(m.author_name)}</b><small>${m.author_type==='staff'?'ПЕРСОНАЛ':'ИГРОК'} • ${date(m.created_at)}</small><p>${esc(m.message)}</p></div><div class="admin-actions"><button onclick="deleteChatMessage('${m.id}')">🗑 Удалить</button></div></div>`).join(''); }
  window.sendStaffReply=async function(){ const name=$('staffReplyName').value.trim(),message=$('staffReplyText').value.trim(); if(!message)return toast('Напиши ответ.'); const {data:thread}=await sb.from('support_threads').select('id').eq('status','open').limit(1).maybeSingle(); if(!thread)return toast('Нет открытого чата.'); const {error}=await sb.from('support_messages').insert({thread_id:thread.id,author_type:'staff',author_name:name||'Персонал',message,author_id:currentUser.id}); if(error)return toast('Ошибка отправки.'); $('staffReplyText').value=''; await loadAdminChat(); };
  window.deleteChatMessage=async function(id){ if(!confirm('Удалить сообщение?'))return; const {error}=await sb.from('support_messages').delete().eq('id',id); if(error)return toast('Нет прав или ошибка.'); loadAdminChat(); };
  window.deleteReview=async function(id){ if(!confirm('Удалить этот голос?'))return; const {error}=await sb.from('reviews').delete().eq('id',id); if(error)return toast('Нет прав или ошибка.'); await loadReviews(); loadAdminReviews(); };
  window.editReview=async function(id,encoded){ const old=decodeURIComponent(encoded); const nickname=prompt('Новый ник:',old); if(nickname===null)return; if(!/^[A-Za-zА-Яа-яЁё0-9_\-]{2,16}$/.test(nickname.trim()))return toast('Некорректный ник.'); const {error}=await sb.from('reviews').update({nickname:nickname.trim(),updated_at:new Date().toISOString()}).eq('id',id); if(error)return toast('Не удалось изменить ник.'); await loadReviews(); loadAdminReviews(); };
  async function loadStaff(){ const {data}=await sb.from('staff_members').select('*').order('created_at',{ascending:true}); $('staffList').innerHTML=(data||[]).map(s=>`<div class="admin-row"><div><b>${esc(s.email||s.user_id)}</b><small>${s.role}</small></div><div class="admin-actions"><button onclick="removeStaff('${s.user_id}')">Удалить</button></div></div>`).join('')||'<div class="chat-empty">Сотрудников нет.</div>'; }
  window.addStaffMember=async function(){ const email=$('staffEmail').value.trim().toLowerCase(),role=$('staffRole').value; if(!email)return toast('Укажи email.'); const {data:user,error}=await sb.from('staff_members').select('user_id').eq('email',email).maybeSingle(); if(user)return toast('Этот сотрудник уже добавлен.'); const {data:authUser}=await sb.rpc('find_user_by_email',{target_email:email}); if(!authUser)return toast('Сначала зарегистрируй сотрудника в Supabase Auth, затем добавь его.'); const {error:ins}=await sb.from('staff_members').insert({user_id:authUser, email, role}); if(ins)return toast('Не удалось добавить сотрудника.'); $('staffEmail').value=''; loadStaff(); };
  window.removeStaff=async function(id){ if(!confirm('Удалить сотрудника?'))return; const {error}=await sb.from('staff_members').delete().eq('user_id',id); if(error)return toast('Нет прав.'); loadStaff(); };
  function toast(msg){ if(typeof showToast==='function')showToast(msg); else alert(msg); }
})();
