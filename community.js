// SergysLand — отзывы + личные обращения в поддержку + панель персонала
(function () {
  let sb = null;
  let selectedRating = 5;
  let currentUser = null;
  let staffRole = null;
  let selectedThreadId = null;
  let visitorToken = localStorage.getItem('sergysland_support_token');
  if (!visitorToken) {
    visitorToken = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
    localStorage.setItem('sergysland_support_token', visitorToken);
  }
  let pollTimer = null;

  const configured = typeof SUPABASE_URL === 'string' && typeof SUPABASE_PUBLISHABLE_KEY === 'string' &&
    SUPABASE_URL.startsWith('http') && !SUPABASE_URL.includes('PASTE_YOUR') && !SUPABASE_PUBLISHABLE_KEY.includes('PASTE_YOUR');
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const date = v => new Date(v).toLocaleString('ru-RU', {dateStyle:'short', timeStyle:'short'});

  document.addEventListener('DOMContentLoaded', async () => {
    if (!configured) { $('chatStatus').textContent = 'Supabase ещё не подключён — вставь URL и Publishable key в supabase-config.js.'; $('reviewAverage').textContent='—'; return; }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    setReviewRating(5);
    await loadReviews();
    await loadVisitorThread();
    sb.auth.onAuthStateChange(async (_event, session) => { currentUser = session?.user || null; await updateAdminUI(); });
    const {data:{session}} = await sb.auth.getSession();
    currentUser = session?.user || null;
    await updateAdminUI();
  });

  async function loadReviews() {
    const {data,error}=await sb.from('reviews').select('*').order('created_at',{ascending:false}).limit(50);
    if(error){$('reviewList').innerHTML='<div class="chat-empty">Не удалось загрузить отзывы.</div>';return;}
    const avg=data.length?(data.reduce((a,r)=>a+r.rating,0)/data.length).toFixed(1):'—';
    $('reviewAverage').innerHTML=avg==='—'?'—':`${avg} <span>★</span><small> / 5 • ${data.length} голосов</small>`;
    $('reviewList').innerHTML=data.length?data.map(r=>`<article class="review-item"><div><b>${esc(r.nickname)}</b><span>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span></div><p>${esc(r.comment||'Без комментария')}</p><small>${date(r.created_at)}</small></article>`).join(''):'<div class="chat-empty">Будь первым — оставь свой голос!</div>';
  }

  async function loadVisitorThread() {
    const {data,error}=await sb.rpc('support_get_my_thread',{p_token:visitorToken});
    if(error){$('chatStatus').textContent='Не удалось открыть поддержку. Выполни обновлённый supabase.sql.';return;}
    if(!data || !data.length){ renderVisitorClosed(); return; }
    const thread=data[0]; selectedThreadId=thread.id;
    $('chatStatus').textContent=thread.status==='open'?'Обращение открыто • ожидай ответа персонала':'Беседа завершена.';
    $('chatName').value=thread.visitor_name || '';
    $('chatName').disabled=true;
    $('chatMessage').disabled=thread.status!=='open';
    $('chatSendBtn').disabled=thread.status!=='open';
    await loadVisitorMessages();
    startPolling();
  }

  function renderVisitorClosed(){
    selectedThreadId=null; $('chatName').disabled=false; $('chatMessage').disabled=false; $('chatSendBtn').disabled=false;
    $('chatStatus').textContent='Личная поддержка • новое обращение';
    $('chatMessages').innerHTML='<div class="chat-empty">У тебя нет открытых обращений.<br>Опиши проблему ниже — её увидит только персонал.</div>';
  }

  async function loadVisitorMessages(){
    if(!selectedThreadId)return;
    const {data,error}=await sb.rpc('support_get_my_messages',{p_token:visitorToken,p_thread_id:selectedThreadId});
    if(error){$('chatStatus').textContent='Не удалось загрузить сообщения.';return;}
    renderChat(data||[]);
  }
  function startPolling(){ clearInterval(pollTimer); pollTimer=setInterval(()=>{ if(selectedThreadId && !currentUser) loadVisitorMessages(); },4000); }
  function renderChat(items){const box=$('chatMessages'); if(!items.length){box.innerHTML='<div class="chat-empty">Обращение создано. Напиши свой вопрос — персонал увидит его в панели.</div>';return;} box.innerHTML=items.map(chatHtml).join('');box.scrollTop=box.scrollHeight;}
  function chatHtml(m){return `<div class="chat-message ${m.author_type==='staff'?'staff':''}"><div class="chat-message-head"><b>${esc(m.author_name)}</b><small>${m.author_type==='staff'?'ПЕРСОНАЛ':'ТЫ'} • ${date(m.created_at)}</small></div><p>${esc(m.message).replace(/\n/g,'<br>')}</p></div>`;}

  window.sendSupportMessage=async function(){
    if(!sb)return toast('Сначала подключи Supabase.');
    const name=$('chatName').value.trim(),message=$('chatMessage').value.trim();
    if(!name||!message)return toast('Укажи ник и напиши вопрос.');
    if(name.length<2||name.length>32)return toast('Ник должен быть от 2 до 32 символов.');
    let threadId=selectedThreadId;
    if(!threadId){
      const r=await sb.rpc('support_create_thread',{p_token:visitorToken,p_name:name});
      if(r.error)return toast('Не удалось создать обращение.');
      threadId=r.data; selectedThreadId=threadId; $('chatName').disabled=true;
    }
    const {error}=await sb.rpc('support_add_visitor_message',{p_token:visitorToken,p_thread_id:threadId,p_name:name,p_message:message});
    if(error)return toast(error.message||'Не удалось отправить сообщение.');
    $('chatMessage').value=''; await loadVisitorMessages(); $('chatStatus').textContent='Обращение открыто • персонал получил сообщение';
  };

  window.setReviewRating=n=>{selectedRating=n;document.querySelectorAll('#reviewStars button').forEach(b=>b.classList.toggle('active',Number(b.dataset.rating)<=n));};
  window.submitReview=async function(){
    if(!sb)return toast('Сначала подключи Supabase.');
    const nickname=$('reviewName').value.trim(),comment=$('reviewText').value.trim();
    if(!/^[A-Za-zА-Яа-яЁё0-9_\-]{2,16}$/.test(nickname))return toast('Ник: 2–16 букв, цифр, _ или -.');
    const words=comment ? comment.split(/\s+/u).filter(Boolean).length : 0;
    if(words>200)return toast(`Отзыв слишком длинный: ${words}/200 слов. Сократи текст.`);
    // Разрешены латиница и кириллица только нужных языков, цифры и обычная пунктуация.
    if(/[^A-Za-zА-Яа-яЁёІіЇїЄєҐґӘәҒғҚқҢңӨөҰұҮүҺһ0-9\s.,!?…:;’'"()\-—–]/u.test(comment))return toast('Разрешены только русский, украинский, казахский, английский и немецкий языки. Удали необычные символы.');
    if(comment.length>5000)return toast('Слишком длинный отзыв.');
    const {error}=await sb.from('reviews').insert({nickname,rating:selectedRating,comment});
    if(error)return toast(error.code==='23505'?'Этот ник уже голосовал.':'Не удалось сохранить голос.');
    $('reviewName').value='';$('reviewText').value='';toast('Спасибо за оценку!');await loadReviews();if(currentUser)loadAdminReviews();
  };

  window.adminLogin=async function(){if(!sb)return toast('Сначала подключи Supabase.');const email=$('adminEmail').value.trim(),password=$('adminPassword').value;const {data,error}=await sb.auth.signInWithPassword({email,password});if(error){$('adminLoginStatus').textContent='Неверный email/пароль или аккаунт ещё не подтверждён.';return;}currentUser=data.user;await updateAdminUI();};
  window.adminLogout=async function(){if(sb)await sb.auth.signOut();currentUser=null;staffRole=null;updateAdminUI();};
  async function updateAdminUI(){
    if(!sb)return;
    if(!currentUser){$('adminLoginBox').hidden=false;$('adminPanel').hidden=true;return;}
    const {data,error}=await sb.from('staff_members').select('role,email').eq('user_id',currentUser.id).maybeSingle();
    if(error||!data){$('adminLoginStatus').textContent='У аккаунта нет прав персонала.';await sb.auth.signOut();return;}
    staffRole=data.role;$('adminLoginBox').hidden=true;$('adminPanel').hidden=false;$('adminIdentity').textContent=`${data.email||currentUser.email} • ${data.role==='admin'?'разработчик':'модератор'}`;
    await Promise.all([loadAdminReviews(),loadAdminThreads(),data.role==='admin'?loadStaff():Promise.resolve()]);
  }
  window.showAdminTab=function(id,btn){document.querySelectorAll('.admin-tab-content').forEach(x=>x.hidden=true);$(id).hidden=false;document.querySelectorAll('.admin-tab').forEach(x=>x.classList.remove('active'));btn.classList.add('active');if(id==='chatAdmin')loadAdminThreads();};
  async function loadAdminReviews(){const {data}=await sb.from('reviews').select('*').order('created_at',{ascending:false}).limit(100);$('adminReviewsList').innerHTML=(data||[]).map(r=>`<div class="admin-row"><div><b>${esc(r.nickname)}</b><span>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span><small>${date(r.created_at)}</small><p>${esc(r.comment||'')}</p></div><div class="admin-actions"><button onclick="editReview('${r.id}','${encodeURIComponent(r.nickname)}')">✏ Изменить ник</button><button onclick="deleteReview('${r.id}')">🗑 Удалить</button></div></div>`).join('')||'<div class="chat-empty">Отзывов пока нет.</div>';}

  async function loadAdminThreads(){
    const {data,error}=await sb.from('support_threads').select('*').order('updated_at',{ascending:false}).limit(100);
    if(error){$('adminChatList').innerHTML='<div class="chat-empty">Не удалось загрузить обращения.</div>';return;}
    const open=(data||[]).filter(t=>t.status==='open').length;
    $('adminChatList').innerHTML=`<div class="support-admin-head"><div><b>Обращения: ${data?.length||0}</b><small>Открытых: ${open}</small></div></div>`+(data||[]).map(t=>`<button class="support-thread ${t.status==='closed'?'closed':''}" onclick="openSupportThread('${t.id}')"><span><b>${esc(t.visitor_name)}</b><small>${t.status==='open'?'ОТКРЫТО':'ЗАВЕРШЕНО'} • ${date(t.updated_at)}</small></span><strong>${t.status==='open'?'→':'✓'}</strong></button>`).join('')||'<div class="chat-empty">Новых обращений пока нет.</div>';
    if(selectedThreadId) await openSupportThread(selectedThreadId,true);
  }

  window.openSupportThread=async function(id,silent){
    selectedThreadId=id;
    const {data:thread}=await sb.from('support_threads').select('*').eq('id',id).maybeSingle();
    if(!thread)return;
    const {data:messages,error}=await sb.from('support_messages').select('*').eq('thread_id',id).order('created_at',{ascending:true});
    if(error)return toast('Не удалось загрузить обращение.');
    const panel=$('supportConversation');
    panel.hidden=false;
    $('supportConversationTitle').textContent=`${thread.visitor_name} • ${thread.status==='open'?'открыто':'завершено'}`;
    $('supportConversationMessages').innerHTML=(messages||[]).map(chatHtml).join('')||'<div class="chat-empty">Сообщений нет.</div>';
    $('supportConversationMessages').scrollTop=$('supportConversationMessages').scrollHeight;
    $('supportCloseBtn').hidden=thread.status!=='open';
    $('staffReplyText').disabled=thread.status!=='open'; $('staffReplyBtn').disabled=thread.status!=='open';
    if(!silent)$('supportConversation').scrollIntoView({behavior:'smooth',block:'nearest'});
  };
  window.sendStaffReply=async function(){if(!selectedThreadId)return toast('Выбери обращение.');const message=$('staffReplyText').value.trim();if(!message)return toast('Напиши ответ.');const {data:thread}=await sb.from('support_threads').select('status').eq('id',selectedThreadId).single();if(!thread||thread.status!=='open')return toast('Это обращение уже завершено.');const {error}=await sb.from('support_messages').insert({thread_id:selectedThreadId,author_type:'staff',author_name:currentUser?.email?.split('@')[0]||'Персонал',message,author_id:currentUser.id});if(error)return toast('Не удалось отправить ответ.');$('staffReplyText').value='';await openSupportThread(selectedThreadId,true);await loadAdminThreads();};
  window.deleteChatMessage=async function(id){if(!confirm('Удалить это сообщение?'))return;const {error}=await sb.from('support_messages').delete().eq('id',id);if(error)return toast('Нет прав или ошибка удаления. Проверь обновлённый supabase.sql.');await openSupportThread(selectedThreadId,true);};
  window.closeSupportThread=async function(){if(!selectedThreadId)return;if(!confirm('Завершить обращение и удалить всю переписку из базы? Это действие нельзя отменить.'))return;const id=selectedThreadId;const {error}=await sb.from('support_threads').delete().eq('id',id);if(error)return toast('Не удалось завершить обращение.');selectedThreadId=null;$('supportConversation').hidden=true;await loadAdminThreads();toast('Обращение завершено и удалено из базы.');};
  window.deleteReview=async function(id){if(!confirm('Удалить этот голос?'))return;const {error}=await sb.from('reviews').delete().eq('id',id);if(error)return toast('Нет прав или ошибка.');await loadReviews();loadAdminReviews();};
  window.editReview=async function(id,encoded){const old=decodeURIComponent(encoded),nickname=prompt('Новый ник:',old);if(nickname===null)return;if(!/^[A-Za-zА-Яа-яЁё0-9_\-]{2,16}$/.test(nickname.trim()))return toast('Некорректный ник.');const {error}=await sb.from('reviews').update({nickname:nickname.trim(),updated_at:new Date().toISOString()}).eq('id',id);if(error)return toast(error.code==='23505'?'Такой ник уже существует.':'Не удалось изменить ник.');await loadReviews();loadAdminReviews();};
  async function loadStaff(){const {data}=await sb.from('staff_members').select('*').order('created_at',{ascending:true});$('staffList').innerHTML=(data||[]).map(s=>`<div class="admin-row"><div><b>${esc(s.email||s.user_id)}</b><small>${s.role}</small></div><div class="admin-actions"><button onclick="removeStaff('${s.user_id}')">Удалить</button></div></div>`).join('')||'<div class="chat-empty">Сотрудников нет.</div>';}
  window.addStaffMember=async function(){const email=$('staffEmail').value.trim().toLowerCase(),role=$('staffRole').value;if(!email)return toast('Укажи email.');const {data:existing}=await sb.from('staff_members').select('user_id').eq('email',email).maybeSingle();if(existing)return toast('Этот сотрудник уже добавлен.');const {data:authUser}=await sb.rpc('find_user_by_email',{target_email:email});if(!authUser)return toast('Сначала зарегистрируй сотрудника в Supabase Auth, затем добавь его.');const {error}=await sb.from('staff_members').insert({user_id:authUser,email,role});if(error)return toast('Не удалось добавить сотрудника.');$('staffEmail').value='';loadStaff();};
  window.removeStaff=async function(id){if(!confirm('Удалить сотрудника?'))return;const {error}=await sb.from('staff_members').delete().eq('user_id',id);if(error)return toast('Нет прав.');loadStaff();};
  function toast(msg){if(typeof showToast==='function')showToast(msg);else alert(msg);}
})();
