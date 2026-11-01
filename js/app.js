(function () {
  'use strict';

  /* ---------- Registro dos módulos ---------- */
  var MODULOS = [];
  var QUESTOES = {}; // id -> questão (com .modulo)
  window.registrarModulo = function (m) { MODULOS.push(m); };

  /* ---------- Armazenamento (fica só neste navegador) ---------- */
  var CHAVE = 'deutsch-ueben-v1';
  var estado = { q: {}, suspeitas: {}, prefs: {} };
  try {
    var salvo = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (salvo && typeof salvo === 'object') estado = salvo;
  } catch (e) { /* sem armazenamento: segue só na memória */ }
  estado.q = estado.q || {};
  estado.suspeitas = estado.suspeitas || {};
  estado.prefs = estado.prefs || {};
  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (e) { /* ignora */ }
  }

  /* ---------- Utilidades ---------- */
  var app = document.getElementById('app');
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function embaralhar(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  // Mesma regra do tools/gerar_audio.py — não altere uma sem a outra.
  function slug(t) {
    return String(t).normalize('NFC').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function normalizar(t) {
    return String(t).normalize('NFC').toLowerCase()
      .replace(/[’'`´]/g, '')
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[.,!?;:"“”„¡¿()]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function st(id) { return estado.q[id]; }
  function nomeModulo(m) { return 'Módulo ' + m.numero; }

  /* ---------- Áudio ---------- */
  var ICONE_SOM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  var vozesDe = [];
  function atualizarVozes() {
    if (!('speechSynthesis' in window)) return;
    vozesDe = speechSynthesis.getVoices().filter(function (v) { return /^de([-_]|$)/i.test(v.lang); });
  }
  if ('speechSynthesis' in window) {
    atualizarVozes();
    speechSynthesis.onvoiceschanged = atualizarVozes;
  }
  function melhorVoz() {
    var nota = function (v) {
      var n = v.name || '';
      if (/natural|online/i.test(n)) return 4;
      if (/premium|enhanced|aprimorad/i.test(n)) return 3;
      if (/google/i.test(n)) return 2;
      if (/de-DE/i.test(v.lang)) return 1;
      return 0;
    };
    return vozesDe.slice().sort(function (a, b) { return nota(b) - nota(a); })[0] || null;
  }
  function falarNavegador(texto) {
    if (!('speechSynthesis' in window)) return;
    var u = new SpeechSynthesisUtterance(texto);
    u.lang = 'de-DE';
    var v = melhorVoz();
    if (v) u.voice = v;
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  function infoAudio(texto) {
    var m = (window.AUDIO_MANIFEST || {})[slug(texto)];
    if (m && m.arquivo) return m;
    return null;
  }
  function rotuloFonte(texto) {
    var m = infoAudio(texto);
    if (!m) return 'voz do navegador';
    return m.fonte === 'wikimedia' ? 'voz humana' : 'voz sintética';
  }
  var audioAtual = null;
  function tocar(texto, botao) {
    var m = infoAudio(texto);
    if (audioAtual) { audioAtual.pause(); audioAtual = null; }
    document.querySelectorAll('.ouvir.tocando').forEach(function (b) { b.classList.remove('tocando'); });
    if (botao) botao.classList.add('tocando');
    var fim = function () { if (botao) botao.classList.remove('tocando'); };
    if (m) {
      var a = new Audio(m.arquivo);
      audioAtual = a;
      a.onended = fim;
      a.play().catch(function () { fim(); falarNavegador(texto); });
    } else {
      falarNavegador(texto);
      setTimeout(fim, 1200);
    }
  }
  function botoesAudio(lista) {
    if (!lista || !lista.length) return '';
    return '<div class="audios">' + lista.map(function (t) {
      return '<button class="ouvir" data-ouvir="' + esc(t) + '" title="Ouvir (' + esc(rotuloFonte(t)) + ')">' +
        ICONE_SOM + '<span>' + esc(t) + '</span><span class="fonte-audio">' + esc(rotuloFonte(t)) + '</span></button>';
    }).join('') + '</div>';
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-ouvir]');
    if (b) tocar(b.getAttribute('data-ouvir'), b);
  });

  /* ---------- Seleção e montagem da rodada ---------- */
  var prefs = estado.prefs;
  prefs.modulos = prefs.modulos || [];
  prefs.aulas = prefs.aulas || {};
  prefs.tamanho = prefs.tamanho || 10;
  prefs.soErros = !!prefs.soErros;

  function questoesSelecionadas() {
    var lista = [];
    MODULOS.forEach(function (m) {
      if (prefs.modulos.indexOf(m.id) < 0) return;
      var filtro = prefs.aulas[m.id] || [];
      m.questoes.forEach(function (q) {
        if (filtro.length && filtro.indexOf(q.aula) < 0) return;
        lista.push(q);
      });
    });
    if (prefs.soErros) lista = lista.filter(function (q) { return st(q.id) && st(q.id).u === 0; });
    return lista;
  }

  // Prioridade: questões nunca vistas e as que você errou por último.
  // As já acertadas só voltam quando as outras acabam (as mais antigas primeiro).
  function montarRodada() {
    var pool = questoesSelecionadas();
    var n = prefs.tamanho === 'todas' ? pool.length : Math.min(prefs.tamanho, pool.length);
    var novas = [], erradas = [], certas = [];
    pool.forEach(function (q) {
      var s = st(q.id);
      if (!s) novas.push(q);
      else if (s.u === 0) erradas.push(q);
      else certas.push(q);
    });
    novas = embaralhar(novas);
    erradas = embaralhar(erradas);
    certas.sort(function (a, b) { return (st(a.id).t || 0) - (st(b.id).t || 0); });
    var cotaErradas = prefs.soErros ? n : Math.ceil(n * 0.3);
    var escolha = erradas.splice(0, cotaErradas);
    var resto = novas.concat(erradas, certas);
    escolha = escolha.concat(resto.slice(0, n - escolha.length));
    return embaralhar(escolha);
  }

  /* ---------- Navegação ---------- */
  var aba = 'praticar';
  var rodada = null;
  var confirmarZerar = false;

  document.querySelectorAll('.abas button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (rodada && !rodada.fim && b.dataset.aba !== 'praticar') {
        // a rodada continua guardada; volta a ela ao clicar em Praticar
      }
      aba = b.dataset.aba;
      document.querySelectorAll('.abas button').forEach(function (x) {
        x.setAttribute('aria-selected', String(x === b));
      });
      render();
    });
  });

  function render() {
    confirmarZerar = false;
    if (aba === 'progresso') return renderProgresso();
    if (aba === 'creditos') return renderCreditos();
    if (rodada && !rodada.fim) return renderQuestao();
    if (rodada && rodada.fim) return renderResultado();
    renderInicio();
  }

  /* ---------- Tela inicial ---------- */
  function resumoModulo(m) {
    var vistas = 0, certas = 0, erradas = 0;
    m.questoes.forEach(function (q) {
      var s = st(q.id);
      if (!s) return;
      vistas++;
      if (s.u === 1) certas++; else erradas++;
    });
    return { total: m.questoes.length, vistas: vistas, certas: certas, erradas: erradas };
  }

  function renderInicio() {
    if (!MODULOS.length) {
      app.innerHTML = '<div class="aviso">Nenhum módulo encontrado. Confira o arquivo data/modulos.js.</div>';
      return;
    }
    var html = '<h2>O que vamos revisar?</h2><p class="sub">Marque um ou mais módulos. Para focar em aulas específicas, toque nelas (sem nenhuma marcada, entram todas).</p><div class="pilha">';
    MODULOS.forEach(function (m) {
      var r = resumoModulo(m);
      var marcado = prefs.modulos.indexOf(m.id) >= 0;
      var filtro = prefs.aulas[m.id] || [];
      html += '<div class="cartao modulo"><label class="modulo-topo"><input type="checkbox" data-mod="' + esc(m.id) + '"' + (marcado ? ' checked' : '') + '>' +
        '<span style="flex:1"><span class="modulo-nome">' + esc(nomeModulo(m)) + ' · ' + esc(m.titulo) + '</span><br>' +
        '<span class="modulo-info">' + r.total + ' questões · ' + r.vistas + ' já respondidas' +
        (r.erradas ? ' · ' + r.erradas + ' para rever' : '') + '</span>' +
        '<span class="barra"><span class="b-certo" style="width:' + (100 * r.certas / r.total) + '%"></span><span class="b-erro" style="width:' + (100 * r.erradas / r.total) + '%"></span></span>' +
        '</span></label>';
      if (marcado) {
        html += '<div class="aulas">' + m.aulas.map(function (a) {
          return '<button class="chip-aula" data-aula-mod="' + esc(m.id) + '" data-aula="' + a.n + '" aria-pressed="' + (filtro.indexOf(a.n) >= 0) + '" title="' + esc(a.titulo) + '">Aula ' + a.n + '</button>';
        }).join('') + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    var pool = questoesSelecionadas();
    var nunca = pool.filter(function (q) { return !st(q.id); }).length;
    html += '<div class="cartao" style="margin-top:14px"><span class="rotulo">Questões por rodada</span><div class="opcoes-linha"><div class="seg">' +
      [10, 15, 20, 'todas'].map(function (n) {
        return '<button data-tam="' + n + '" aria-pressed="' + (String(prefs.tamanho) === String(n)) + '">' + (n === 'todas' ? 'Todas' : n) + '</button>';
      }).join('') + '</div></div>' +
      '<label class="check" style="margin-top:12px"><input type="checkbox" id="soErros"' + (prefs.soErros ? ' checked' : '') + '> Só questões que errei da última vez</label>' +
      '<p class="mudo" style="margin:10px 0 12px">' + (prefs.modulos.length
        ? pool.length + ' questões nesta seleção · ' + nunca + ' que você nunca viu'
        : 'Escolha pelo menos um módulo.') + '</p>' +
      '<button class="btn btn-principal btn-grande" id="comecar"' + (pool.length ? '' : ' disabled') + '>Começar</button></div>';
    app.innerHTML = html;

    app.querySelectorAll('[data-mod]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-mod');
        var i = prefs.modulos.indexOf(id);
        if (cb.checked && i < 0) prefs.modulos.push(id);
        if (!cb.checked && i >= 0) prefs.modulos.splice(i, 1);
        salvar(); renderInicio();
      });
    });
    app.querySelectorAll('[data-aula]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-aula-mod'), n = Number(b.getAttribute('data-aula'));
        var f = prefs.aulas[id] = prefs.aulas[id] || [];
        var i = f.indexOf(n);
        if (i >= 0) f.splice(i, 1); else f.push(n);
        salvar(); renderInicio();
      });
    });
    app.querySelectorAll('[data-tam]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-tam');
        prefs.tamanho = v === 'todas' ? 'todas' : Number(v);
        salvar(); renderInicio();
      });
    });
    document.getElementById('soErros').addEventListener('change', function (e) {
      prefs.soErros = e.target.checked; salvar(); renderInicio();
    });
    document.getElementById('comecar').addEventListener('click', iniciarRodada);
  }

  function iniciarRodada() {
    var lista = montarRodada();
    if (!lista.length) return;
    rodada = { lista: lista, i: 0, respostas: [], respondida: false, fim: false };
    renderQuestao();
    window.scrollTo(0, 0);
  }

  /* ---------- Questão ---------- */
  var NOMES_TIPO = { multipla: 'Múltipla escolha', vf: 'Verdadeiro ou falso', digitar: 'Digite a resposta', aberta: 'Resposta livre' };

  function renderQuestao() {
    var q = rodada.lista[rodada.i];
    var m = q.modulo;
    rodada.respondida = false;
    var html = '<div class="quiz-topo"><span>' + esc(nomeModulo(m)) + ' · Aula ' + q.aula + '</span><span>' + (rodada.i + 1) + ' / ' + rodada.lista.length + '</span></div>' +
      '<div class="progresso-quiz"><div style="width:' + (100 * rodada.i / rodada.lista.length) + '%"></div></div>' +
      '<div class="cartao"><span class="etiqueta">' + NOMES_TIPO[q.tipo] + '</span>' +
      '<div class="pergunta">' + esc(q.pergunta) + '</div><div id="corpo"></div><div id="retorno"></div>' +
      '<div class="acoes" id="acoes" hidden><button class="btn-texto suspeita" id="btnSuspeita"></button>' +
      '<button class="btn btn-principal" id="proxima">' + (rodada.i + 1 < rodada.lista.length ? 'Próxima' : 'Ver resultado') + '</button></div>' +
      '<div id="areaSuspeita"></div></div>' +
      '<p style="margin-top:12px"><button class="btn-texto" id="encerrar">Encerrar rodada</button></p>';
    app.innerHTML = html;
    var corpo = document.getElementById('corpo');

    if (q.tipo === 'multipla') {
      var ordem = embaralhar(q.opcoes.map(function (_, i) { return i; }));
      corpo.innerHTML = '<div class="alternativas">' + ordem.map(function (idx, pos) {
        return '<button class="alt" data-idx="' + idx + '"><span class="letra">' + 'ABCD'[pos] + '</span><span>' + esc(q.opcoes[idx]) + '</span></button>';
      }).join('') + '</div>';
      corpo.querySelectorAll('.alt').forEach(function (b) {
        b.addEventListener('click', function () {
          if (rodada.respondida) return;
          var idx = Number(b.dataset.idx);
          var ok = idx === q.correta;
          corpo.querySelectorAll('.alt').forEach(function (x) {
            x.disabled = true;
            if (Number(x.dataset.idx) === q.correta) x.classList.add('certa');
          });
          if (!ok) b.classList.add('errada');
          responder(q, ok, ok ? null : q.opcoes[q.correta]);
        });
      });
    } else if (q.tipo === 'vf') {
      corpo.innerHTML = '<div class="alternativas vf"><button class="alt" data-v="true">Verdadeiro</button><button class="alt" data-v="false">Falso</button></div>';
      corpo.querySelectorAll('.alt').forEach(function (b) {
        b.addEventListener('click', function () {
          if (rodada.respondida) return;
          var v = b.dataset.v === 'true';
          var ok = v === q.correta;
          corpo.querySelectorAll('.alt').forEach(function (x) {
            x.disabled = true;
            if ((x.dataset.v === 'true') === q.correta) x.classList.add('certa');
          });
          if (!ok) b.classList.add('errada');
          responder(q, ok, null);
        });
      });
    } else if (q.tipo === 'digitar') {
      corpo.innerHTML = '<input class="campo" id="resp" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Sua resposta">' +
        '<div class="teclas">' + ['ä', 'ö', 'ü', 'ß'].map(function (c) { return '<button type="button" data-tecla="' + c + '">' + c + '</button>'; }).join('') + '</div>' +
        '<button class="btn btn-principal" id="enviar">Responder</button>';
      var campo = document.getElementById('resp');
      campo.focus();
      corpo.querySelectorAll('[data-tecla]').forEach(function (b) {
        b.addEventListener('click', function () {
          var c = b.dataset.tecla, s = campo.selectionStart || campo.value.length, e = campo.selectionEnd || s;
          campo.value = campo.value.slice(0, s) + c + campo.value.slice(e);
          campo.focus(); campo.setSelectionRange(s + 1, s + 1);
        });
      });
      var enviar = function () {
        if (rodada.respondida || !campo.value.trim()) return;
        var r = normalizar(campo.value);
        var ok = q.correta.some(function (c) { return normalizar(c) === r; });
        campo.disabled = true;
        document.getElementById('enviar').hidden = true;
        corpo.querySelector('.teclas').hidden = true;
        responder(q, ok, q.correta[0], ok && campo.value.trim() !== q.correta[0]);
      };
      document.getElementById('enviar').addEventListener('click', enviar);
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); enviar(); } });
    } else if (q.tipo === 'aberta') {
      corpo.innerHTML = '<textarea class="campo" id="resp" placeholder="Escreva sua resposta aqui (opcional), depois compare com o modelo."></textarea>' +
        '<p><button class="btn btn-principal" id="verModelo">Ver resposta-modelo</button></p>';
      document.getElementById('verModelo').addEventListener('click', function () {
        document.getElementById('verModelo').hidden = true;
        document.getElementById('retorno').innerHTML = '<div class="retorno neutro"><div class="retorno-titulo">Resposta-modelo</div>' +
          '<div class="modelo">' + esc(q.correta) + '</div><p>' + esc(q.explicacao) + '</p>' + botoesAudio(q.audio) +
          '<p style="margin-top:14px"><strong>Sua resposta tem a mesma ideia?</strong></p>' +
          '<div class="opcoes-linha" style="margin-top:8px"><button class="btn" id="autoOk">Sim, acertei</button><button class="btn" id="autoNok">Não, errei</button></div></div>';
        document.getElementById('autoOk').addEventListener('click', function () { autoAvaliar(true); });
        document.getElementById('autoNok').addEventListener('click', function () { autoAvaliar(false); });
      });
      var autoAvaliar = function (ok) {
        if (rodada.respondida) return;
        registrar(q, ok);
        rodada.respondida = true;
        document.querySelectorAll('#autoOk, #autoNok').forEach(function (b) { b.disabled = true; });
        mostrarAcoes(q);
      };
    }
    document.getElementById('encerrar').addEventListener('click', function () {
      if (!rodada.respostas.length) { rodada = null; return render(); }
      rodada.lista = rodada.lista.slice(0, rodada.respostas.length);
      rodada.fim = true; render();
    });
  }

  function registrar(q, ok) {
    var s = estado.q[q.id] || { v: 0, a: 0, e: 0 };
    s.v++; if (ok) s.a++; else s.e++;
    s.u = ok ? 1 : 0;
    s.t = Date.now();
    estado.q[q.id] = s;
    salvar();
    rodada.respostas.push({ id: q.id, ok: ok });
  }

  function responder(q, ok, certa, formaExata) {
    registrar(q, ok);
    rodada.respondida = true;
    var html = '<div class="retorno ' + (ok ? 'ok' : 'nok') + '"><div class="retorno-titulo">' + (ok ? 'Certo!' : 'Não foi dessa vez') + '</div>';
    if (!ok && certa != null) html += '<p>Resposta certa: <strong>' + esc(certa) + '</strong></p>';
    if (formaExata) html += '<p>Forma exata: <strong>' + esc(certa) + '</strong></p>';
    html += '<p>' + esc(q.explicacao) + '</p>' + botoesAudio(q.audio) + '</div>';
    document.getElementById('retorno').innerHTML = html;
    mostrarAcoes(q);
  }

  function mostrarAcoes(q) {
    var acoes = document.getElementById('acoes');
    acoes.hidden = false;
    atualizarBotaoSuspeita(q);
    document.getElementById('btnSuspeita').onclick = function () { alternarSuspeita(q); };
    var prox = document.getElementById('proxima');
    prox.onclick = proxima;
    prox.focus({ preventScroll: true });
  }

  function atualizarBotaoSuspeita(q) {
    var b = document.getElementById('btnSuspeita');
    var marcada = !!estado.suspeitas[q.id];
    b.textContent = marcada ? '⚑ Marcada como suspeita (desmarcar)' : '⚑ Achou algo errado? Marcar como suspeita';
    b.classList.toggle('marcada', marcada);
    var area = document.getElementById('areaSuspeita');
    if (marcada) {
      area.innerHTML = '<input class="campo nota-suspeita" id="notaSuspeita" placeholder="Opcional: o que parece errado?" value="' + esc(estado.suspeitas[q.id].nota || '') + '">';
      document.getElementById('notaSuspeita').addEventListener('input', function (e) {
        estado.suspeitas[q.id].nota = e.target.value; salvar();
      });
    } else {
      area.innerHTML = '';
    }
  }
  function alternarSuspeita(q) {
    if (estado.suspeitas[q.id]) delete estado.suspeitas[q.id];
    else estado.suspeitas[q.id] = { t: Date.now(), nota: '' };
    salvar();
    atualizarBotaoSuspeita(q);
  }

  function proxima() {
    if (rodada.i + 1 < rodada.lista.length) {
      rodada.i++;
      renderQuestao();
      window.scrollTo(0, 0);
    } else {
      rodada.fim = true;
      render();
    }
  }

  /* ---------- Resultado ---------- */
  function textoResposta(q) {
    if (q.tipo === 'multipla') return q.opcoes[q.correta];
    if (q.tipo === 'vf') return q.correta ? 'Verdadeiro' : 'Falso';
    if (q.tipo === 'digitar') return q.correta[0];
    return q.correta;
  }
  function renderResultado() {
    var total = rodada.respostas.length;
    var acertos = rodada.respostas.filter(function (r) { return r.ok; }).length;
    var erros = rodada.respostas.filter(function (r) { return !r.ok; }).map(function (r) { return QUESTOES[r.id]; });
    var pct = total ? Math.round(100 * acertos / total) : 0;
    var frase = pct >= 90 ? 'Ausgezeichnet! (Excelente!)' : pct >= 70 ? 'Sehr gut! (Muito bom!)' : pct >= 50 ? 'Gut! Continue praticando.' : 'Es geht… Vale rever essas aulas.';
    var html = '<div class="cartao placar"><div class="grande">' + acertos + '<small> / ' + total + '</small></div><p>' + esc(frase) + '</p></div>';
    if (erros.length) {
      html += '<h3>Para rever</h3><div class="cartao"><ul class="lista-erros">' + erros.map(function (q) {
        return '<li>' + esc(q.pergunta) + '<br><span class="resp">' + esc(textoResposta(q)) + '</span></li>';
      }).join('') + '</ul></div>';
    }
    html += '<div class="opcoes-linha" style="margin-top:16px"><button class="btn btn-principal" id="denovo">Nova rodada</button><button class="btn" id="voltar">Mudar seleção</button></div>';
    app.innerHTML = html;
    document.getElementById('denovo').addEventListener('click', function () { rodada = null; iniciarRodada(); });
    document.getElementById('voltar').addEventListener('click', function () { rodada = null; render(); });
  }

  /* ---------- Progresso ---------- */
  function renderProgresso() {
    var html = '<h2>Seu progresso</h2><p class="sub">Fica salvo só neste navegador. Para levar a outro aparelho, use o backup no fim da página.</p>';
    MODULOS.forEach(function (m) {
      html += '<div class="cartao" style="margin-bottom:12px"><strong>' + esc(nomeModulo(m)) + ' · ' + esc(m.titulo) + '</strong>' +
        '<table class="tabela" style="margin-top:8px"><thead><tr><th>Aula</th><th class="num">Questões</th><th class="num">Vistas</th><th class="num">Acertadas</th><th class="num">Para rever</th></tr></thead><tbody>';
      m.aulas.forEach(function (a) {
        var qs = m.questoes.filter(function (q) { return q.aula === a.n; });
        var vistas = 0, certas = 0, erradas = 0;
        qs.forEach(function (q) { var s = st(q.id); if (!s) return; vistas++; if (s.u === 1) certas++; else erradas++; });
        html += '<tr><td>' + a.n + '. ' + esc(a.titulo) + '</td><td class="num">' + qs.length + '</td><td class="num">' + vistas + '</td><td class="num">' + certas + '</td><td class="num">' + erradas + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });

    var ids = Object.keys(estado.suspeitas);
    html += '<h3>Questões marcadas como suspeitas (' + ids.length + ')</h3>';
    if (ids.length) {
      var texto = ids.map(function (id) {
        var q = QUESTOES[id];
        var nota = estado.suspeitas[id].nota;
        return '[' + id + '] ' + (q ? q.pergunta : '(questão removida)') + (nota ? '\n   Observação: ' + nota : '');
      }).join('\n');
      html += '<div class="cartao"><p class="mudo" style="margin-top:0">Copie esta lista e envie para revisão. Os códigos entre colchetes identificam cada questão.</p>' +
        '<textarea class="campo" id="txtSuspeitas" readonly rows="6">' + esc(texto) + '</textarea>' +
        '<div class="opcoes-linha" style="margin-top:10px"><button class="btn" id="copiarSusp">Copiar lista</button><button class="btn" id="limparSusp">Limpar marcações</button></div></div>';
    } else {
      html += '<p class="mudo">Nenhuma. Se uma questão parecer errada, use o botão ⚑ depois de respondê-la.</p>';
    }

    html += '<h3>Backup</h3><div class="cartao"><p class="mudo" style="margin-top:0">Salve um arquivo com seu progresso e abra-o em outro aparelho para continuar de onde parou.</p>' +
      '<div class="opcoes-linha"><button class="btn" id="exportar">Baixar backup</button>' +
      '<label class="btn" style="display:inline-block">Restaurar backup<input type="file" id="importar" accept="application/json,.json" hidden></label>' +
      '<button class="btn" id="zerar">Zerar progresso</button></div><p class="mudo" id="msgBackup"></p></div>';
    app.innerHTML = html;

    if (ids.length) {
      document.getElementById('copiarSusp').addEventListener('click', function () {
        var t = document.getElementById('txtSuspeitas');
        t.select();
        var ok = function () { document.getElementById('copiarSusp').textContent = 'Copiado!'; };
        if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(ok, function () { document.execCommand('copy'); ok(); });
        else { document.execCommand('copy'); ok(); }
      });
      document.getElementById('limparSusp').addEventListener('click', function () {
        estado.suspeitas = {}; salvar(); renderProgresso();
      });
    }
    document.getElementById('exportar').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify({ app: 'deutsch-ueben', versao: 1, data: new Date().toISOString(), estado: estado }, null, 1)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'progresso-alemao-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    document.getElementById('importar').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var d = JSON.parse(r.result);
          if (!d || d.app !== 'deutsch-ueben' || !d.estado) throw new Error('formato');
          estado = d.estado;
          estado.q = estado.q || {}; estado.suspeitas = estado.suspeitas || {}; estado.prefs = estado.prefs || {};
          prefs = estado.prefs;
          prefs.modulos = prefs.modulos || []; prefs.aulas = prefs.aulas || {}; prefs.tamanho = prefs.tamanho || 10;
          salvar(); renderProgresso();
          document.getElementById('msgBackup').textContent = 'Backup restaurado.';
        } catch (err) {
          document.getElementById('msgBackup').textContent = 'Esse arquivo não parece ser um backup deste app.';
        }
      };
      r.readAsText(f);
    });
    document.getElementById('zerar').addEventListener('click', function (e) {
      if (!confirmarZerar) {
        confirmarZerar = true;
        e.target.textContent = 'Clique de novo para confirmar';
        return;
      }
      estado.q = {}; salvar(); renderProgresso();
      document.getElementById('msgBackup').textContent = 'Progresso zerado.';
    });
  }

  /* ---------- Créditos ---------- */
  function renderCreditos() {
    var man = window.AUDIO_MANIFEST || {};
    var humanas = [], piper = 0;
    Object.keys(man).forEach(function (k) {
      var m = man[k];
      if (m.fonte === 'wikimedia') humanas.push(m); else if (m.fonte === 'piper') piper++;
    });
    humanas.sort(function (a, b) { return a.texto.localeCompare(b.texto, 'de'); });
    var html = '<h2>Créditos</h2>' +
      '<div class="cartao"><strong>Conteúdo das aulas</strong><p style="margin:6px 0 0">As questões foram elaboradas com base nas aulas do curso de alemão da Profª Mariana Waskow Radünz (@deutschmitmari). Os textos das questões são material de estudo pessoal.</p></div>' +
      '<h3>Vozes</h3><p class="sub">Para cada palavra, o app usa, nesta ordem: uma gravação de falante real, uma voz sintética gerada com o Piper e, se nenhuma existir, a voz do seu navegador.</p>';
    html += '<div class="cartao"><strong>Gravações humanas (' + humanas.length + ')</strong>';
    if (humanas.length) {
      html += '<p class="mudo" style="margin:4px 0 8px">Gravações do Wikimedia Commons, usadas conforme as licenças indicadas.</p><table class="tabela"><thead><tr><th>Palavra</th><th>Autor</th><th>Licença</th></tr></thead><tbody>' +
        humanas.map(function (m) {
          return '<tr><td><button class="ouvir" data-ouvir="' + esc(m.texto) + '">' + ICONE_SOM + esc(m.texto) + '</button></td>' +
            '<td>' + (m.pagina ? '<a href="' + esc(m.pagina) + '" target="_blank" rel="noopener">' + esc(m.autor || 'ver página') + '</a>' : esc(m.autor || '')) + '</td>' +
            '<td>' + (m.licencaUrl ? '<a href="' + esc(m.licencaUrl) + '" target="_blank" rel="noopener">' + esc(m.licenca || 'licença') + '</a>' : esc(m.licenca || '')) + '</td></tr>';
        }).join('') + '</tbody></table>';
    } else {
      html += '<p class="mudo" style="margin:4px 0 0">Ainda não há gravações baixadas. Elas são buscadas automaticamente pelo GitHub (veja o README).</p>';
    }
    html += '</div>';
    html += '<div class="cartao" style="margin-top:10px"><strong>Voz sintética (' + piper + ' palavras e frases)</strong><p style="margin:6px 0 0">Gerada com o <a href="https://github.com/OHF-Voice/piper1-gpl" target="_blank" rel="noopener">Piper</a>, um sintetizador de voz livre, usando a voz alemã “Thorsten”, de Thorsten Müller (<a href="https://www.thorsten-voice.de" target="_blank" rel="noopener">thorsten-voice.de</a>).</p></div>';
    html += '<div class="cartao" style="margin-top:10px"><strong>Voz do navegador</strong><p style="margin:6px 0 0">Usada só quando não existe áudio gravado. ' +
      (vozesDe.length ? 'Voz alemã encontrada neste aparelho: ' + esc((melhorVoz() || {}).name || '') + '.' : 'Nenhuma voz alemã encontrada neste aparelho.') + '</p></div>';
    app.innerHTML = html;
  }

  /* ---------- Inicialização ---------- */
  function carregarScript(src) {
    return new Promise(function (ok) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = function () { console.warn('Não foi possível carregar', src); ok(); };
      document.head.appendChild(s);
    });
  }
  Promise.all((window.MODULOS_DISPONIVEIS || []).map(function (n) { return carregarScript('data/' + n + '.js'); }))
    .then(function () {
      MODULOS.sort(function (a, b) { return a.numero - b.numero; });
      MODULOS.forEach(function (m) { m.questoes.forEach(function (q) { q.modulo = m; QUESTOES[q.id] = q; }); });
      prefs.modulos = prefs.modulos.filter(function (id) { return MODULOS.some(function (m) { return m.id === id; }); });
      if (!prefs.modulos.length && MODULOS.length) prefs.modulos = [MODULOS[0].id];
      render();
    });
})();
