(function () {
  'use strict';

  var LOCAL_ENTRIES_KEY = 'diario-corrida-enzo-v1';
  var LOCAL_REF_KEY = 'ritmo-referencia-enzo-v1';
  var DEFAULT_REF = { distanciaKm: 5, tempoSegundos: 2577 }; // padrão: 5km em 42:57

  var ZONE_RATIOS = {
    Leve: [1.14, 1.19],
    Moderado: [1.03, 1.07],
    Longa: [1.14, 1.19],
    Intervalado: [0.95, 1.00]
  };

  var entries = [];
  var ref = DEFAULT_REF;
  var planoConcluido = {}; // { "1": true, ... } para a semana atual
  var editingId = null;
  var paceChart = null;
  var supabase = null;

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

  function friendlyError(err) {
    if (!err) return 'Erro desconhecido.';
    var msg = err.message || String(err);
    if (/Invalid login credentials/i.test(msg)) return 'Usuário ou senha incorretos.';
    if (/User already registered/i.test(msg)) return 'Já existe uma conta com esse usuário. Tente entrar.';
    if (/Failed to fetch/i.test(msg)) return 'Não foi possível conectar ao servidor. Verifique sua internet e o config.js.';
    return msg;
  }

  // Supabase Auth exige um "email" — convertemos o usuário escolhido num email sintético,
  // já que este app usa usuário+senha em vez de email de verdade.
  var USERNAME_DOMAIN = '@treino.local';
  function usernameToEmail(usuario) {
    var slug = usuario.trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos (João -> joao)
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
    if (message) document.getElementById('authError').textContent = message;
  }
  function showAppScreen() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'block';
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
      });
    });

    document.getElementById('signupBtn').addEventListener('click', function () {
      var errorEl = document.getElementById('authError');
      errorEl.textContent = '';
      var usuario = document.getElementById('authUsuario').value.trim();
      var senha = document.getElementById('authSenha').value;
      if (!usuario || senha.length < 6) {
        errorEl.textContent = 'Preencha o usuário e uma senha com pelo menos 6 caracteres.';
        return;
      }
      supabase.auth.signUp({ email: usernameToEmail(usuario), password: senha }).then(function (res) {
        if (res.error) errorEl.textContent = friendlyError(res.error);
        else errorEl.textContent = 'Conta criada! Já pode entrar com esse usuário e senha.';
      });
    });

    document.getElementById('logoutBtn').addEventListener('click', function () {
      supabase.auth.signOut();
    });

    supabase.auth.onAuthStateChange(function (event, session) {
      if (session) {
        showAppScreen();
        initApp();
      } else {
        showAuthScreen();
      }
    });
  }

  // ---------- ritmos ----------
  function basePaceSeconds() {
    return ref.tempoSegundos / ref.distanciaKm;
  }

  function renderZones() {
    var base = basePaceSeconds();
    document.getElementById('basePaceOut').textContent = formatClock(base);

    var leve = ZONE_RATIOS.Leve.map(function (r) { return base * r; });
    var mod = ZONE_RATIOS.Moderado.map(function (r) { return base * r; });
    var longa = ZONE_RATIOS.Longa.map(function (r) { return base * r; });
    var intervPerKm = ZONE_RATIOS.Intervalado.map(function (r) { return base * r; });
    var intervPer400 = intervPerKm.map(function (s) { return s * 0.4; });

    document.getElementById('zoneLeveOut').textContent = formatClock(leve[1]) + ' – ' + formatClock(leve[0]) + ' /km';
    document.getElementById('zoneModOut').textContent = formatClock(mod[1]) + ' – ' + formatClock(mod[0]) + ' /km';
    document.getElementById('zoneLongaOut').textContent = formatClock(longa[1]) + ' – ' + formatClock(longa[0]) + ' /km';
    document.getElementById('zoneIntervOut').textContent = formatClock(intervPer400[0]) + ' – ' + formatClock(intervPer400[1]);

    document.querySelectorAll('.pace-fill[data-zone="Leve"]').forEach(function (el) {
      el.textContent = formatClock(leve[1]) + '–' + formatClock(leve[0]);
    });
    document.querySelectorAll('.pace-fill[data-zone="Moderado"]').forEach(function (el) {
      el.textContent = formatClock(mod[1]) + '–' + formatClock(mod[0]);
    });
    document.querySelectorAll('.pace-fill[data-zone="Longa"]').forEach(function (el) {
      el.textContent = formatClock(longa[1]) + '–' + formatClock(longa[0]);
    });
    document.querySelectorAll('.pace-fill[data-zone="Intervalado400"]').forEach(function (el) {
      el.textContent = formatClock(intervPer400[0]) + '–' + formatClock(intervPer400[1]);
    });
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
    supabase.auth.getUser().then(function (res) {
      var user = res.data.user;
      supabase.from('referencia').upsert({
        user_id: user.id, distancia_km: dist, tempo_segundos: tempoSec, atualizado_em: new Date().toISOString()
      }).then(function (res2) {
        if (res2.error) errorEl.textContent = friendlyError(res2.error);
      });
    });
  });

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
      return (b.criadoEm || 0) < (a.criadoEm || 0) ? -1 : 1;
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
        var id = btn.getAttribute('data-id');
        supabase.from('treinos').delete().eq('id', id).then(function (res) {
          if (res.error) { alert(friendlyError(res.error)); return; }
          entries = entries.filter(function (e) { return String(e.id) !== id; });
          if (editingId === id) cancelEdit();
          renderStats();
          renderEntries();
          renderChart();
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
      }).eq('id', editingId).select().then(function (res) {
        submitBtn.disabled = false;
        if (res.error) { errorEl.textContent = friendlyError(res.error); return; }
        var idx = entries.findIndex(function (e) { return String(e.id) === String(editingId); });
        if (idx > -1) entries[idx] = { id: editingId, data: data, tipo: tipo, distancia: distancia, tempoSegundos: tempoSegundos, notas: notas.trim() };
        renderStats(); renderEntries(editingId); renderChart();
        cancelEdit();
      });
    } else {
      supabase.auth.getUser().then(function (res) {
        var user = res.data.user;
        supabase.from('treinos').insert({
          user_id: user.id, data: data, tipo: tipo, distancia: distancia, tempo_segundos: tempoSegundos, notas: notas.trim()
        }).select().single().then(function (res2) {
          submitBtn.disabled = false;
          if (res2.error) { errorEl.textContent = friendlyError(res2.error); return; }
          var row = res2.data;
          entries.push({ id: row.id, data: row.data, tipo: row.tipo, distancia: Number(row.distancia), tempoSegundos: row.tempo_segundos, notas: row.notas || '', criadoEm: row.criado_em });
          renderStats(); renderEntries(row.id); renderChart();
          form.reset();
          document.getElementById('fTipo').value = 'Moderado';
          document.getElementById('fData').value = todayLocalISO();
        });
      });
    }
  });

  // ---------- plano: checkboxes de conclusão ----------
  function renderPlanoState() {
    document.querySelectorAll('.day-card[data-dia]').forEach(function (card) {
      var dia = card.getAttribute('data-dia');
      var checkbox = card.querySelector('.day-done-checkbox');
      var done = !!planoConcluido[dia];
      if (checkbox) checkbox.checked = done;
      card.classList.toggle('done', done);
    });
  }

  document.querySelectorAll('.day-done-checkbox').forEach(function (checkbox) {
    checkbox.addEventListener('change', function () {
      var card = checkbox.closest('.day-card');
      var dia = parseInt(card.getAttribute('data-dia'), 10);
      var concluido = checkbox.checked;
      supabase.auth.getUser().then(function (res) {
        var user = res.data.user;
        supabase.from('plano_progresso').upsert({
          user_id: user.id, semana_inicio: weekStartISO(), dia: dia, concluido: concluido
        }, { onConflict: 'user_id,semana_inicio,dia' }).then(function (res2) {
          if (res2.error) { alert(friendlyError(res2.error)); checkbox.checked = !concluido; return; }
          planoConcluido[dia] = concluido;
          card.classList.toggle('done', concluido);
        });
      });
    });
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
        supabase.from('treinos').insert(rows).then(function (res2) {
          if (res2.error) { alert(friendlyError(res2.error)); btn.disabled = false; btn.textContent = 'Importar treinos salvos neste navegador'; return; }
          btn.style.display = 'none';
          loadEntries().then(function () { renderStats(); renderEntries(); renderChart(); });
        });
      });
    };
  }

  // ---------- carregamento ----------
  function loadRef() {
    return supabase.from('referencia').select('*').maybeSingle().then(function (res) {
      if (res.data) ref = { distanciaKm: Number(res.data.distancia_km), tempoSegundos: res.data.tempo_segundos };
      else ref = DEFAULT_REF;
    });
  }
  function loadEntries() {
    return supabase.from('treinos').select('*').then(function (res) {
      entries = (res.data || []).map(function (row) {
        return { id: row.id, data: row.data, tipo: row.tipo, distancia: Number(row.distancia), tempoSegundos: row.tempo_segundos, notas: row.notas || '', criadoEm: row.criado_em };
      });
    });
  }
  function loadPlano() {
    return supabase.from('plano_progresso').select('*').eq('semana_inicio', weekStartISO()).then(function (res) {
      planoConcluido = {};
      (res.data || []).forEach(function (row) { planoConcluido[row.dia] = row.concluido; });
    });
  }

  var appInitialized = false;
  function initApp() {
    if (appInitialized) return;
    appInitialized = true;
    Promise.all([loadRef(), loadEntries(), loadPlano()]).then(function () {
      document.getElementById('refDist').value = ref.distanciaKm;
      document.getElementById('refTempo').value = formatClock(ref.tempoSegundos);
      document.getElementById('fData').value = todayLocalISO();
      renderZones();
      renderStats();
      renderEntries();
      renderChart();
      renderPlanoState();
      checkLocalImport();
    });
  }

  // ---------- service worker (PWA) ----------
  if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* silencioso: app funciona sem SW */ });
    });
  }
})();
