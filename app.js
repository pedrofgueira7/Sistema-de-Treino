(function () {
  'use strict';

  var LOCAL_ENTRIES_KEY = 'diario-corrida-enzo-v1';
  var DEFAULT_REF = { distanciaKm: 5, tempoSegundos: 2577 }; // padrão: 5km em 42:57

  var ZONE_RATIOS = {
    Leve: [1.14, 1.19],
    Moderado: [1.03, 1.07],
    Longa: [1.14, 1.19],
    Intervalado: [0.95, 1.00]
  };

  var DEFAULT_PLANO = [
    { dia: 1, daytype: 'leve', titulo: 'Superior (Push) + Corrida leve', exercicios: [
      'Supino reto: 4x8-10',
      'Desenvolvimento ombro: 3x10',
      'Paralelas (dips): 3x até falhar',
      'Elevação lateral: 3x15',
      'Tríceps corda: 3x15',
      'Corrida leve, 20 min — ritmo alvo: {{ritmo:Leve}} min/km'
    ] },
    { dia: 2, daytype: 'interv', titulo: 'Corrida intervalada', exercicios: [
      'Aquecimento: 5 min de trote leve',
      '6 a 8 tiros de 400m — ritmo alvo: {{ritmo:Intervalado400}} por tiro, com 1-2 min de trote leve entre cada',
      'Desaceleração: 5 min de trote leve'
    ] },
    { dia: 3, daytype: null, titulo: 'Pernas', exercicios: [
      'Agachamento livre: 4x8-10',
      'Levantamento terra romeno: 3x10',
      'Leg press: 3x12',
      'Cadeira extensora + flexora (bi-set): 3x15',
      'Panturrilha em pé: 4x15'
    ] },
    { dia: 4, daytype: 'mod', titulo: 'Superior (Pull) + Corrida moderada', exercicios: [
      'Barra fixa: 4x até falhar',
      'Remada curvada: 4x10',
      'Puxada frente: 3x12',
      'Rosca direta: 3x15',
      'Face pull: 3x15',
      'Corrida moderada, 25 min — ritmo alvo: {{ritmo:Moderado}} min/km'
    ] },
    { dia: 5, daytype: 'longa', titulo: 'Corrida longa + Core', exercicios: [
      'Corrida contínua, 35-40 min — ritmo alvo: {{ritmo:Longa}} min/km',
      'Prancha: 3x1 min',
      'Abdômen infra: 3x20'
    ] }
  ];

  var WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']; // Dom, Seg, Ter, Qua, Qui, Sex, Sáb
  var AVATAR_COLORS = ['--accent-leve', '--accent-interv', '--accent-mod', '--accent-longa', '--accent-prova'];

  var entries = [];
  var ref = DEFAULT_REF;
  var planoConcluido = {}; // { "1": true, ... } para a semana atual
  var planoData = null;
  var planoEditMode = false;
  var planoBackup = null;
  var editingId = null;
  var paceChart = null;
  var supabase = null;
  var checkins = {}; // { 'YYYY-MM-DD': true }
  var currentUser = null;

  // ---------- config / client ----------
  function configOk() {
    var c = window.SUPABASE_CONFIG;
    return c && c.url && c.anonKey && c.url.indexOf('COLE_AQUI') === -1 && c.anonKey.indexOf('COLE_AQUI') === -1;
  }

  // ---------- helpers ----------
  function parseTempoToSeconds(str) {
    var parts = str.trim().split(':');
    if (parts.some(function (p) { return p === '' || isNaN(p); })) return null;
    if (parts.length === 2) {
      var m = parseInt(parts[0], 10), s = parseInt(parts[1], 10);
      if (s >= 60) return null;
      return m * 60 + s;
    }
    if (parts.length === 3) {
      var h = parseInt(parts[0], 10), m2 = parseInt(parts[1], 10), s2 = parseInt(parts[2], 10);
      if (m2 >= 60 || s2 >= 60) return null;
      return h * 3600 + m2 * 60 + s2;
    }
    return null;
  }
  function formatClock(totalSeconds) {
    totalSeconds = Math.round(totalSeconds);
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function formatDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function tipoLabel(tipo) {
    var map = { Leve: 'Leve', Intervalado: 'Intervalado', Moderado: 'Moderado', Longa: 'Longa', Prova: 'Prova / teste' };
    return map[tipo] || tipo;
  }
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  function isContinuous(tipo) { return tipo === 'Leve' || tipo === 'Moderado' || tipo === 'Longa'; }
  function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }

  // data local (não UTC) — evita o campo de data "pular" pro dia seguinte à noite no fuso do Brasil
  function localISOFromDate(d) {
    var tzOffsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
  }
  function todayLocalISO() { return localISOFromDate(new Date()); }
  function weekStartISO() {
    var d = new Date();
    var day = d.getDay(); // 0 = domingo
    var diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    return localISOFromDate(d);
  }
  function sundayOfCurrentWeek() {
    var d = new Date();
    d.setDate(d.getDate() - d.getDay());
    return d;
  }
  function mondayOfCurrentWeek() {
    var d = new Date();
    var day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  }
  var MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function semanaRangeLabel() {
    var monday = mondayOfCurrentWeek();
    var friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    var fmt = function (d) { return d.getDate() + ' ' + MONTH_ABBR[d.getMonth()]; };
    return 'Semana de ' + fmt(monday) + ' a ' + fmt(friday);
  }
  function countPlanoConcluidos() {
    var count = 0;
    for (var d = 1; d <= 5; d++) if (planoConcluido[d]) count++;
    return count;
  }
  function updateSemanaInfo() {
    var el = document.getElementById('semanaInfo');
    if (!el) return;
    el.innerHTML = semanaRangeLabel() + ' · <b>' + countPlanoConcluidos() + '/5</b> concluídos';
  }
  function computeStreak() {
    var streak = 0;
    var d = new Date();
    if (!checkins[todayLocalISO()]) d.setDate(d.getDate() - 1);
    while (true) {
      var iso = localISOFromDate(d);
      if (checkins[iso]) { streak++; d.setDate(d.getDate() - 1); } else break;
    }
    return streak;
  }

  function capitalize(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : str; }
  function usernameFromEmail(email) { return (email || '').split('@')[0]; }
  function getDisplayName(user) {
    if (user && user.user_metadata && user.user_metadata.nome) return user.user_metadata.nome;
    return capitalize(usernameFromEmail(user ? user.email : '')) || 'Usuário';
  }
  function avatarColorVar(user) {
    var seed = (user && user.id) || '';
    var sum = 0;
    for (var i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
    return AVATAR_COLORS[sum % AVATAR_COLORS.length];
  }
  function applyAvatar(el, user) {
    if (!el) return;
    var nome = getDisplayName(user);
    el.textContent = nome.charAt(0).toUpperCase();
    el.style.background = 'var(' + avatarColorVar(user) + ')';
  }

  function friendlyError(err) {
    if (!err) return 'Erro desconhecido.';
    var msg = err.message || String(err);
    if (/Invalid login credentials/i.test(msg)) return 'Usuário ou senha incorretos.';
    if (/User already registered/i.test(msg)) return 'Já existe uma conta com esse usuário. Tente entrar.';
    if (/Failed to fetch/i.test(msg) || /NetworkError/i.test(msg) || /network/i.test(msg)) {
      return 'Não foi possível conectar ao servidor. Verifique sua internet e tente de novo.';
    }
    return msg;
  }

  // Supabase Auth exige um "email" — convertemos o usuário escolhido num email sintético,
  // já que este app usa usuário+senha em vez de email de verdade.
  var USERNAME_DOMAIN = '@treino.local';
  function usernameToEmail(usuario) {
    var slug = usuario.trim().toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '') // remove acentos (João -> joao)
      .replace(/[^a-z0-9._-]/g, '');
    return slug + USERNAME_DOMAIN;
  }

  // ---------- tabs ----------
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('section[data-panel]').forEach(function (s) { s.classList.remove('active'); });
      btn.setAttribute('aria-selected', 'true');
      document.querySelector('section[data-panel="' + btn.getAttribute('data-target') + '"]').classList.add('active');
    });
  });

  // ---------- auth screens ----------
  function showAuthScreen(message) {
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'block';
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    if (message) document.getElementById('authError').textContent = message;
  }
  function showAppScreen() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'flex';
  }

  if (!configOk()) {
    showAuthScreen('Configure a URL e a chave do Supabase em config.js antes de entrar.');
  } else {
    supabase = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);

    document.getElementById('loginForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errorEl = document.getElementById('authError');
      errorEl.textContent = '';
      var usuario = document.getElementById('authUsuario').value.trim();
      var senha = document.getElementById('authSenha').value;
      supabase.auth.signInWithPassword({ email: usernameToEmail(usuario), password: senha }).then(function (res) {
        if (res.error) errorEl.textContent = friendlyError(res.error);
      }).catch(function (err) { errorEl.textContent = friendlyError(err); });
    });

    document.getElementById('signupForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errorEl = document.getElementById('signupError');
      errorEl.textContent = '';
      var nome = document.getElementById('signupNome').value.trim();
      var usuario = document.getElementById('signupUsuario').value.trim();
      var senha = document.getElementById('signupSenha').value;
      if (!nome || !usuario || senha.length < 6) {
        errorEl.textContent = 'Preencha o nome, o usuário e uma senha com pelo menos 6 caracteres.';
        return;
      }
      supabase.auth.signUp({
        email: usernameToEmail(usuario), password: senha, options: { data: { nome: nome } }
      }).then(function (res) {
        if (res.error) errorEl.textContent = friendlyError(res.error);
        else errorEl.textContent = 'Conta criada! Já pode entrar com esse usuário e senha.';
      }).catch(function (err) { errorEl.textContent = friendlyError(err); });
    });

    document.getElementById('showSignupBtn').addEventListener('click', function () {
      document.getElementById('authError').textContent = '';
      document.getElementById('loginForm').style.display = 'none';
      document.getElementById('signupForm').style.display = 'block';
    });
    document.getElementById('showLoginBtn').addEventListener('click', function () {
      document.getElementById('signupError').textContent = '';
      document.getElementById('signupForm').style.display = 'none';
      document.getElementById('loginForm').style.display = 'block';
    });

    document.getElementById('logoutBtn').addEventListener('click', function () {
      supabase.auth.signOut();
    });

    document.getElementById('perfilForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errorEl = document.getElementById('perfilError');
      errorEl.textContent = '';
      var novoNome = document.getElementById('perfilNomeInput').value.trim();
      if (!novoNome) { errorEl.textContent = 'Informe um nome.'; return; }
      supabase.auth.updateUser({ data: { nome: novoNome } }).then(function (res) {
        if (res.error) { errorEl.textContent = friendlyError(res.error); return; }
        currentUser = res.data.user;
        renderPerfil();
      }).catch(function (err) { errorEl.textContent = friendlyError(err); });
    });

    supabase.auth.onAuthStateChange(function (event, session) {
      if (session) {
        showAppScreen();
        initApp();
      } else {
        appInitialized = false; // permite recarregar do zero se logar com outra conta na mesma aba
        showAuthScreen();
      }
    });
  }

  // ---------- ritmos ----------
  function basePaceSeconds() {
    return ref.tempoSegundos / ref.distanciaKm;
  }

  function getPaceRanges() {
    var base = basePaceSeconds();
    var leve = ZONE_RATIOS.Leve.map(function (r) { return base * r; });
    var mod = ZONE_RATIOS.Moderado.map(function (r) { return base * r; });
    var longa = ZONE_RATIOS.Longa.map(function (r) { return base * r; });
    var intervPerKm = ZONE_RATIOS.Intervalado.map(function (r) { return base * r; });
    var intervPer400 = intervPerKm.map(function (s) { return s * 0.4; });
    return {
      base: base,
      Leve: formatClock(leve[1]) + '–' + formatClock(leve[0]),
      Moderado: formatClock(mod[1]) + '–' + formatClock(mod[0]),
      Longa: formatClock(longa[1]) + '–' + formatClock(longa[0]),
      Intervalado400: formatClock(intervPer400[0]) + '–' + formatClock(intervPer400[1])
    };
  }

  function renderZones() {
    var paces = getPaceRanges();
    document.getElementById('basePaceOut').textContent = formatClock(paces.base);
    document.getElementById('zoneLeveOut').textContent = paces.Leve + ' /km';
    document.getElementById('zoneModOut').textContent = paces.Moderado + ' /km';
    document.getElementById('zoneLongaOut').textContent = paces.Longa + ' /km';
    document.getElementById('zoneIntervOut').textContent = paces.Intervalado400;
  }

  document.getElementById('refUpdateBtn').addEventListener('click', function () {
    var errorEl = document.getElementById('refError');
    errorEl.textContent = '';
    var dist = parseFloat(document.getElementById('refDist').value);
    var tempoSec = parseTempoToSeconds(document.getElementById('refTempo').value);
    if (isNaN(dist) || dist <= 0) { errorEl.textContent = 'Informe uma distância válida.'; return; }
    if (tempoSec === null || tempoSec <= 0) { errorEl.textContent = 'Tempo inválido. Use mm:ss.'; return; }
    ref = { distanciaKm: dist, tempoSegundos: tempoSec };
    renderZones();
    renderStats();
    renderEntries();
    renderChart();
    renderPlano();
    supabase.auth.getUser().then(function (res) {
      var user = res.data.user;
      return supabase.from('referencia').upsert({
        user_id: user.id, distancia_km: dist, tempo_segundos: tempoSec, atualizado_em: new Date().toISOString()
      });
    }).then(function (res2) {
      if (res2.error) errorEl.textContent = friendlyError(res2.error);
    }).catch(function (err) { errorEl.textContent = friendlyError(err); });
  });

  // ---------- plano da semana ----------
  function renderExerciseLine(li, text, paces) {
    var re = /\{\{ritmo:(\w+)\}\}/g;
    var lastIndex = 0;
    var match;
    li.innerHTML = '';
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) li.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      var span = document.createElement('span');
      span.className = 'pace-fill';
      span.textContent = paces[match[1]] || '—';
      li.appendChild(span);
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) li.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  function onTogglePlanoDia(dia, checkbox) {
    var concluido = checkbox.checked;
    supabase.auth.getUser().then(function (res) {
      var user = res.data.user;
      return supabase.from('plano_progresso').upsert({
        user_id: user.id, semana_inicio: weekStartISO(), dia: dia, concluido: concluido
      }, { onConflict: 'user_id,semana_inicio,dia' });
    }).then(function (res2) {
      if (res2.error) { alert(friendlyError(res2.error)); checkbox.checked = !concluido; return; }
      planoConcluido[dia] = concluido;
      checkbox.closest('.day-card').classList.toggle('done', concluido);
      updateSemanaInfo();
    }).catch(function (err) {
      alert(friendlyError(err));
      checkbox.checked = !concluido;
    });
  }

  function renderPlano() {
    var container = document.getElementById('planoContainer');
    if (!container || !planoData) return;
    container.innerHTML = '';
    var paces = getPaceRanges();
    updateSemanaInfo();

    planoData.forEach(function (day) {
      var card = document.createElement('div');
      card.className = 'day-card';
      if (day.daytype) card.setAttribute('data-daytype', day.daytype);
      card.setAttribute('data-dia', day.dia);
      if (planoConcluido[day.dia]) card.classList.add('done');

      var labelRow = document.createElement('div');
      labelRow.className = 'day-label-row';
      var label = document.createElement('div');
      label.className = 'day-label';
      label.textContent = 'DIA ' + day.dia;
      labelRow.appendChild(label);

      if (!planoEditMode) {
        var doneLabel = document.createElement('label');
        doneLabel.className = 'day-done';
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'day-done-checkbox';
        checkbox.checked = !!planoConcluido[day.dia];
        checkbox.addEventListener('change', function () { onTogglePlanoDia(day.dia, checkbox); });
        doneLabel.appendChild(checkbox);
        doneLabel.appendChild(document.createTextNode(' Concluído'));
        labelRow.appendChild(doneLabel);
      }
      card.appendChild(labelRow);

      if (planoEditMode) {
        var titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'day-title-input';
        titleInput.value = day.titulo;
        titleInput.addEventListener('input', function () { day.titulo = titleInput.value; });
        card.appendChild(titleInput);
      } else {
        var title = document.createElement('div');
        title.className = 'day-title';
        title.textContent = day.titulo;
        card.appendChild(title);
      }

      var ul = document.createElement('ul');
      day.exercicios.forEach(function (ex, idx) {
        var li = document.createElement('li');
        if (planoEditMode) {
          li.className = 'exercicio-edit-row';
          var input = document.createElement('input');
          input.type = 'text';
          input.value = ex;
          input.addEventListener('input', function () { day.exercicios[idx] = input.value; });
          var rmBtn = document.createElement('button');
          rmBtn.type = 'button';
          rmBtn.className = 'exercicio-remove';
          rmBtn.textContent = '×';
          rmBtn.title = 'Remover linha';
          rmBtn.addEventListener('click', function () { day.exercicios.splice(idx, 1); renderPlano(); });
          li.appendChild(input);
          li.appendChild(rmBtn);
        } else {
          renderExerciseLine(li, ex, paces);
        }
        ul.appendChild(li);
      });
      card.appendChild(ul);

      if (planoEditMode) {
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'exercicio-add';
        addBtn.textContent = '+ adicionar exercício';
        addBtn.addEventListener('click', function () { day.exercicios.push(''); renderPlano(); });
        card.appendChild(addBtn);
      }

      container.appendChild(card);
    });
  }

  var planoEditBtn = document.getElementById('planoEditBtn');
  var planoEditActions = document.getElementById('planoEditActions');
  var planoSaveBtn = document.getElementById('planoSaveBtn');
  var planoCancelBtn = document.getElementById('planoCancelBtn');
  var planoRestoreBtn = document.getElementById('planoRestoreBtn');

  planoEditBtn.addEventListener('click', function () {
    planoBackup = deepCopy(planoData);
    planoEditMode = true;
    planoEditBtn.style.display = 'none';
    planoEditActions.style.display = 'flex';
    renderPlano();
  });

  planoCancelBtn.addEventListener('click', function () {
    planoData = planoBackup;
    planoEditMode = false;
    planoEditBtn.style.display = 'inline-block';
    planoEditActions.style.display = 'none';
    renderPlano();
  });

  planoRestoreBtn.addEventListener('click', function () {
    if (!confirm('Restaurar o plano padrão? Isso descarta as edições feitas nesta sessão (só é permanente depois de clicar em Salvar).')) return;
    planoData = deepCopy(DEFAULT_PLANO);
    renderPlano();
  });

  planoSaveBtn.addEventListener('click', function () {
    planoData.forEach(function (day) {
      day.titulo = (day.titulo || '').trim() || 'Sem título';
      day.exercicios = day.exercicios.map(function (e) { return e.trim(); }).filter(function (e) { return e.length > 0; });
    });
    planoSaveBtn.disabled = true;
    supabase.auth.getUser().then(function (res) {
      var user = res.data.user;
      return supabase.from('plano').upsert({
        user_id: user.id, dados: planoData, atualizado_em: new Date().toISOString()
      });
    }).then(function (res2) {
      planoSaveBtn.disabled = false;
      if (res2.error) { alert(friendlyError(res2.error)); return; }
      planoEditMode = false;
      planoEditBtn.style.display = 'inline-block';
      planoEditActions.style.display = 'none';
      renderPlano();
    }).catch(function (err) {
      planoSaveBtn.disabled = false;
      alert(friendlyError(err));
    });
  });

  // ---------- diário: check-in semanal ----------
  function renderCheckinStrip() {
    var strip = document.getElementById('weekStrip');
    if (!strip) return;
    strip.innerHTML = '';
    var sunday = sundayOfCurrentWeek();
    var todayISO = todayLocalISO();
    for (var i = 0; i < 7; i++) {
      var d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      var iso = localISOFromDate(d);
      var isFuture = iso > todayISO;
      var isToday = iso === todayISO;
      var cell = document.createElement('div');
      cell.className = 'week-day' + (checkins[iso] ? ' checked' : '') + (isToday ? ' today' : '') + (isFuture ? ' future' : '');
      var label = document.createElement('div');
      label.className = 'wd-label';
      label.textContent = isToday ? 'Hoje' : WEEKDAY_LABELS[i];
      var num = document.createElement('div');
      num.className = 'wd-num';
      num.textContent = String(d.getDate());
      cell.appendChild(label);
      cell.appendChild(num);
      if (!isFuture) {
        (function (isoClicked, cellClicked) {
          cellClicked.addEventListener('click', function () { onToggleCheckin(isoClicked, cellClicked); });
        })(iso, cell);
      }
      strip.appendChild(cell);
    }
    document.getElementById('streakCount').textContent = computeStreak();
  }

  function onToggleCheckin(iso, cell) {
    var anterior = checkins[iso];
    var novoValor = !anterior;
    checkins[iso] = novoValor;
    cell.classList.toggle('checked', novoValor);
    document.getElementById('streakCount').textContent = computeStreak();

    supabase.auth.getUser().then(function (res) {
      var user = res.data.user;
      return supabase.from('checkins').upsert({
        user_id: user.id, data: iso, feito: novoValor
      }, { onConflict: 'user_id,data' });
    }).then(function (res2) {
      if (res2.error) throw res2.error;
    }).catch(function (err) {
      alert(friendlyError(err));
      checkins[iso] = anterior;
      cell.classList.toggle('checked', !!anterior);
      document.getElementById('streakCount').textContent = computeStreak();
    });
  }

  // ---------- perfil ----------
  function renderPerfil() {
    if (!currentUser) return;
    var nome = getDisplayName(currentUser);
    applyAvatar(document.getElementById('perfilAvatar'), currentUser);
    document.getElementById('perfilNomeDisplay').textContent = nome;
    document.getElementById('perfilUsuarioDisplay').textContent = 'Usuário: ' + usernameFromEmail(currentUser.email);
    document.getElementById('perfilNomeInput').value = nome;

    applyAvatar(document.getElementById('sidebarAvatar'), currentUser);
    document.getElementById('sidebarNome').textContent = nome;
  }

  // ---------- diário: render ----------
  function metaTag(entry) {
    if (!isContinuous(entry.tipo)) return '';
    var base = basePaceSeconds();
    var range = ZONE_RATIOS[entry.tipo].map(function (r) { return base * r; });
    var pace = entry.tempoSegundos / entry.distancia;
    var low = Math.min(range[0], range[1]), high = Math.max(range[0], range[1]);
    var within = pace >= low && pace <= high;
    return '<span class="tag ' + (within ? 'ok' : 'off') + '">' + (within ? 'dentro do ritmo alvo' : 'fora do ritmo alvo') + '</span>';
  }

  function renderStats() {
    var count = entries.length;
    document.getElementById('statCount').textContent = count;
    if (count === 0) {
      document.getElementById('statDist').textContent = '0';
      document.getElementById('statPace').textContent = '—';
      return;
    }
    var totalDist = entries.reduce(function (sum, e) { return sum + e.distancia; }, 0);
    var totalSec = entries.reduce(function (sum, e) { return sum + e.tempoSegundos; }, 0);
    document.getElementById('statDist').textContent = totalDist.toFixed(1).replace('.0', '');
    if (totalDist > 0) document.getElementById('statPace').textContent = formatClock(totalSec / totalDist);
  }

  function renderEntries(highlightId) {
    var container = document.getElementById('entriesList');
    container.innerHTML = '';
    if (entries.length === 0) {
      container.innerHTML = '<div class="empty">Nenhum treino registrado ainda. Adicione o primeiro ali em cima.</div>';
      return;
    }
    var sorted = entries.slice().sort(function (a, b) {
      if (a.data !== b.data) return a.data < b.data ? 1 : -1;
      return (b.criadoEm || '') < (a.criadoEm || '') ? -1 : 1;
    });
    sorted.forEach(function (e) {
      var pace = e.distancia > 0 ? formatClock(e.tempoSegundos / e.distancia) : '—';
      var div = document.createElement('div');
      div.className = 'entry' + (e.id === highlightId ? ' new' : '');
      div.setAttribute('data-tipo', e.tipo);
      div.innerHTML =
        '<div>' +
          '<div class="entry-top">' +
            '<span class="entry-date">' + formatDate(e.data) + '</span>' +
            '<span class="tag">' + tipoLabel(e.tipo) + '</span>' +
            metaTag(e) +
          '</div>' +
          '<div class="entry-metrics">' +
            '<span>' + e.distancia.toFixed(2).replace(/\.?0+$/, '') + ' km</span>' +
            '<span><b>' + formatClock(e.tempoSegundos) + '</b></span>' +
            '<span>' + pace + ' /km</span>' +
          '</div>' +
          (e.notas ? '<div class="entry-notes">' + escapeHtml(e.notas) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex; flex-direction:column; gap:6px;">' +
          '<button class="remove-btn edit-btn" data-id="' + e.id + '">Editar</button>' +
          '<button class="remove-btn" data-id="' + e.id + '">Remover</button>' +
        '</div>';
      container.appendChild(div);
    });
    container.querySelectorAll('.edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { startEdit(btn.getAttribute('data-id')); });
    });
    container.querySelectorAll('.remove-btn:not(.edit-btn)').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('Remover esse treino? Essa ação não pode ser desfeita.')) return;
        var id = btn.getAttribute('data-id');
        btn.disabled = true;
        supabase.from('treinos').delete().eq('id', id).then(function (res) {
          if (res.error) { alert(friendlyError(res.error)); btn.disabled = false; return; }
          entries = entries.filter(function (e) { return String(e.id) !== id; });
          if (editingId === id) cancelEdit();
          renderStats();
          renderEntries();
          renderChart();
        }).catch(function (err) {
          alert(friendlyError(err));
          btn.disabled = false;
        });
      });
    });
  }

  // ---------- diário: gráfico ----------
  function renderChart() {
    var canvas = document.getElementById('paceChart');
    var emptyMsg = document.getElementById('chartEmpty');
    if (!canvas || !window.Chart) return;
    var continuous = entries.filter(function (e) { return isContinuous(e.tipo); })
      .slice()
      .sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });

    if (paceChart) { paceChart.destroy(); paceChart = null; }

    if (continuous.length < 2) {
      canvas.style.display = 'none';
      if (emptyMsg) emptyMsg.style.display = 'block';
      return;
    }
    canvas.style.display = 'block';
    if (emptyMsg) emptyMsg.style.display = 'none';

    var labels = continuous.map(function (e) { return formatDate(e.data); });
    var data = continuous.map(function (e) { return (e.tempoSegundos / e.distancia) / 60; });

    paceChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Ritmo (min/km)',
          data: data,
          borderColor: '#2563A8',
          backgroundColor: 'rgba(37,99,168,0.15)',
          tension: 0.25,
          fill: true,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return 'Ritmo: ' + formatClock(ctx.parsed.y * 60) + ' /km'; } } }
        },
        scales: {
          y: { reverse: true, ticks: { callback: function (v) { return formatClock(v * 60); } } }
        }
      }
    });
  }

  // ---------- diário: form (criar / editar) ----------
  var form = document.getElementById('entryForm');
  var formTitle = document.getElementById('formTitle');
  var submitBtn = document.getElementById('submitBtn');
  var cancelEditBtn = document.getElementById('cancelEditBtn');

  function startEdit(id) {
    var e = entries.find(function (x) { return String(x.id) === String(id); });
    if (!e) return;
    editingId = e.id;
    document.getElementById('fData').value = e.data;
    document.getElementById('fTipo').value = e.tipo;
    document.getElementById('fDist').value = e.distancia;
    document.getElementById('fTempo').value = formatClock(e.tempoSegundos);
    document.getElementById('fNotas').value = e.notas || '';
    formTitle.textContent = 'Editar treino';
    submitBtn.textContent = 'Atualizar treino';
    cancelEditBtn.style.display = 'block';
    document.querySelector('.tab-btn[data-target="diario"]').click();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelEdit() {
    editingId = null;
    form.reset();
    document.getElementById('fTipo').value = 'Moderado';
    document.getElementById('fData').value = todayLocalISO();
    formTitle.textContent = 'Novo treino';
    submitBtn.textContent = 'Salvar treino';
    cancelEditBtn.style.display = 'none';
  }
  cancelEditBtn.addEventListener('click', cancelEdit);

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var errorEl = document.getElementById('formError');
    errorEl.textContent = '';
    var data = document.getElementById('fData').value;
    var tipo = document.getElementById('fTipo').value;
    var distancia = parseFloat(document.getElementById('fDist').value);
    var tempoStr = document.getElementById('fTempo').value;
    var notas = document.getElementById('fNotas').value;
    if (!data || !tipo || isNaN(distancia) || distancia <= 0) {
      errorEl.textContent = 'Preencha a data, o tipo e a distância corretamente.';
      return;
    }
    var tempoSegundos = parseTempoToSeconds(tempoStr);
    if (tempoSegundos === null || tempoSegundos <= 0) {
      errorEl.textContent = 'Tempo inválido. Use o formato mm:ss (ex: 42:57).';
      return;
    }
    submitBtn.disabled = true;

    if (editingId) {
      supabase.from('treinos').update({
        data: data, tipo: tipo, distancia: distancia, tempo_segundos: tempoSegundos, notas: notas.trim()
      }).eq('id', editingId).select().single().then(function (res) {
        submitBtn.disabled = false;
        if (res.error) { errorEl.textContent = friendlyError(res.error); return; }
        var row = res.data;
        var idx = entries.findIndex(function (e) { return String(e.id) === String(editingId); });
        if (idx > -1) {
          entries[idx] = { id: row.id, data: row.data, tipo: row.tipo, distancia: Number(row.distancia), tempoSegundos: row.tempo_segundos, notas: row.notas || '', criadoEm: row.criado_em };
        }
        renderStats(); renderEntries(editingId); renderChart();
        cancelEdit();
      }).catch(function (err) {
        submitBtn.disabled = false;
        errorEl.textContent = friendlyError(err);
      });
    } else {
      supabase.auth.getUser().then(function (res) {
        var user = res.data.user;
        return supabase.from('treinos').insert({
          user_id: user.id, data: data, tipo: tipo, distancia: distancia, tempo_segundos: tempoSegundos, notas: notas.trim()
        }).select().single();
      }).then(function (res2) {
        submitBtn.disabled = false;
        if (res2.error) { errorEl.textContent = friendlyError(res2.error); return; }
        var row = res2.data;
        entries.push({ id: row.id, data: row.data, tipo: row.tipo, distancia: Number(row.distancia), tempoSegundos: row.tempo_segundos, notas: row.notas || '', criadoEm: row.criado_em });
        renderStats(); renderEntries(row.id); renderChart();
        form.reset();
        document.getElementById('fTipo').value = 'Moderado';
        document.getElementById('fData').value = todayLocalISO();
      }).catch(function (err) {
        submitBtn.disabled = false;
        errorEl.textContent = friendlyError(err);
      });
    }
  });

  // ---------- importar dados antigos do localStorage ----------
  function checkLocalImport() {
    var btn = document.getElementById('importLocalBtn');
    if (!btn) return;
    var raw = null;
    try { raw = localStorage.getItem(LOCAL_ENTRIES_KEY); } catch (e) {}
    var local = [];
    try { local = raw ? JSON.parse(raw) : []; } catch (e) { local = []; }
    if (entries.length > 0 || local.length === 0) { btn.style.display = 'none'; return; }
    btn.style.display = 'block';
    btn.onclick = function () {
      btn.disabled = true;
      btn.textContent = 'Importando...';
      supabase.auth.getUser().then(function (res) {
        var user = res.data.user;
        var rows = local.map(function (e) {
          return {
            user_id: user.id, data: e.data, tipo: e.tipo, distancia: e.distancia,
            tempo_segundos: e.tempoSegundos, notas: e.notas || ''
          };
        });
        return supabase.from('treinos').insert(rows);
      }).then(function (res2) {
        if (res2.error) { alert(friendlyError(res2.error)); btn.disabled = false; btn.textContent = 'Importar treinos salvos neste navegador'; return; }
        btn.style.display = 'none';
        loadEntries().then(function () { renderStats(); renderEntries(); renderChart(); });
      }).catch(function (err) {
        alert(friendlyError(err));
        btn.disabled = false;
        btn.textContent = 'Importar treinos salvos neste navegador';
      });
    };
  }

  // ---------- carregamento ----------
  function loadRef() {
    return supabase.from('referencia').select('*').maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      if (res.data) ref = { distanciaKm: Number(res.data.distancia_km), tempoSegundos: res.data.tempo_segundos };
      else ref = DEFAULT_REF;
    });
  }
  function loadEntries() {
    return supabase.from('treinos').select('*').then(function (res) {
      if (res.error) throw res.error;
      entries = (res.data || []).map(function (row) {
        return { id: row.id, data: row.data, tipo: row.tipo, distancia: Number(row.distancia), tempoSegundos: row.tempo_segundos, notas: row.notas || '', criadoEm: row.criado_em };
      });
    });
  }
  function loadPlanoProgresso() {
    return supabase.from('plano_progresso').select('*').eq('semana_inicio', weekStartISO()).then(function (res) {
      if (res.error) throw res.error;
      planoConcluido = {};
      (res.data || []).forEach(function (row) { planoConcluido[row.dia] = row.concluido; });
    });
  }
  function loadPlanoData() {
    // não fatal: se a tabela `plano` ainda não existir (ex: schema.sql não atualizado),
    // cai pro plano padrão em vez de travar o resto do app.
    return supabase.from('plano').select('dados').maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      planoData = (res.data && res.data.dados) ? res.data.dados : deepCopy(DEFAULT_PLANO);
    }).catch(function (err) {
      console.warn('Não foi possível carregar o plano salvo, usando o padrão:', err);
      planoData = deepCopy(DEFAULT_PLANO);
    });
  }
  function loadUser() {
    return supabase.auth.getUser().then(function (res) {
      if (res.error) throw res.error;
      currentUser = res.data.user;
    });
  }
  function loadCheckins() {
    // não fatal: se a tabela `checkins` ainda não existir, a tira de dias fica zerada em vez de travar o app.
    var start = new Date();
    start.setDate(start.getDate() - 60);
    return supabase.from('checkins').select('data,feito').gte('data', localISOFromDate(start)).then(function (res) {
      if (res.error) throw res.error;
      checkins = {};
      (res.data || []).forEach(function (row) { if (row.feito) checkins[row.data] = true; });
    }).catch(function (err) {
      console.warn('Não foi possível carregar os check-ins:', err);
      checkins = {};
    });
  }

  var appInitialized = false;
  function initApp() {
    if (appInitialized) return;
    appInitialized = true;
    Promise.all([loadRef(), loadEntries(), loadPlanoProgresso(), loadPlanoData(), loadUser(), loadCheckins()]).then(function () {
      document.getElementById('refDist').value = ref.distanciaKm;
      document.getElementById('refTempo').value = formatClock(ref.tempoSegundos);
      document.getElementById('fData').value = todayLocalISO();
      renderZones();
      renderStats();
      renderEntries();
      renderChart();
      renderPlano();
      renderCheckinStrip();
      renderPerfil();
      checkLocalImport();
    }).catch(function (err) {
      appInitialized = false;
      alert('Não foi possível carregar seus dados: ' + friendlyError(err) + '\n\nVerifique sua internet e recarregue a página.');
    });
  }

  // ---------- service worker (PWA) ----------
  if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* silencioso: app funciona sem SW */ });
    });
  }
})();
