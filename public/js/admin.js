const AdminPanel = {
  section: 'dashboard',
  searchQuery: '',
  catType: 'movie',
  activityTimer: null,
  streamEditor: { id: null, tab: 'sources', config: null, channel: {}, rtmp_status: {} },
  seriesExpanded: new Set(),
  seriesCache: {},
  _episodeProgress: {},
  seriesPollTimer: null,
  streamsCatFilter: '',
  streamsStatusFilter: '',
  streamsRelayOnly: false,
  _preserveStreamFilters: false,
  _previewHls: null,
  _dashCharts: { cpu: null, net: null, conn: null },
  _dashReady: false,
  vodPollTimer: null,
  _vodMovies: [],
  _vodProgress: {},
  _vodSearchDownloads: {},

  validSections() {
    return ['dashboard', 'connections', 'servers', 'lines', 'streams', 'categories', 'vod', 'series', 'settings'];
  },

  init() {
    this.closeStreamEditor();
    this.closeModal();
    $$('.vp-nav-link[data-section]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.go(btn.dataset.section);
        $('#vp-sidebar')?.classList.remove('open');
      });
    });
    $('#vp-menu-toggle')?.addEventListener('click', () => {
      $('#vp-sidebar')?.classList.toggle('open');
    });
    $('#admin-goto-password')?.addEventListener('click', () => {
      this.go('lines');
      setTimeout(() => $('#xui-admin-cur-pass')?.focus(), 200);
    });
    $$('.xui-cat-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.xui-cat-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.catType = btn.dataset.catType;
        if (this.section === 'categories') this.loadCategories();
      });
    });
    $('#xui-add-category')?.addEventListener('click', () => this.openCategoryModal());
    $('#xui-global-search')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.refresh();
    });
    const goSite = () => { window.location.href = '/'; };
    $('#admin-back-site')?.addEventListener('click', goSite);
    $('#admin-back-site-mob')?.addEventListener('click', goSite);
    $('#xui-streams-search')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      if (this.section === 'streams') this.renderStreamsTable(this._streamsCache || []);
    });
    $('#xui-streams-filter-cat')?.addEventListener('change', (e) => {
      this.streamsCatFilter = e.target.value;
      if (this.section === 'streams') this.renderStreamsTable(this._streamsCache || []);
    });
    $('#xui-streams-filter-status')?.addEventListener('change', (e) => {
      this.streamsRelayOnly = false;
      this.streamsStatusFilter = e.target.value;
      if (this.section === 'streams') this.renderStreamsTable(this._streamsCache || []);
    });
    $('#xui-relay-enable-all')?.addEventListener('click', () => this.enableRelayForAllChannels());
    $('#xui-relay-start-all')?.addEventListener('click', () => this.startRelayForAllChannels());
    $('#xui-relay-disable-all')?.addEventListener('click', () => this.disableRelayForAllChannels());
    $('#xui-dash-tiles')?.addEventListener('click', (e) => {
      const tile = e.target.closest('.xui-dash-tile-clickable');
      if (!tile) return;
      const nav = tile.dataset.nav;
      if (nav === 'connections') this.go('connections');
      else if (nav === 'streams-up') this.goStreamsWithFilter('active', { relayOnly: true });
      else if (nav === 'streams-down') this.goStreamsWithFilter('down', { relayOnly: true });
      else if (nav === 'streams-all') this.goStreamsWithFilter('');
      else if (nav === 'servers') this.go('servers');
    });
    this.bindForms();
    window.addEventListener('hashchange', () => {
      const hash = (location.hash || '').replace(/^#/, '');
      if (hash && hash !== this.section && this.validSections().includes(hash)) {
        this.go(hash, { fromHash: true });
      }
    });
    document.addEventListener('click', () => {
      $$('.xui-stream-dropdown').forEach((d) => d.classList.add('hidden'));
    });
  },

  go(section, opts = {}) {
    if (!this.validSections().includes(section)) section = 'dashboard';
    if (this.section === 'vod' && section !== 'vod') this.stopVodPoll();
    if (this.section === 'series' && section !== 'series') this.stopSeriesPoll();
    if (['dashboard', 'connections'].includes(this.section) && !['dashboard', 'connections'].includes(section)) {
      this.stopActivityPoll();
    }
    if (section === 'streams' && !this._preserveStreamFilters) {
      this.streamsRelayOnly = false;
      this.streamsStatusFilter = '';
      this.streamsCatFilter = '';
    }
    this._preserveStreamFilters = false;
    this.section = section;
    $$('.vp-nav-link[data-section]').forEach(b => b.classList.toggle('active', b.dataset.section === section));
    $$('.xui-section').forEach(s => s.classList.toggle('active', s.id === `xui-${section}`));
    const titles = {
      dashboard: 'Dashboard',
      connections: 'Conexiones en vivo',
      servers: 'Servidor Vix TV',
      lines: 'Líneas',
      streams: 'Streams',
      categories: 'Categorías',
      vod: 'Películas',
      series: 'Series',
      settings: 'Ajustes'
    };
    const titleEl = $('#vp-page-title');
    if (titleEl) titleEl.textContent = titles[section] || section;
    document.title = `Vix TV · ${titles[section] || section}`;
    try { sessionStorage.setItem('vixtv_admin_section', section); } catch { /* ignore */ }
    if (!opts.fromHash) {
      const next = `#${section}`;
      if (location.hash !== next) history.replaceState(null, '', next);
    }
    this.refresh();
  },

  goStreamsWithFilter(status = '', opts = {}) {
    this.streamsStatusFilter = status;
    this.streamsRelayOnly = !!opts.relayOnly;
    this.streamsCatFilter = '';
    this.searchQuery = '';
    const searchEl = $('#xui-streams-search');
    if (searchEl) searchEl.value = '';
    const statusSel = $('#xui-streams-filter-status');
    if (statusSel) statusSel.value = this.streamsRelayOnly ? '' : status;
    const catSel = $('#xui-streams-filter-cat');
    if (catSel) catSel.value = '';
    this._preserveStreamFilters = true;
    this.go('streams');
  },

  clearStreamFilters() {
    this.streamsRelayOnly = false;
    this.streamsStatusFilter = '';
    this.streamsCatFilter = '';
    const statusSel = $('#xui-streams-filter-status');
    if (statusSel) statusSel.value = '';
    const catSel = $('#xui-streams-filter-cat');
    if (catSel) catSel.value = '';
    this.renderStreamsFilterBanner();
    this.renderStreamsTable(this._streamsCache || []);
  },

  renderStreamsFilterBanner() {
    const el = $('#xui-streams-filter-banner');
    if (!el) return;
    if (this.streamsRelayOnly && this.streamsStatusFilter) {
      const labels = { active: 'Restream activos', down: 'Restream caídos' };
      const total = this._streamsCache?.length || 0;
      el.classList.remove('hidden');
      el.innerHTML = `<span>Filtro del dashboard: <strong>${labels[this.streamsStatusFilter] || this.streamsStatusFilter}</strong></span>
        <button type="button" class="xui-btn xui-btn-ghost xui-btn-sm" onclick="AdminPanel.clearStreamFilters()">Ver todos los canales (${total})</button>`;
      return;
    }
    el.classList.add('hidden');
    el.innerHTML = '';
  },

  load() {
    const hash = (location.hash || '').replace(/^#/, '');
    let section = 'dashboard';
    if (this.validSections().includes(hash)) section = hash;
    else {
      try {
        const saved = sessionStorage.getItem('vixtv_admin_section');
        if (this.validSections().includes(saved)) section = saved;
      } catch { /* ignore */ }
    }
    this.go(section, { fromHash: true });
  },

  refresh() {
    const fn = {
      dashboard: () => this.loadDashboard(),
      connections: () => this.loadConnections(),
      servers: () => this.loadServers(),
      lines: () => this.loadUsers(),
      streams: () => this.loadStreams(),
      categories: () => this.loadCategories(),
      vod: () => this.loadVod(),
      series: () => this.loadSeries(),
      settings: () => this.loadSettings()
    };
    fn[this.section]?.();
  },

  bindForms() {
    $('#xui-add-stream')?.addEventListener('click', () => this.openChannelModal());
    $('#xui-add-vod')?.addEventListener('click', () => this.openVodModal());
    $('#xui-resume-vod-stuck')?.addEventListener('click', () => this.resumeAllStuckVod());
    $('#xui-add-series')?.addEventListener('click', () => this.openSeriesModal());
    $('#xui-series-list')?.addEventListener('click', (e) => {
      const head = e.target.closest('[data-action="toggle-series"]');
      if (!head || e.target.closest('.xui-series-head-actions')) return;
      const item = head.closest('.xui-series-item');
      if (!item) return;
      this.toggleSeriesExpand(parseInt(item.dataset.seriesId, 10));
    });
    $('#xui-import-m3u')?.addEventListener('click', () => this.importM3u());
    $('#xui-add-user')?.addEventListener('click', () => this.createUser());
    $('#xui-admin-change-pass')?.addEventListener('click', () => this.changeOwnPassword());
    $('#xui-save-tmdb')?.addEventListener('click', () => this.saveTmdbKey());
    $('#xui-test-tmdb')?.addEventListener('click', () => this.testTmdbKey());
    $('#xui-refresh-posters')?.addEventListener('click', () => this.refreshAllPosters());
    $('#xui-refresh-trailers')?.addEventListener('click', () => this.refreshAllTrailers());
    $('#xui-save-proxy')?.addEventListener('click', () => this.saveStreamProxy());
    $('#vod-nightly-save')?.addEventListener('click', () => this.saveVodNightly());
    $('#app-update-save')?.addEventListener('click', () => this.saveAppUpdate());
    $('#vod-nightly-run')?.addEventListener('click', () => this.runVodNightlyNow());
    $('#vod-search-btn')?.addEventListener('click', () => this.runVodSearch());
    $('#vod-search-query')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.runVodSearch();
    });
    $('#vod-search-results')?.addEventListener('click', (e) => {
      const goto = e.target.closest('[data-vod-goto]');
      if (goto) {
        const movieId = parseInt(goto.dataset.vodGoto, 10);
        this.go('vod');
        this.loadVod().then(() => {
          setTimeout(() => {
            document.querySelector(`#xui-vod tr[data-movie-id="${movieId}"]`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 300);
        });
        return;
      }
      const btn = e.target.closest('[data-vod-action]');
      if (!btn) return;
      const card = btn.closest('[data-vod-item]');
      if (!card) return;
      const download = btn.dataset.vodAction === 'download';
      this.importVodFromSearch(card.dataset, download, card);
    });
    $('#xui-test-proxy')?.addEventListener('click', () => this.testStreamProxy());
    $('#xui-save-xui')?.addEventListener('click', () => this.saveXuiSettings());
    $('#xui-test-xui')?.addEventListener('click', () => this.testXuiAdmin());
    $('#xui-import-channels')?.addEventListener('click', () => this.importChannelsFromXui());
    $('#xui-sync-logos')?.addEventListener('click', () => this.syncLogosFromXui());
    $('#xui-modal-save')?.addEventListener('click', () => this.saveModal());
    $('#xui-modal-close')?.addEventListener('click', () => this.closeModal());
    $('#xui-modal-cancel')?.addEventListener('click', () => this.closeModal());
    this.bindStreamEditor();
  },

  filter(items, fields) {
    if (!this.searchQuery) return items;
    return items.filter(item => fields.some(f => String(item[f] || '').toLowerCase().includes(this.searchQuery)));
  },

  async categoryOptions(type, selected = '') {
    const cats = await api(`/categories?type=${type}`);
    const options = [{ v: '', l: '— Seleccionar categoría —' }];
    cats.forEach(c => options.push({ v: c.name, l: `${c.name} (${c.count})` }));
    if (selected && !cats.some(c => c.name === selected)) {
      options.push({ v: selected, l: `${selected} (actual)` });
    }
    return options;
  },

  async liveStreamCategoryOptions(selected = '') {
    const options = await this.categoryOptions('live', selected);
    const seen = new Set(options.map((o) => o.v).filter(Boolean));
    try {
      const channels = await api('/live/channels?all=1');
      [...new Set(channels.map((c) => c.group_title).filter(Boolean))].sort().forEach((name) => {
        if (seen.has(name)) return;
        seen.add(name);
        options.push({ v: name, l: `${name} (en uso)` });
      });
    } catch (_) { /* ignore */ }
    if (selected && !seen.has(selected)) {
      options.push({ v: selected, l: `${selected} (actual)` });
    }
    return options;
  },

  catTypeLabel(type) {
    return { movie: 'Películas', series: 'Series', live: 'Canales en vivo' }[type] || type;
  },

  catCountLabel(type) {
    return { movie: 'películas', series: 'series', live: 'canales' }[type] || 'elementos';
  },

  async loadDashboard() {
    const data = await api('/admin/dashboard');
    this.renderXuiDashboard(data, !this._dashReady);
    this._dashReady = true;
    this.startActivityPoll();
  },

  async enableRelayForAllChannels() {
    const total = this._streamsCache?.length || this.dashMetrics(await api('/admin/dashboard')).totalStreams || 'todos los';
    if (!confirm(`¿Activar restream (Allow Recording + cache) en ${total} canales habilitados?\n\nLos procesos FFmpeg arrancarán cuando alguien vea el canal, para no saturar el servidor.`)) return;
    try {
      const data = await api('/admin/streams/cache/enable-all', { method: 'POST', body: JSON.stringify({ startProcesses: false }) });
      toast(`Restream activado en ${data.updated || 0} canales`);
      await this.loadDashboard();
      if (this.section === 'streams') this.loadStreams();
    } catch (e) {
      toast(e.message || 'Error al activar restream', true);
    }
  },

  async startRelayForAllChannels() {
    const enabled = this.dashMetrics(await api('/admin/dashboard')).relayEnabled || 0;
    if (!confirm(`¿Iniciar FFmpeg en ${enabled} canales con restream activo?\n\nSe arrancan por lotes (5 cada ~1.5 s). Con muchos canales puede consumir mucha CPU y ancho de banda.`)) return;
    try {
      toast('Iniciando procesos de restream…');
      const data = await api('/admin/streams/cache/start-all', { method: 'POST', body: JSON.stringify({ batchSize: 5, delayMs: 1500 }) });
      const ok = (data.results || []).filter((r) => r.started && !r.error).length;
      const err = (data.results || []).filter((r) => r.error).length;
      toast(`Procesos iniciados: ${ok}${err ? ` · errores: ${err}` : ''}`, !!err);
      await this.loadDashboard();
      if (this.section === 'streams') this.loadStreams();
    } catch (e) {
      toast(e.message || 'Error al iniciar restream', true);
    }
  },

  async disableRelayForAllChannels() {
    if (!confirm('¿Desactivar restream y Allow Recording en TODOS los canales?\n\nSe detendrán todos los procesos FFmpeg de cache.')) return;
    try {
      const data = await api('/admin/streams/cache/stop-all', { method: 'POST' });
      toast(`Restream desactivado en ${data.updated || 0} canales`);
      await this.loadDashboard();
      if (this.section === 'streams') this.loadStreams();
    } catch (e) {
      toast(e.message || 'Error al desactivar restream', true);
    }
  },

  async loadConnections() {
    const data = await api('/admin/dashboard');
    this.renderActivity(data.active_users || []);
    this.startActivityPoll();
  },

  dashMetrics(data) {
    const st = data.stats || {};
    const up = data.uplink || {};
    const relay = data.relay || {};
    const cache = data.cache || {};
    const srv = data.server || {};
    const net = srv.network || {};
    const cores = (srv.load && srv.load.length) ? Math.max(1, Math.ceil(srv.load[0] * 2)) : 1;
    const loadPct = srv.load ? Math.min(100, Math.round((srv.load[0] / cores) * 100)) : 0;
    return {
      connections: data.active_count ?? 0,
      activeLines: st.users ?? data.active_count ?? 0,
      live: relay.active ?? 0,
      down: relay.down ?? 0,
      outMbps: net.output_mbps ?? 0,
      inMbps: net.input_mbps ?? 0,
      cpu: srv.cpu_pct ?? 0,
      mem: srv.memory?.pct ?? 0,
      io: loadPct,
      disk: srv.disk?.pct ?? 0,
      uptime: srv.uptime ?? '—',
      totalStreams: st.channels ?? 0,
      movies: st.movies ?? 0,
      cacheActive: cache.active ?? 0,
      relayEnabled: cache.enabled ?? 0,
      relayImportMbps: data.relay?.total_import_mbps ?? '0.00',
      relayOutputMbps: data.relay?.total_output_mbps ?? '0.00',
      relayCount: data.relay?.count ?? 0
    };
  },

  dashTileHtml(color, icon, valueKey, value, label, nav, title) {
    return `<div class="xui-dash-tile ${color} xui-dash-tile-clickable" data-nav="${nav}" title="${title}">
      <div class="xui-dash-tile-inner">
        <div class="xui-dash-tile-icon">${icon}</div>
        <div class="xui-dash-tile-data">
          <div class="val" data-d="${valueKey}">${value}</div>
          <div class="lbl">${label}</div>
        </div>
      </div>
    </div>`;
  },

  renderXuiDashboard(data, fullBuild = false) {
    const m = this.dashMetrics(data);

    if (fullBuild || !$('#xui-dash-tiles')?.children.length) {
      $('#xui-dash-tiles').innerHTML = [
        this.dashTileHtml('purple', '⚡', 'connections', m.connections, 'Conexiones online', 'connections', 'Ver conexiones en vivo'),
        this.dashTileHtml('green', '👥', 'activeLines', m.activeLines, 'Líneas activas', 'lines', 'Ver líneas'),
        this.dashTileHtml('teal', '▶', 'live', m.live, 'Restream en vivo', 'streams-up', 'Ver restream activos'),
        this.dashTileHtml('pink', '⚠', 'down', m.down, 'Restream caídos', 'streams-down', 'Ver restream caídos'),
        this.dashTileHtml('blue', '📈', 'outMbps', `${m.outMbps}<small>Mbps</small>`, 'Salida red', 'servers', 'Ver servidor'),
        this.dashTileHtml('orange', '📉', 'inMbps', `${m.inMbps}<small>Mbps</small>`, 'Entrada red', 'servers', 'Ver servidor')
      ].join('');
      this.renderDashboardCharts(data.server?.history || [], m, true);
      this.renderRestreamPanel(data.relay || {}, true);
      this.renderUsageStats(data.usage);
      return;
    }

    this.updateDashVal('connections', m.connections);
    this.updateDashVal('activeLines', m.activeLines);
    this.updateDashVal('live', m.live);
    this.updateDashVal('down', m.down);
    this.updateDashVal('outMbps', `${m.outMbps}<small>Mbps</small>`, true);
    this.updateDashVal('inMbps', `${m.inMbps}<small>Mbps</small>`, true);
    this.renderDashboardCharts(data.server?.history || [], m, false);
    this.renderRestreamPanel(data.relay || {}, false);
    this.renderUsageStats(data.usage);
  },

  renderUsageStats(usage) {
    if (!usage) return;
    let el = $('#xui-usage-panel');
    if (!el) {
      const anchor = $('#xui-restream-panel') || $('#xui-dash-tiles');
      if (!anchor?.parentElement) return;
      el = document.createElement('div');
      el.id = 'xui-usage-panel';
      el.className = 'xui-panel';
      el.style.marginTop = '16px';
      anchor.parentElement.insertBefore(el, anchor.nextSibling);
    }
    const t = usage.totals || {};
    const topM = (usage.top_movies || []).slice(0, 6).map((m) =>
      `<li><strong>${this.escSeries(m.title)}</strong> · ${m.viewers} perfil(es)</li>`
    ).join('') || '<li>Sin datos aún</li>';
    const topS = (usage.top_series || []).slice(0, 4).map((s) =>
      `<li><strong>${this.escSeries(s.title)}</strong> · ${s.viewers} perfil(es)</li>`
    ).join('');
    el.innerHTML = `
      <div class="xui-panel-header"><h3>Estadísticas de uso (${usage.days || 30} días)</h3></div>
      <div class="xui-panel-body" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:12px">
        <div><div class="val">${t.active_profiles || 0}</div><div class="lbl">Perfiles activos</div></div>
        <div><div class="val">${t.watch_hours || 0}h</div><div class="lbl">Horas vistas</div></div>
        <div><div class="val">${t.continue_watching || 0}</div><div class="lbl">En progreso</div></div>
      </div>
      <p><strong>Top películas</strong></p><ul>${topM}</ul>
      ${topS ? `<p><strong>Top series</strong></p><ul>${topS}</ul>` : ''}`;
  },

  relayStatusBadge(status) {
    if (status === 'active') return '<span class="xui-relay-status active">● Activo</span>';
    if (status === 'starting') return '<span class="xui-relay-status starting">◌ Iniciando</span>';
    if (status === 'down') return '<span class="xui-relay-status down">● Caído</span>';
    return '<span class="xui-relay-status off">○ Apagado</span>';
  },

  relayMbpsCell(mbps, active) {
    const val = Number(mbps || 0);
    const cls = val > 0 ? 'xui-mbps-live' : '';
    return `<span class="xui-mbps ${cls}">${val > 0 ? val.toFixed(2) : '0.00'} <small>Mbps</small></span>`;
  },

  renderRestreamPanel(relay, rebuild) {
    const streams = relay.streams || [];
    $('#xui-restream-count') && ($('#xui-restream-count').textContent = String(relay.active ?? 0));
    $('#xui-restream-import-total') && ($('#xui-restream-import-total').textContent = relay.total_import_mbps || '0.00');
    $('#xui-restream-output-total') && ($('#xui-restream-output-total').textContent = relay.total_output_mbps || '0.00');

    const tbody = $('#xui-restream-table');
    if (!tbody) return;

    if (!streams.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="xui-restream-empty">No hay canales con restream activado. Usa «Activar en todos» para habilitarlo en todos los canales.</td></tr>';
      return;
    }

    const html = streams.map((s) => `<tr class="xui-restream-row${s.status === 'active' ? ' is-live' : ''}">
      <td><strong>${this.escSeries(s.name)}</strong><small>#${s.id}</small></td>
      <td>${this.escSeries(s.group_title || '—')}</td>
      <td>${this.relayStatusBadge(s.status)}</td>
      <td>${this.relayMbpsCell(s.import_mbps, s.status === 'active')}</td>
      <td>${this.relayMbpsCell(s.output_mbps, s.status === 'active')}</td>
      <td>${this.escSeries(s.cache_formatted || '0 MB')}</td>
      <td>${this.escSeries(s.uptime || '—')}</td>
    </tr>`).join('');

    if (rebuild || tbody.dataset.count !== String(streams.length)) {
      tbody.innerHTML = html;
      tbody.dataset.count = String(streams.length);
      return;
    }
    tbody.innerHTML = html;
  },

  updateDashVal(key, val, html = false) {
    document.querySelectorAll(`[data-d="${key}"]`).forEach((el) => {
      if (html) el.innerHTML = val;
      else el.textContent = val;
    });
  },

  updateBar(id, pct) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    const fill = document.querySelector(`.xui-sbar-fill.${id}`);
    const label = fill?.closest('.xui-sbar')?.querySelector('.xui-sbar-label span:last-child');
    if (fill) {
      fill.style.width = `${v}%`;
      fill.classList.remove('ok', 'warn', 'bad');
      fill.classList.add(v >= 85 ? 'bad' : v >= 60 ? 'warn' : 'ok');
    }
    if (label) label.textContent = `${v}%`;
  },

  serverBar(label, pct, id = '') {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    const cls = v >= 85 ? 'bad' : v >= 60 ? 'warn' : 'ok';
    const fillCls = id ? ` ${id}` : '';
    return `<div class="xui-sbar"><div class="xui-sbar-label"><span>${label}</span><span>${v}%</span></div><div class="xui-sbar-track"><div class="xui-sbar-fill ${cls}${fillCls}" style="width:${v}%"></div></div></div>`;
  },

  renderDashboardCharts(history, m, rebuild) {
    if (typeof Chart === 'undefined') return;
    const labels = history.map(() => '');
    const cpu = history.map((p) => p.cpu || 0);
    const mem = history.map((p) => p.memory || 0);
    const inNet = history.map((p) => p.input_mbps || 0);
    const outNet = history.map((p) => p.output_mbps || 0);
    const conn = history.map((p) => p.connections || 0);
    const liveH = history.map((p) => p.live_streams || 0);
    const downH = history.map((p) => p.down_streams || 0);

    const baseOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { display: false },
        y: { beginAtZero: true, ticks: { font: { size: 10 }, maxTicksLimit: 5 } }
      },
      elements: { line: { tension: 0.35, borderWidth: 2 }, point: { radius: 0 } }
    };

    const upsert = (key, el, cfg) => {
      if (!el) return;
      if (this._dashCharts[key] && !rebuild) {
        const ch = this._dashCharts[key];
        cfg.data.datasets.forEach((ds, i) => {
          ch.data.datasets[i].data = ds.data;
        });
        ch.update('none');
        return;
      }
      if (this._dashCharts[key]) this._dashCharts[key].destroy();
      this._dashCharts[key] = new Chart(el, cfg);
    };

    upsert('cpu', $('#xui-chart-cpu'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'CPU', data: cpu.length ? cpu : [m.cpu || 0], borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,.12)', fill: true },
          { label: 'Memoria', data: mem.length ? mem : [m.mem || 0], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.1)', fill: true }
        ]
      },
      options: { ...baseOpts, scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, max: 100 } } }
    });

    upsert('net', $('#xui-chart-net'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Entrada', data: inNet.length ? inNet : [m.inMbps || 0], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.15)', fill: true },
          { label: 'Salida', data: outNet.length ? outNet : [m.outMbps || 0], borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,.12)', fill: true }
        ]
      },
      options: baseOpts
    });

    upsert('conn', $('#xui-chart-conn'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Usuarios online', data: conn.length ? conn : [m.connections || 0], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.08)', fill: true },
          { label: 'Restream activos', data: liveH.length ? liveH : [m.live || 0], borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,.1)', fill: true },
          { label: 'Restream caídos', data: downH.length ? downH : [m.down || 0], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.08)', fill: true }
        ]
      },
      options: baseOpts
    });
  },

  async loadServers() {
    const data = await api('/admin/dashboard');
    this.renderLocalServer(data);
  },

  renderLocalServer(data) {
    const m = this.dashMetrics(data);
    const srv = data.server || {};
    $('#xui-servers-count').textContent = '1';
    $('#xui-servers-updated').textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
    const bar = (v) => {
      const n = Math.max(0, Math.min(100, Number(v) || 0));
      const cls = n >= 85 ? 'bad' : n >= 60 ? 'warn' : 'ok';
      return `<div class="xui-sbar-track" style="width:80px;display:inline-block;vertical-align:middle"><div class="xui-sbar-fill ${cls}" style="width:${n}%"></div></div> ${n}%`;
    };
    $('#xui-servers-table').innerHTML = `
      <tr>
        <td>1</td>
        <td><strong>${this.escSeries(srv.hostname || 'Vix TV')}</strong></td>
        <td>${bar(m.cpu)}</td>
        <td>${bar(m.mem)}</td>
        <td>${bar(m.io)}</td>
        <td>${bar(m.disk)}</td>
        <td>${this.escSeries(m.uptime)}</td>
        <td>${m.connections} online</td>
      </tr>`;
  },

  formatActivityProgress(u) {
    if (!u.progress || u.progress < 30) return '—';
    if (u.duration > 0) {
      const pct = Math.min(100, Math.round((u.progress / u.duration) * 100));
      const m = Math.floor(u.progress / 60);
      const s = Math.floor(u.progress % 60);
      return `${m}:${String(s).padStart(2, '0')} (${pct}%)`;
    }
    const m = Math.floor(u.progress / 60);
    const s = Math.floor(u.progress % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  activityContentLabel(u) {
    if (u.title) return u.title;
    const pages = { home: 'Inicio', movies: 'Películas', series: 'Series', live: 'TV En vivo', admin: 'Admin' };
    return pages[u.page] || u.page || '—';
  },

  renderActivity(users) {
    const labels = {
      browsing: 'Navegando',
      watching_movie: '🎬 Película',
      watching_episode: '📺 Episodio',
      watching_live: '🔴 En vivo',
      admin: '⚙️ Admin'
    };
    $('#xui-active-count').textContent = users.length;
    $('#xui-stat-active').textContent = users.length;
    $('#xui-activity-updated').textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
    $('#xui-activity-table').innerHTML = users.length
      ? users.map(u => `
        <tr>
          <td><strong>${u.username}</strong> <span class="badge ${u.role}">${u.role}</span></td>
          <td><span class="badge active">${labels[u.status] || u.status}</span></td>
          <td>${this.activityContentLabel(u)}</td>
          <td>${this.formatActivityProgress(u)}</td>
          <td>${u.seconds_ago}s</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:#6c7293">Nadie conectado en este momento</td></tr>';
  },

  async loadActivity() {
    try {
      const data = await api('/admin/activity');
      this.renderActivity(data.users || []);
    } catch { /* ignore */ }
  },

  startActivityPoll() {
    this.stopActivityPoll();
    this.activityTimer = setInterval(() => {
      if (this.section === 'dashboard') {
        api('/admin/dashboard').then((d) => {
          this.renderXuiDashboard(d, false);
        }).catch(() => {});
      } else if (this.section === 'streams') {
        api('/live/channels?all=1').then((channels) => {
          this._streamsCache = channels;
          this.renderStreamsTable(channels);
        }).catch(() => {});
      } else if (this.section === 'connections') {
        this.loadActivity();
      } else if (this.section === 'servers') {
        api('/admin/dashboard').then((d) => {
          this.renderLocalServer(d);
        }).catch(() => {});
      }
    }, 5000);
  },

  stopActivityPoll() {
    if (this.activityTimer) {
      clearInterval(this.activityTimer);
      this.activityTimer = null;
    }
  },

  async loadStreams() {
    const channels = await api('/live/channels?all=1');
    this._streamsCache = channels;
    const cats = [...new Set(channels.map((c) => c.group_title).filter(Boolean))].sort();
    const sel = $('#xui-streams-filter-cat');
    if (sel) {
      const cur = this.streamsCatFilter;
      sel.innerHTML = '<option value="">Todas las categorías</option>' + cats.map((c) =>
        `<option value="${this.escSeries(c)}"${cur === c ? ' selected' : ''}>${this.escSeries(c)}</option>`
      ).join('');
    }
    const statusSel = $('#xui-streams-filter-status');
    if (statusSel) statusSel.value = this.streamsRelayOnly ? '' : (this.streamsStatusFilter || '');
    this.renderStreamsFilterBanner();
    this.renderStreamsTable(channels);
    await this.loadPlaylists();
  },

  renderStreamsTable(channels) {
    let list = [...channels];
    const q = ($('#xui-streams-search')?.value || '').trim().toLowerCase();
    if (q) {
      list = list.filter((c) => ['name', 'group_title', 'stream_url'].some((f) =>
        String(c[f] || '').toLowerCase().includes(q)
      ));
    }
    if (this.streamsCatFilter) list = list.filter((c) => c.group_title === this.streamsCatFilter);
    if (this.streamsRelayOnly && this.streamsStatusFilter) {
      list = list.filter((c) => {
        if (!c.relay_enabled) return false;
        const st = c.relay_status || c.cache_status || 'off';
        return st === this.streamsStatusFilter;
      });
    } else if (this.streamsStatusFilter === 'live-on') {
      list = list.filter((c) => c.enabled !== 0);
    } else if (this.streamsStatusFilter === 'live-off') {
      list = list.filter((c) => c.enabled === 0);
    } else if (this.streamsStatusFilter) {
      list = list.filter((c) => (c.uplink_status || 'unknown') === this.streamsStatusFilter);
    }

    $('#xui-streams-table').innerHTML = list.length
      ? list.map((c) => this.streamRowHtml(c)).join('')
      : '<tr><td colspan="12" class="xui-streams-empty">Sin canales</td></tr>';
  },

  relayUptimeHtml(c) {
    if (!c.relay_enabled) return '<span class="xui-muted">—</span>';
    const uptime = c.relay_uptime || '—';
    const live = (c.relay_status || c.cache_status) === 'active';
    return `<span class="xui-relay-uptime${live ? ' live' : ''}" title="Desde ${this.escSeries(c.relay_started_at || c.cache_started_at || '')}">${this.escSeries(uptime)}</span>`;
  },

  streamRowHtml(c) {
    const status = c.uplink_status || 'unknown';
    const isUp = status === 'up';
    const url = c.upstream_url || c.stream_url || '';
    const shortUrl = url.length > 48 ? `${url.slice(0, 45)}…` : url;
    const relay = c.relay_enabled;
    const relayStatus = c.relay_status || c.cache_status || 'off';
    return `<tr class="xui-stream-row${c.enabled === 0 ? ' disabled' : ''}${relay ? ' has-relay' : ''}">
      <td class="xui-stream-id">${c.id}</td>
      <td class="xui-stream-icon">${c.logo
        ? `<img class="xui-stream-logo" src="${this.escSeries(c.logo)}" alt="" onerror="this.replaceWith(document.createTextNode('📺'))">`
        : '<span class="xui-stream-logo-ph">📺</span>'}</td>
      <td class="xui-stream-name">
        <strong>${this.escSeries(c.name)}</strong>
        ${c.enabled === 0 ? '<span class="badge inactive">OFF</span>' : ''}
        ${relay ? '<span class="badge active">● Restream</span>' : ''}
        <small>${this.escSeries(c.group_title || 'Sin categoría')}</small>
      </td>
      <td class="xui-stream-live-cell">
        ${this.streamLiveToggleHtml(c)}
      </td>
      <td class="xui-stream-servers">
        <strong>Main Server</strong>
        <small class="url-cell" title="${this.escSeries(url)}">${this.escSeries(shortUrl || '—')}</small>
      </td>
      <td class="xui-stream-bitrate">${relay ? this.relayMbpsCell(c.relay_import_mbps, relayStatus === 'active') : '<span class="xui-muted">—</span>'}</td>
      <td class="xui-stream-bitrate">${relay ? this.relayMbpsCell(c.relay_output_mbps, relayStatus === 'active') : '<span class="xui-muted">—</span>'}</td>
      <td class="xui-stream-relay-uptime">${this.relayUptimeHtml(c)}</td>
      <td class="xui-stream-relay-status">${relay ? this.relayStatusBadge(relayStatus) : this.uptimeBadge(status)}</td>
      <td class="xui-stream-actions">
        <div class="xui-stream-actions-wrap">
          <button type="button" class="xui-btn xui-btn-danger xui-btn-sm xui-stream-del-btn" onclick="AdminPanel.deleteChannel(${c.id}, '${this.escAttr(c.name).replace(/'/g, "\\'")}')" title="Eliminar canal">🗑</button>
          <div class="xui-stream-menu">
            <button type="button" class="xui-btn xui-btn-ghost xui-btn-sm xui-stream-menu-btn" onclick="AdminPanel.toggleStreamMenu(${c.id}, event)">≡</button>
            <div class="xui-stream-dropdown hidden" id="stream-menu-${c.id}">
              <button type="button" onclick="AdminPanel.closeStreamMenus(); AdminPanel.openChannelModal(${c.id})">Editar</button>
              <button type="button" class="danger" onclick="AdminPanel.closeStreamMenus(); AdminPanel.deleteChannel(${c.id}, '${this.escAttr(c.name).replace(/'/g, "\\'")}')">Eliminar</button>
            </div>
          </div>
        </div>
      </td>
      <td class="xui-stream-player">
        <button type="button" class="xui-player-btn${isUp ? '' : ' off'}" ${isUp ? `onclick="AdminPanel.previewChannelQuick(${c.id})"` : 'disabled'} title="Preview">▶</button>
      </td>
      <td class="xui-stream-epg">
        <button type="button" class="xui-epg-btn" onclick="AdminPanel.openStreamEditor(${c.id}, 'epg')" title="EPG">📋</button>
      </td>
      <td class="xui-stream-info">${this.streamInfoHtml(c.uplink_info, status)}</td>
    </tr>`;
  },

  uptimeBadge(status) {
    if (status === 'up') return '<span class="xui-uptime xui-uptime-up">UP</span>';
    if (status === 'down') return '<span class="xui-uptime xui-uptime-down">DOWN</span>';
    return '<span class="xui-uptime xui-uptime-unknown">—</span>';
  },

  streamInfoHtml(info, status) {
    if (!info || status !== 'up') {
      return '<span class="xui-info-none">No information available</span>';
    }
    const parts = String(info).split(' · ').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return `<span class="xui-info-text">${this.escSeries(info)}</span>`;
    return `<div class="xui-info-lines">${parts.map((p) => `<span class="xui-info-line">${this.escSeries(p)}</span>`).join('')}</div>`;
  },

  streamLiveToggleHtml(c) {
    const on = c.enabled !== 0;
    const btn = on
      ? `<button type="button" class="xui-btn xui-btn-ghost xui-btn-sm xui-live-toggle-btn" onclick="AdminPanel.setChannelLive(${c.id}, false)" title="Ocultar en En Vivo">Desactivar</button>`
      : `<button type="button" class="xui-btn xui-btn-success xui-btn-sm xui-live-toggle-btn" onclick="AdminPanel.setChannelLive(${c.id}, true)" title="Mostrar en En Vivo de la plataforma">Activar canal</button>`;
    return `<div class="xui-stream-live-wrap">
      <label class="xui-switch xui-stream-live-switch" title="Visible en En Vivo">
        <input type="checkbox"${on ? ' checked' : ''} onchange="AdminPanel.setChannelLive(${c.id}, this.checked)">
        <span class="xui-switch-slider"></span>
      </label>
      ${btn}
    </div>`;
  },

  async setChannelLive(id, active) {
    try {
      const r = await api(`/live/channels/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: active ? 1 : 0 })
      });
      const ch = (this._streamsCache || []).find((c) => c.id === id);
      if (ch) ch.enabled = r.enabled ?? (active ? 1 : 0);
      this.renderStreamsTable(this._streamsCache || []);
      toast(active ? 'Canal activo en En Vivo' : 'Canal desactivado en la plataforma');
    } catch (e) {
      toast(e.message || 'Error al cambiar estado', true);
      this.loadStreams();
    }
  },

  closeStreamMenus() {
    $$('.xui-stream-dropdown').forEach((d) => d.classList.add('hidden'));
  },

  toggleStreamMenu(id, ev) {
    ev.stopPropagation();
    $$('.xui-stream-dropdown').forEach((d) => {
      if (d.id !== `stream-menu-${id}`) d.classList.add('hidden');
    });
    $(`#stream-menu-${id}`)?.classList.toggle('hidden');
  },

  async previewChannelQuick(id) {
    try {
      const data = await api(`/live/channels/${id}`);
      const url = data.config?.sources?.[0]?.url || data.stream_url;
      if (!url) return toast('Sin URL de fuente', true);
      this.openStreamEditor(id, 'sources');
      const adv = data.config?.advanced || {};
      const src = data.config?.sources?.[0] || {};
      this.playStreamPreview(url, data.name, data.uplink_info || '', {
        user_agent: src.user_agent || adv.user_agent,
        referer: src.referer || adv.referer
      });
    } catch (e) {
      toast(e.message, true);
    }
  },

  async loadCategories() {
    const cats = await api(`/categories?type=${this.catType}`);
    const filtered = this.filter(cats, ['name']);
    $('#xui-categories-type-label').textContent = this.catTypeLabel(this.catType);
    const unit = this.catCountLabel(this.catType);
    $('#xui-categories-table').innerHTML = filtered.map(c => `
      <tr>
        <td><strong>${c.name}</strong></td>
        <td>${c.count} ${unit}</td>
        <td>
          <button class="xui-btn xui-btn-ghost xui-btn-sm" onclick="AdminPanel.openCategoryModal(${c.id}, '${c.name.replace(/'/g, "\\'")}')">Editar</button>
          <button class="xui-btn xui-btn-danger xui-btn-sm" onclick="AdminPanel.deleteCategory(${c.id}, '${c.name.replace(/'/g, "\\'")}', ${c.count})">Eliminar</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="3" style="text-align:center;color:#6c7293">Sin categorías. Crea una nueva.</td></tr>`;
  },

  stopVodPoll() {
    if (this.vodPollTimer) clearInterval(this.vodPollTimer);
    this.vodPollTimer = null;
  },

  startVodPoll(intervalMs = 2500) {
    this.stopVodPoll();
    this.vodPollTimer = setInterval(() => this.pollVodDownload(), intervalMs);
  },

  renderVodCardProgress(cardEl, p, movieId) {
    if (!cardEl) return;
    let panel = cardEl.querySelector('.vod-hub__dl-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'vod-hub__dl-panel';
      const actions = cardEl.querySelector('.vod-hub__actions');
      if (actions) actions.replaceWith(panel);
    }
    cardEl.classList.add('vod-hub__card--downloading');
    const fake = {
      id: movieId,
      available: (!p?.active && Number(p?.percent) >= 100) ? 1 : 0,
      download_progress: p
    };
    const done = fake.available === 1 || (p && !p.active && p.status === 'ready');
    if (done) {
      panel.innerHTML = '<span class="badge active">✓ Descarga completada</span>'
        + ` <button type="button" class="vod-hub__btn vod-hub__btn--ghost vod-hub__btn--sm" data-vod-goto="${movieId}">Ver en VOD</button>`;
      delete this._vodSearchDownloads[movieId];
      cardEl.classList.remove('vod-hub__card--downloading');
      cardEl.classList.add('vod-hub__card--done');
      return;
    }
    panel.innerHTML = `<div class="vod-hub__dl-label">Descargando</div>${this.vodStatusHtml(fake)}`
      + ` <button type="button" class="vod-hub__btn vod-hub__btn--ghost vod-hub__btn--sm" data-vod-goto="${movieId}">Ver en VOD</button>`;
  },

  updateVodSearchCards() {
    const map = this._vodSearchDownloads || {};
    for (const [id, meta] of Object.entries(map)) {
      const p = this.vodProgressFor({ id: Number(id) });
      if (meta?.cardEl) this.renderVodCardProgress(meta.cardEl, p, Number(id));
    }
  },

  hasActiveVodDownloads() {
    const searchIds = Object.keys(this._vodSearchDownloads || {});
    if (searchIds.length) {
      for (const id of searchIds) {
        const m = (this._vodMovies || []).find((x) => x.id === Number(id));
        if (!m || this.isPendingVod(m)) return true;
      }
    }
    return (this._vodMovies || []).some((m) => this.isPendingVod(m));
  },

  async pollVodDownload() {
    try {
      const prev = { ...this._vodProgress };
      const extra = await api('/admin/movies/download-progress');
      this._vodProgress = { ...this._vodProgress, ...extra };
      if (this._vodMovies) {
        for (const m of this._vodMovies) {
          if (extra[m.id]) m.download_progress = extra[m.id];
        }
      }
      this.updateVodSearchCards();
      if (this.section === 'vod') {
        const movies = this.filter(this._vodMovies || [], ['title', 'genre']);
        this.renderVodTable(movies);
      }
      const stillPending = this.hasActiveVodDownloads();
      if (!stillPending) this.stopVodPoll();
      const wasActive = Object.values(prev).some((p) => p.active && p.percent < 100);
      const nowActive = Object.values(this._vodProgress).some((p) => p.active && p.percent < 100);
      if (stillPending && wasActive && !nowActive) await this.loadVod();
    } catch { /* ignore poll errors */ }
  },

  vodProgressFor(m) {
    const id = m.id;
    return m.download_progress
      || this._vodProgress[id]
      || this._vodProgress[String(id)]
      || null;
  },

  isPendingVod(m) {
    if (Number(m.available) === 0) return true;
    const p = this.vodProgressFor(m);
    return !!(p?.active && (p.updating || p.percent < 100));
  },

  vodQualityHtml(m) {
    const p = this.vodProgressFor(m);
    if (this.isPendingVod(m) && p?.target_quality) {
      return `<span class="badge inactive">${this.escAttr(p.target_quality)}</span>`;
    }
    if (m.video_quality) {
      return `<span class="badge active">${this.escAttr(m.video_quality)}</span>`;
    }
    return '<span class="xui-muted-text">—</span>';
  },

  vodStatusHtml(m) {
    if (!this.isPendingVod(m)) {
      return '<span class="badge active">✓ Descargada</span>';
    }
    const p = this.vodProgressFor(m);
    if (p?.updating && p?.active) {
      const pct = Math.min(99, Math.max(0, Number(p.percent) || 0));
      const pctLabel = pct % 1 === 0 ? pct : pct.toFixed(1);
      const detail = [p.downloaded_human, p.total_human, p.speed, p.message].filter(Boolean).join(' · ');
      return `<div class="xui-vod-dl-status">
        <span class="badge inactive" style="background:#8b5cf6">↻ Actualizando${p.target_quality ? ` ${this.escAttr(p.target_quality)}` : ''}</span>
        ${pct > 0 ? `<div class="xui-vod-dl-track"><div class="xui-vod-dl-fill" style="width:${pct}%"></div></div>
        <span class="badge inactive">⏳ ${pctLabel}%</span>` : ''}
        ${detail ? `<small class="xui-vod-dl-meta">${this.escAttr(detail)}</small>` : ''}
      </div>`;
    }
    if (!p?.active && !(Number(p?.percent) > 0)) {
      const hint = p?.message || 'En cola';
      return `<span class="badge inactive">⏳ Pendiente</span><small class="xui-vod-dl-meta">${this.escAttr(hint)}</small>`;
    }
    if (p?.status === 'stalled') {
      return `<div class="xui-vod-dl-status">
        <span class="badge inactive" style="background:#e67e22">⚠ Detenida</span>
        <small class="xui-vod-dl-meta">${p.message || 'Pulsa Reanudar'}</small>
      </div>`;
    }
    if (p?.status === 'processing' || p?.status === 'merging') {
      const lbl = p.status === 'merging' ? 'Finalizando descarga' : (p.converting_format ? `Convirtiendo a ${String(p.converting_format).toUpperCase()}` : 'Procesando');
      const extra = p.detail || (p.playable_format === 'mkv' ? 'Ya se puede reproducir en MKV' : '');
      return `<div class="xui-vod-dl-status">
        <span class="badge inactive" style="background:#3498db">⚙ ${lbl}</span>
        <small class="xui-vod-dl-meta">${[p.message, extra].filter(Boolean).join(' · ')}</small>
      </div>`;
    }
    const pct = Math.min(99, Math.max(0, Number(p.percent) || 0));
    const pctLabel = pct % 1 === 0 ? pct : pct.toFixed(1);
    const sizeLine = [p.downloaded_human, p.total_human].filter(Boolean).join(' / ');
    const detail = [sizeLine, p.speed, p.eta ? `ETA ${p.eta}` : '', p.message].filter(Boolean).join(' · ');
    return `<div class="xui-vod-dl-status">
      <span class="badge inactive">⏳ ${pctLabel}%</span>
      <div class="xui-vod-dl-track"><div class="xui-vod-dl-fill" style="width:${pct}%"></div></div>
      ${detail ? `<small class="xui-vod-dl-meta">${detail}</small>` : ''}
    </div>`;
  },

  renderVodTable(movies) {
    $('#xui-vod-table').innerHTML = movies.map((m) => `
      <tr data-movie-id="${m.id}">
        <td>${m.id}</td>
        <td>${m.poster ? `<img class="thumb" src="${m.poster}">` : '🎬'}</td>
        <td><strong>${m.title}</strong></td>
        <td>${m.genre || '-'}</td>
        <td>${m.year || '-'}</td>
        <td class="xui-vod-quality-cell">${this.vodQualityHtml(m)}</td>
        <td class="xui-vod-status-cell">${this.vodStatusHtml(m)}</td>
        <td>${m.rating >= 7 ? `⭐ ${m.rating}` : (m.rating ? m.rating : '-')}</td>
        <td class="url-cell">${m.video_path}</td>
        <td>
          ${this.isPendingVod(m) ? `<button class="xui-btn xui-btn-success xui-btn-sm" onclick="AdminPanel.resumeVodDownload(${m.id})">Reanudar</button>` : ''}
          <button class="xui-btn xui-btn-ghost xui-btn-sm" onclick="AdminPanel.openVodModal(${m.id})">Editar</button>
          <button class="xui-btn xui-btn-danger xui-btn-sm" onclick="AdminPanel.deleteVod(${m.id})">Eliminar</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="9" style="text-align:center;color:#6c7293">Sin películas</td></tr>';
  },

  async loadVod() {
    let movies = await api('/movies?all=1');
    this._vodMovies = movies;
    movies = this.filter(movies, ['title', 'genre']);
    this._vodProgress = {};
    for (const m of movies) {
      if (m.download_progress) this._vodProgress[m.id] = m.download_progress;
    }
    try {
      const extra = await api('/admin/movies/download-progress');
      this._vodProgress = { ...this._vodProgress, ...extra };
    } catch { /* progreso ya viene en /movies?all=1 */ }
    this.renderVodTable(movies);
    if (movies.some((m) => this.isPendingVod(m))) this.startVodPoll();
    else this.stopVodPoll();
  },

  stopSeriesPoll() {
    if (this.seriesPollTimer) clearInterval(this.seriesPollTimer);
    this.seriesPollTimer = null;
  },

  startSeriesPoll() {
    this.stopSeriesPoll();
    this.seriesPollTimer = setInterval(() => {
      if (this.section === 'series') this.pollSeriesDownloads();
    }, 8000);
  },

  async pollSeriesDownloads() {
    try {
      const expanded = [...this.seriesExpanded];
      if (!expanded.length) return;
      for (const seriesId of expanded) {
        const extra = await api(`/admin/episodes/download-progress?series_id=${seriesId}`);
        this._episodeProgress = { ...this._episodeProgress, ...extra };
        const body = $(`#xui-series-body-${seriesId}`);
        if (!body || body.classList.contains('hidden')) continue;
        body.querySelectorAll('.xui-ep-row[data-episode-id]').forEach((row) => {
          const epId = parseInt(row.dataset.episodeId, 10);
          const cell = row.querySelector('.xui-ep-dl');
          if (!cell) return;
          const ep = { id: epId, available: row.dataset.available === '0' ? 0 : 1 };
          cell.innerHTML = this.episodeStatusHtml(ep);
        });
      }
      const anyPending = Object.values(this._episodeProgress).some(
        (p) => p && (p.active || (p.percent > 0 && p.percent < 100))
      );
      if (!anyPending && !expanded.some((id) => {
        const cached = this.seriesCache[id];
        return cached?.episodes?.some((e) => Number(e.available) === 0);
      })) {
        await this.loadSeries();
      }
    } catch { /* ignore */ }
  },

  episodeProgressFor(ep) {
    return ep.download_progress
      || this._episodeProgress[ep.id]
      || this._episodeProgress[String(ep.id)]
      || null;
  },

  isPendingEpisode(ep) {
    return Number(ep.available) === 0;
  },

  episodeQualityHtml(ep) {
    const p = this.episodeProgressFor(ep);
    if (Number(ep.available) === 0 && p?.target_quality) {
      return `<span class="badge inactive">${this.escAttr(p.target_quality)}</span>`;
    }
    if (ep.video_quality) {
      return `<span class="badge active">${this.escAttr(ep.video_quality)}</span>`;
    }
    return '';
  },

  episodeStatusHtml(ep) {
    if (!this.isPendingEpisode(ep)) {
      return '<span class="badge active">✓ Listo</span>';
    }
    const p = this.episodeProgressFor(ep);
    if (!p?.active && !(Number(p?.percent) > 0)) {
      return `<span class="badge inactive">⏳ Pendiente</span><small class="xui-vod-dl-meta">${p?.message || 'Sin iniciar'}</small>`;
    }
    if (p?.status === 'stalled') {
      return `<div class="xui-vod-dl-status">
        <span class="badge inactive" style="background:#e67e22">⚠ Detenida</span>
        <small class="xui-vod-dl-meta">${p.message || 'Reanudar descarga'}</small>
      </div>`;
    }
    if (p?.status === 'processing' || p?.status === 'merging') {
      return `<div class="xui-vod-dl-status">
        <span class="badge inactive" style="background:#3498db">⚙ ${p.status === 'merging' ? 'Finalizando' : 'Procesando'}</span>
        <small class="xui-vod-dl-meta">${p.message || ''}</small>
      </div>`;
    }
    const pct = Math.min(99, Math.max(0, Number(p.percent) || 0));
    const pctLabel = pct % 1 === 0 ? pct : pct.toFixed(1);
    const detail = [p.downloaded_human, p.total_human, p.speed, p.eta ? `ETA ${p.eta}` : '', p.message]
      .filter(Boolean).join(' · ');
    return `<div class="xui-vod-dl-status">
      <span class="badge inactive">⏳ ${pctLabel}%</span>
      <div class="xui-vod-dl-track"><div class="xui-vod-dl-fill" style="width:${pct}%"></div></div>
      ${detail ? `<small class="xui-vod-dl-meta">${detail}</small>` : ''}
    </div>`;
  },

  async loadSeries() {
    let list = await api('/series/admin/list');
    list = this.filter(list, ['title', 'genre']);
    $('#xui-series-list').innerHTML = list.length
      ? list.map((s) => this.seriesItemHtml(s)).join('')
      : '<p style="color:#6c7293;padding:12px">Sin series. Crea una nueva.</p>';

    const hasPending = list.some((s) => Number(s.pending_episodes) > 0);
    if (hasPending && this.section === 'series') this.startSeriesPoll();
    else if (![...this.seriesExpanded].some((id) => this.seriesCache[id]?.episodes?.some((e) => Number(e.available) === 0))) {
      this.stopSeriesPoll();
    }

    for (const id of this.seriesExpanded) {
      if (list.some((s) => s.id === id)) {
        await this.renderSeriesEpisodes(id);
      } else {
        this.seriesExpanded.delete(id);
      }
    }
  },

  escSeries(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  },

  suggestAllcalidadSlug(series) {
    if (series?.allcalidad_slug) return String(series.allcalidad_slug).trim();
    const t = String(series?.title || '').toLowerCase().trim();
    if (t === 'from') return 'from-2022';
    if (t.includes('derry') || t.includes('bienvenidos')) return 'it-bienvenidos-a-derry-2025';
    return '';
  },

  seriesDownloadBtnHtml(s) {
    const pending = Number(s.pending_episodes) || 0;
    const label = pending > 0
      ? `⬇ Descargar (${pending})`
      : '⬇ Importar capítulos';
    return `<button type="button" class="xui-btn xui-btn-success xui-btn-sm" onclick="AdminPanel.downloadSeriesPending(${s.id})">${label}</button>`;
  },

  seriesItemHtml(s) {
    const expanded = this.seriesExpanded.has(s.id);
    const poster = s.poster
      ? `<img class="xui-series-thumb" src="${this.escSeries(s.poster)}" alt="" onerror="this.style.display='none'">`
      : '<span class="xui-series-thumb-ph">📺</span>';
    return `<div class="xui-series-item" data-series-id="${s.id}">
      <div class="xui-series-head">
        <button type="button" class="xui-series-toggle" data-action="toggle-series">
          <span class="xui-series-chevron">${expanded ? '▼' : '▶'}</span>
          ${poster}
          <span class="xui-series-title">${this.escSeries(s.title)}</span>
          <span class="badge">${this.escSeries(s.genre || 'Sin categoría')}</span>
          <span class="xui-series-meta">${s.season_count || 0} temp · ${s.episode_count || 0} cap.${Number(s.pending_episodes) > 0 ? ` · <span class="badge inactive">${s.pending_episodes} pend.</span>` : ''}</span>
        </button>
        <div class="xui-series-head-actions">
          ${this.seriesDownloadBtnHtml(s)}
          <button type="button" class="xui-btn xui-btn-ghost xui-btn-sm" onclick="AdminPanel.importSeriesAllcalidad(${s.id})">AllCalidad</button>
          <button type="button" class="xui-btn xui-btn-ghost xui-btn-sm" onclick="AdminPanel.openSeriesModal(${s.id})">Editar</button>
          <button type="button" class="xui-btn xui-btn-success xui-btn-sm" onclick="AdminPanel.openEpisodeModal(${s.id})">+ Episodio</button>
          <button type="button" class="xui-btn xui-btn-danger xui-btn-sm" onclick="AdminPanel.deleteSeries(${s.id})">Eliminar</button>
        </div>
      </div>
      <div class="xui-series-body${expanded ? '' : ' hidden'}" id="xui-series-body-${s.id}">
        ${expanded ? '<div class="xui-series-loading">Cargando episodios…</div>' : ''}
      </div>
    </div>`;
  },

  async toggleSeriesExpand(id) {
    if (this.seriesExpanded.has(id)) {
      this.seriesExpanded.delete(id);
    } else {
      this.seriesExpanded.add(id);
    }
    await this.loadSeries();
  },

  groupEpisodesBySeason(episodes) {
    const bySeason = {};
    (episodes || []).forEach((ep) => {
      const season = ep.season || 1;
      if (!bySeason[season]) bySeason[season] = [];
      bySeason[season].push(ep);
    });
    Object.values(bySeason).forEach((eps) => eps.sort((a, b) => a.episode - b.episode));
    return bySeason;
  },

  nextEpisodeNumber(episodes, season) {
    const inSeason = (episodes || []).filter((e) => Number(e.season) === Number(season));
    if (!inSeason.length) return 1;
    return Math.max(...inSeason.map((e) => e.episode)) + 1;
  },

  async renderSeriesEpisodes(seriesId) {
    const body = $(`#xui-series-body-${seriesId}`);
    if (!body) return;

    try {
      const data = await api(`/series/${seriesId}/admin`);
      this.seriesCache[seriesId] = data;
      this._episodeProgress = { ...this._episodeProgress };
      for (const ep of data.episodes || []) {
        if (ep.download_progress) this._episodeProgress[ep.id] = ep.download_progress;
      }
      try {
        const extra = await api(`/admin/episodes/download-progress?series_id=${seriesId}`);
        this._episodeProgress = { ...this._episodeProgress, ...extra };
      } catch { /* ignore */ }
      const bySeason = this.groupEpisodesBySeason(data.episodes);
      const seasons = Object.keys(bySeason).sort((a, b) => Number(a) - Number(b));

      if (!seasons.length) {
        body.innerHTML = `<div class="xui-series-empty">
          <p>Sin capítulos en esta serie.</p>
          <button type="button" class="xui-btn xui-btn-success xui-btn-sm" onclick="AdminPanel.openEpisodeModal(${seriesId}, null, 1)">+ Añadir capítulo T1</button>
        </div>`;
        return;
      }

      body.innerHTML = seasons.map((season) => {
        const eps = bySeason[season];
        const rows = eps.map((ep) => `
          <div class="xui-ep-row" data-episode-id="${ep.id}" data-available="${ep.available === 0 ? 0 : 1}">
            <span class="xui-ep-num">E${String(ep.episode).padStart(2, '0')}</span>
            <span class="xui-ep-title" title="${this.escSeries(ep.video_path)}">${this.escSeries(ep.title)}${ep.video_quality ? ` <span class="badge active">${this.escSeries(ep.video_quality)}</span>` : ''}</span>
            <div class="xui-ep-dl">${this.episodeStatusHtml(ep)}</div>
            <div class="xui-ep-actions">
              <button type="button" class="xui-btn xui-btn-ghost xui-btn-sm" onclick="AdminPanel.openEpisodeModal(${seriesId}, ${ep.id})">Editar</button>
              <button type="button" class="xui-btn xui-btn-danger xui-btn-sm" onclick="AdminPanel.deleteEpisode(${seriesId}, ${ep.id})">Eliminar</button>
            </div>
          </div>`).join('');

        return `<div class="xui-season-block">
          <div class="xui-season-head">
            <strong>📁 Temporada ${season}</strong>
            <span class="badge">${eps.length} capítulo${eps.length === 1 ? '' : 's'}</span>
            <button type="button" class="xui-btn xui-btn-success xui-btn-sm" onclick="AdminPanel.openEpisodeModal(${seriesId}, null, ${season})">+ Capítulo</button>
          </div>
          <div class="xui-episodes-list">${rows}</div>
        </div>`;
      }).join('');
      if ((data.episodes || []).some((e) => Number(e.available) === 0)) {
        this.startSeriesPoll();
      }
    } catch (e) {
      body.innerHTML = `<p class="xui-series-error">${this.escSeries(e.message)}</p>`;
    }
  },

  async importSeriesAllcalidad(seriesId) {
    const cached = this.seriesCache[seriesId];
    const fromList = (await api('/series/admin/list').catch(() => []))
      .find((s) => s.id === seriesId);
    const series = cached || fromList || {};
    let slug = this.suggestAllcalidadSlug(series);
    if (!slug) {
      slug = window.prompt(
        'Slug de AllCalidad (URL de la serie, ej: from-2022):',
        this.suggestAllcalidadSlug(series)
      )?.trim() || '';
    }
    if (!slug) return toast('Slug requerido', true);
    const download = window.confirm(
      '¿Descargar los capítulos desde AllCalidad?\n\nAceptar = catálogo + descarga\nCancelar = solo catálogo (sin archivos)'
    );
    try {
      await api('/admin/series/import-allcalidad', {
        method: 'POST',
        body: JSON.stringify({
          slug,
          download,
          only_missing: true,
          series_id: seriesId
        })
      });
      toast(download ? 'Descarga iniciada en segundo plano' : 'Catálogo importado');
      this.seriesExpanded.add(seriesId);
      delete this.seriesCache[seriesId];
      await this.refreshSeriesKeepOpen();
      if (download) this.startSeriesPoll();
    } catch (e) {
      toast(e.message, true);
    }
  },

  async downloadSeriesPending(seriesId) {
    const cached = this.seriesCache[seriesId];
    const fromList = (await api('/series/admin/list').catch(() => []))
      .find((s) => s.id === seriesId);
    const series = cached || fromList || {};
    let slug = this.suggestAllcalidadSlug(series);
    if (!slug) {
      slug = window.prompt('Slug AllCalidad (ej: from-2022):', '')?.trim() || '';
    }
    if (!slug) return toast('Configura el slug en Editar serie o escríbelo aquí', true);
    try {
      const r = await api(`/admin/series/${seriesId}/download-pending`, {
        method: 'POST',
        body: JSON.stringify({ slug })
      });
      toast(r.message || 'Importación y descarga iniciadas');
      this.seriesExpanded.add(seriesId);
      delete this.seriesCache[seriesId];
      await this.refreshSeriesKeepOpen();
      this.startSeriesPoll();
    } catch (e) {
      toast(e.message, true);
    }
  },

  async refreshSeriesKeepOpen() {
    if (this.section !== 'series') return;
    await this.loadSeries();
  },

  async loadPlaylists() {
    const playlists = await api('/live/playlists');
    $('#xui-playlists-table').innerHTML = playlists.map(p => `
      <tr>
        <td>${p.id}</td><td><strong>${p.name}</strong></td><td>${p.channel_count || 0}</td>
        <td class="url-cell">${p.m3u_url || 'Manual'}</td>
        <td>
          ${p.m3u_url ? `<button class="xui-btn xui-btn-ghost xui-btn-sm" onclick="AdminPanel.refreshPlaylist(${p.id})">↻ Actualizar</button>` : ''}
          <button class="xui-btn xui-btn-danger xui-btn-sm" onclick="AdminPanel.deletePlaylist(${p.id})">Eliminar</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#6c7293">Sin listas</td></tr>';
  },

  async loadUsers() {
    let users = await api('/auth/users');
    users = this.filter(users, ['username', 'role']);
    $('#xui-users-table').innerHTML = users.map(u => {
      const access = [
        u.can_live ? 'En vivo' : null,
        u.can_movies ? 'Películas' : null,
        u.can_series ? 'Series' : null
      ].filter(Boolean).join(' · ') || '—';
      const expiry = u.expiry_label || 'Sin expiración';
      return `
      <tr>
        <td>${u.id}</td><td><strong>${u.username}</strong></td>
        <td>${expiry}</td>
        <td style="font-size:.8rem">${access}</td>
        <td><span class="badge ${u.active ? 'active' : 'inactive'}">${u.active ? 'Activo' : 'Inactivo'}</span></td>
        <td>${u.username !== 'admin' ? `
          <button class="xui-btn xui-btn-ghost xui-btn-sm" onclick="AdminPanel.resetUserPassword(${u.id},'${String(u.username).replace(/'/g, "\\'")}')">Restablecer clave</button>
          <button class="xui-btn xui-btn-ghost xui-btn-sm" onclick="AdminPanel.toggleUser(${u.id},${u.active?0:1})">${u.active?'Desactivar':'Activar'}</button>
          <button class="xui-btn xui-btn-danger xui-btn-sm" onclick="AdminPanel.deleteUser(${u.id})">Eliminar</button>` : '-'}</td>
      </tr>`;
    }).join('');
  },

  async loadSettings() {
    const [data, xui] = await Promise.all([
      api('/admin/settings'),
      api('/admin/xui/settings').catch(() => ({}))
    ]);
    $('#xui-tmdb-key').value = data.tmdb_api_key || '';
    const status = $('#xui-tmdb-status');
    if (data.tmdb_configured) {
      status.innerHTML = `✅ TMDB configurada <span style="opacity:.7">(${data.tmdb_api_key_masked})</span>`;
      status.style.color = '#2ecc71';
    } else {
      status.textContent = '⚠️ Sin API Key — se usan carátulas generadas automáticamente';
      status.style.color = '#e67e22';
    }
    if ($('#xui-proxy-enabled')) {
      $('#xui-proxy-enabled').checked = !!data.stream_proxy_enabled;
      $('#xui-proxy-list').value = data.stream_proxy_list || '';
      const ps = $('#xui-proxy-status');
      if (ps) {
        const count = data.stream_proxy_count || 0;
        if (data.stream_proxy_enabled && count) {
          ps.textContent = `✅ Proxy activo · ${count} servidor(es) en pool`;
          ps.style.color = '#2ecc71';
        } else if (data.stream_proxy_enabled) {
          ps.textContent = '⚠️ Activado pero sin proxies — agrega al menos uno';
          ps.style.color = '#e67e22';
        } else {
          ps.textContent = 'Desactivado — las peticiones salen con la IP del servidor';
          ps.style.color = '';
        }
      }
    }
    if ($('#vod-nightly-enabled')) {
      $('#vod-nightly-enabled').checked = data.vod_nightly_enabled !== false;
      $('#vod-nightly-paused').checked = !!data.vod_nightly_paused;
      $('#vod-nightly-cuevana').checked = data.vod_nightly_cuevana !== false;
      $('#vod-nightly-allcalidad').checked = data.vod_nightly_allcalidad !== false;
      $('#vod-nightly-years').value = data.vod_nightly_years || '2026,2025,2024';
      $('#vod-nightly-limit').value = data.vod_nightly_limit ?? 2;
      $('#vod-nightly-hour').value = data.vod_nightly_hour ?? 2;
      $('#vod-nightly-minute').value = data.vod_nightly_minute ?? 0;
      const limLbl = $('#vod-nightly-limit-label');
      if (limLbl) limLbl.textContent = String(data.vod_nightly_limit ?? 2);
      const ec = $('#vod-nightly-ec-now');
      if (ec) ec.textContent = `Hora servidor Ecuador: ${data.ecuador_now || '—'}`;
      const st = $('#vod-nightly-status');
      if (st) {
        if (data.vod_nightly_paused) {
          st.textContent = '⏸ Pausado — no descargará hasta que quites la pausa';
          st.style.color = '#e67e22';
        } else if (data.vod_nightly_enabled) {
          st.textContent = `✅ Activo · ${data.vod_nightly_next_hint || ''}`;
          st.style.color = '#2ecc71';
        } else {
          st.textContent = 'Desactivado';
          st.style.color = '#6c7293';
        }
        if (data.vod_nightly_last_run) {
          st.textContent += ` · Última: ${new Date(data.vod_nightly_last_run).toLocaleString('es-EC')}`;
        }
      }
      const last = $('#vod-nightly-last');
      if (last && data.vod_nightly_last_result) {
        last.textContent = JSON.stringify(data.vod_nightly_last_result, null, 2);
      }
    }
    if ($('#app-mobile-version-code')) {
      $('#app-mobile-version-code').value = data.app_mobile_version_code ?? 1;
      $('#app-mobile-version-name').value = data.app_mobile_version_name || '1.0.0';
      $('#app-tv-version-code').value = data.app_tv_version_code ?? 1;
      $('#app-tv-version-name').value = data.app_tv_version_name || '1.0.0';
      $('#app-update-message').value = data.app_update_message || '';
      $('#app-update-force').checked = !!data.app_update_force;
      const st = $('#app-update-status');
      if (st) {
        const parts = [];
        parts.push(data.app_mobile_apk_available ? '✅ APK móvil en servidor' : '⚠️ Falta data/apk/VixTV-mobile.apk');
        parts.push(data.app_tv_apk_available ? '✅ APK TV en servidor' : '⚠️ Falta data/apk/VixTV-tv.apk');
        st.textContent = parts.join(' · ');
        st.style.color = (data.app_mobile_apk_available && data.app_tv_apk_available) ? '#2ecc71' : '#e67e22';
      }
      fetch('/api/app/download-links').then((r) => r.json()).then((links) => {
        const dl = $('#app-download-links');
        if (!dl) return;
        const tvVer = links.tv_version_name ? ` v${links.tv_version_name}` : '';
        const mobVer = links.mobile_version_name ? ` v${links.mobile_version_name}` : '';
        dl.innerHTML = `📥 <strong>TV${tvVer}:</strong> <a href="${links.tv_apk_direct || links.tv_apk}" target="_blank" rel="noopener"><code>${links.tv_short}</code></a> · `
          + `<strong>Móvil${mobVer}:</strong> <a href="${links.mobile_apk_direct || links.mobile_apk}" target="_blank" rel="noopener"><code>${links.mobile_short}</code></a> · `
          + `<strong>iPhone:</strong> <code>${links.ios_short}</code> (PWA) · `
          + `<a href="${links.download_page}" target="_blank" rel="noopener">Página descargar</a>`;
      }).catch(() => {});
    }
    if ($('#xui-cfg-base')) {
      $('#xui-admin-url').value = xui.xui_admin_url || 'http://5.5.5.5/administracion';
      $('#xui-admin-user').value = xui.xui_admin_user || 'elvixplay';
      $('#xui-cfg-base').value = xui.xui_base_url || '';
      $('#xui-cfg-user').value = xui.xui_username || '';
      $('#xui-cfg-code').value = xui.xui_access_code || 'elvixplay';
      const xs = $('#xui-sync-status');
      if (xs) {
        xs.textContent = xui.xui_admin_configured
          ? '✅ Panel XUI conectado — dashboard en vivo'
          : (xui.xui_configured ? 'Player API OK · falta admin XUI' : 'Configura credenciales XUI abajo');
      }
    }
  },

  async saveXuiSettings() {
    try {
      const body = {
        xui_admin_url: $('#xui-admin-url')?.value.trim(),
        xui_admin_user: $('#xui-admin-user')?.value.trim(),
        xui_admin_pass: $('#xui-admin-pass')?.value,
        xui_base_url: $('#xui-cfg-base')?.value.trim(),
        xui_username: $('#xui-cfg-user')?.value.trim(),
        xui_password: $('#xui-cfg-pass')?.value,
        xui_access_code: $('#xui-cfg-code')?.value.trim(),
        xui_api_key: $('#xui-cfg-key')?.value
      };
      await api('/admin/xui/settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Configuración XUI guardada');
      $('#xui-admin-pass').value = '';
      $('#xui-cfg-pass').value = '';
      $('#xui-cfg-key').value = '';
      this.loadSettings();
      if (this.section === 'dashboard') {
        this._dashReady = false;
        this.loadDashboard();
      }
    } catch (e) { toast(e.message, true); }
  },

  async testXuiAdmin() {
    try {
      toast('Probando login XUI…');
      const r = await api('/admin/xui/test-admin', {
        method: 'POST',
        body: JSON.stringify({
          xui_admin_url: $('#xui-admin-url')?.value.trim(),
          xui_admin_user: $('#xui-admin-user')?.value.trim(),
          xui_admin_pass: $('#xui-admin-pass')?.value
        })
      });
      toast(r.message || 'XUI conectado');
      this.loadSettings();
    } catch (e) { toast(e.message, true); }
  },

  async importChannelsFromXui() {
    if (!confirm('¿Importar canales desde Streams del panel XUI (URLs fuente reales)?')) return;
    try {
      toast('Importando streams desde XUI admin…');
      const r = await api('/admin/xui/import-channels', {
        method: 'POST',
        body: JSON.stringify({ download: true })
      });
      toast(`XUI: ${r.imported} canales · ${r.skipped} omitidos · ${r.streams_found} en panel`);
      this.refresh();
    } catch (e) { toast(e.message, true); }
  },

  async syncLogosFromXui() {
    try {
      toast('Importando logos desde XUI…');
      const r = await api('/admin/xui/sync-logos', { method: 'POST', body: JSON.stringify({ download: true }) });
      toast(`Logos: ${r.updated} actualizados · ${r.skipped} sin cambio (${r.streams_found} en XUI)`);
      if (this.section === 'streams') this.loadStreams();
    } catch (e) { toast(e.message, true); }
  },

  async saveTmdbKey() {
    const key = $('#xui-tmdb-key').value.trim();
    try {
      const r = await api('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ tmdb_api_key: key })
      });
      toast('API Key TMDB guardada');
      this.loadSettings();
    } catch (e) { toast(e.message, true); }
  },

  async testTmdbKey() {
    try {
      const r = await api('/admin/settings/test-tmdb', { method: 'POST' });
      toast(r.message || 'TMDB conectado correctamente');
    } catch (e) { toast(e.message, true); }
  },

  async saveStreamProxy() {
    try {
      const r = await api('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          stream_proxy_enabled: !!$('#xui-proxy-enabled')?.checked,
          stream_proxy_list: $('#xui-proxy-list')?.value || ''
        })
      });
      toast('Configuración de proxy guardada');
      this.loadSettings();
    } catch (e) { toast(e.message, true); }
  },

  async testStreamProxy() {
    try {
      toast('Probando proxy…');
      const r = await api('/admin/settings/test-stream-proxy', { method: 'POST', body: JSON.stringify({}) });
      toast(`Proxy OK · IP vista: ${r.ip}`);
      this.loadSettings();
    } catch (e) { toast(e.message, true); }
  },

  async saveVodNightly() {
    try {
      const body = {
        vod_nightly_enabled: !!$('#vod-nightly-enabled')?.checked,
        vod_nightly_paused: !!$('#vod-nightly-paused')?.checked,
        vod_nightly_cuevana: !!$('#vod-nightly-cuevana')?.checked,
        vod_nightly_allcalidad: !!$('#vod-nightly-allcalidad')?.checked,
        vod_nightly_years: $('#vod-nightly-years')?.value.trim(),
        vod_nightly_limit: parseInt($('#vod-nightly-limit')?.value, 10) || 0,
        vod_nightly_hour: parseInt($('#vod-nightly-hour')?.value, 10) || 2,
        vod_nightly_minute: parseInt($('#vod-nightly-minute')?.value, 10) || 0
      };
      await api('/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Automatización VOD guardada');
      this.loadSettings();
    } catch (e) {
      toast(e.message, true);
    }
  },

  async saveAppUpdate() {
    try {
      const body = {
        app_mobile_version_code: parseInt($('#app-mobile-version-code')?.value, 10) || 1,
        app_mobile_version_name: $('#app-mobile-version-name')?.value.trim(),
        app_tv_version_code: parseInt($('#app-tv-version-code')?.value, 10) || 1,
        app_tv_version_name: $('#app-tv-version-name')?.value.trim(),
        app_update_message: $('#app-update-message')?.value.trim(),
        app_update_force: !!$('#app-update-force')?.checked
      };
      await api('/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Versiones de app guardadas — los usuarios recibirán aviso al abrir la app');
      this.loadSettings();
    } catch (e) {
      toast(e.message, true);
    }
  },

  vodSiteHost(url) {
    if (!url) return '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  },

  vodSiteBadgeClass(source, sourceSite) {
    const map = { cuevana: 'cuevana', allcalidad: 'allcalidad', cinecalidad: 'cinecalidad', web: 'web', tmdb: 'tmdb' };
    if (source === 'web' && sourceSite) {
      if (/cinecalidad|pelisplus|repelis|gnula|hackstore|maxcine|peliculaspro/i.test(sourceSite)) {
        return 'web';
      }
    }
    return map[source] || 'web';
  },

  vodSiteDisplayName(item) {
    if (item.source === 'cuevana') return 'Cuevana 3';
    if (item.source === 'cinecalidad') return 'Cinecalidad';
    if (item.source === 'allcalidad') return 'AllCalidad';
    if (item.source === 'tmdb') return 'TMDB (info)';
    if (item.source === 'web') {
      const host = this.vodSiteHost(item.url);
      return host ? host : (item.source_site || 'Internet');
    }
    return item.source || '—';
  },

  vodDownloadQualityOptions(item = {}) {
    if (item.available_qualities?.length) {
      return item.available_qualities.map((o) => ({ v: o.value, l: o.label }));
    }
    return [
      { v: 'max', l: 'Máxima — 4K / mejor disponible' },
      { v: '1080', l: 'Full HD — 1080p' },
      { v: '720', l: 'HD — 720p' },
      { v: '480', l: 'SD — 480p (menor peso)' }
    ];
  },

  vodQualityLabelFor(value) {
    const opt = this.vodDownloadQualityOptions().find((o) => o.v === value);
    return opt?.l || value || 'Máxima';
  },

  pickVodDownloadQuality(item = {}) {
    return new Promise((resolve) => {
      const options = this.vodDownloadQualityOptions(item);
      const defaultQ = item.recommended_quality || '1080';
      const maxHint = item.stream_quality_label
        ? `Máximo en este enlace: ${item.stream_quality_label}. `
        : '';
      const label = `${maxHint}Elige la calidad del archivo a descargar:`;
      this._modalCancelCallback = () => {
        this._modalCancelCallback = null;
        resolve(null);
      };
      this.openModal(
        item.title ? `Descargar — ${item.title}` : 'Calidad de descarga',
        [{ key: 'quality', label, type: 'select', options }],
        { quality: defaultQ },
        async () => {
          this._modalCancelCallback = null;
          const vals = this.getModalValues(['quality']);
          this.closeModal();
          resolve(vals.quality);
        }
      );
    });
  },

  isVodDownloadable(item) {
    if (item.catalog_only) return false;
    if (item.source === 'tmdb' && !item.slug) return false;
    return !!(item.slug || (item.url && item.source !== 'tmdb'));
  },

  renderVodHubCard(item, i, opts = {}) {
    const poster = item.poster
      ? `<img src="${this.escAttr(item.poster)}" alt="" class="vod-hub__poster" loading="lazy">`
      : '<div class="vod-hub__poster vod-hub__poster--empty"><span aria-hidden="true">🎬</span></div>';
    const typeLabel = item.type === 'series' ? 'Serie' : 'Película';
    const downloadable = this.isVodDownloadable(item);
    const canImport = downloadable;
    const canDownload = downloadable;
    const siteName = this.vodSiteDisplayName(item);
    const badgeClass = this.vodSiteBadgeClass(item.source, item.source_site);
    const note = !downloadable
      ? `<p class="vod-hub__note">Solo referencia — busca en <strong>Todo internet</strong> o pega URL de AllCalidad/Cuevana</p>`
      : (item.note ? `<p class="vod-hub__note">${this.escAttr(item.note)}</p>` : '');
    const disCat = canImport ? '' : 'disabled';
    const disDl = canDownload ? '' : 'disabled';
    const urlShow = item.url || (item.slug ? `slug: ${item.slug}` : '');
    const cardClass = downloadable ? 'vod-hub__card' : 'vod-hub__card vod-hub__card--ref';

    return `<article class="${cardClass}" data-vod-item data-index="${i}"
      data-type="${this.escAttr(item.type)}"
      data-source="${this.escAttr(item.source)}"
      data-slug="${this.escAttr(item.slug)}"
      data-url="${this.escAttr(item.url)}"
      data-title="${this.escAttr(item.title)}"
      data-year="${this.escAttr(item.year || '')}">
      ${poster}
      <div class="vod-hub__info">
        <span class="vod-hub__name">${this.escAttr(item.title)}</span>
        <div class="vod-hub__badges">
          <span class="vod-hub__badge vod-hub__badge--type">${typeLabel}</span>
          <span class="vod-hub__badge vod-hub__badge--${badgeClass}">${this.escAttr(siteName)}</span>
          ${item.year ? `<span class="vod-hub__badge vod-hub__badge--year">${item.year}</span>` : ''}
          ${item.in_catalog ? '<span class="vod-hub__badge vod-hub__badge--year">En catálogo</span>' : ''}
          ${item.stream_quality_label ? `<span class="vod-hub__badge vod-hub__badge--quality">Hasta ${this.escAttr(item.stream_quality_label)}</span>` : ''}
        </div>
        <p class="vod-hub__site"><strong>Página:</strong> ${this.escAttr(urlShow)}</p>
        ${note}
      </div>
      <div class="vod-hub__actions">
        <button type="button" class="vod-hub__btn vod-hub__btn--ghost" data-vod-action="catalog" ${disCat}>Catálogo</button>
        <button type="button" class="vod-hub__btn vod-hub__btn--dl" data-vod-action="download" ${disDl}>Descargar</button>
      </div>
    </article>`;
  },

  async runVodSearch() {
    const q = $('#vod-search-query')?.value.trim();
    const source = $('#vod-search-source')?.value || 'all';
    const status = $('#vod-search-status');
    const box = $('#vod-search-results');
    if (!q) {
      toast('Escribe un nombre o URL', true);
      return;
    }
    const probeAll = ($('#vod-search-quality-mode')?.value || 'probe_all') === 'probe_all';
    if (status) {
      status.textContent = probeAll
        ? 'Buscando y detectando calidades disponibles…'
        : 'Buscando en internet y catálogos…';
      status.className = 'vod-hub__status vod-hub__status--loading';
    }
    if (box) box.innerHTML = '';
    try {
      const probeParam = probeAll ? '1' : '0';
      const data = await api(`/admin/vod-search?q=${encodeURIComponent(q)}&source=${encodeURIComponent(source)}&probe_qualities=${probeParam}`);
      const results = data.results || [];
      const dlCount = data.downloadable_count ?? results.filter((r) => this.isVodDownloadable(r)).length;
      const refCount = data.reference_count ?? results.length - dlCount;
      if (status) {
        const webN = results.filter((r) => r.source === 'web').length;
        const acN = results.filter((r) => r.source === 'allcalidad').length;
        const ccN = results.filter((r) => r.source === 'cinecalidad').length;
        const cvN = results.filter((r) => r.source === 'cuevana').length;
        const modeHint = data.search_mode === 'internet'
          ? ` · Web ${webN} · Cinecalidad ${ccN} · AllCalidad ${acN} · Cuevana ${cvN}`
          : '';
        if (!results.length) {
          status.textContent = 'Sin resultados — prueba «Todo internet» o pega la URL directa';
          status.className = 'vod-hub__status vod-hub__status--warn';
        } else {
          status.textContent = `✓ ${dlCount} para descargar${refCount > 0 ? ` · ${refCount} referencia TMDB` : ''}${modeHint}`;
          status.className = dlCount > 0 ? 'vod-hub__status vod-hub__status--ok' : 'vod-hub__status vod-hub__status--warn';
        }
      }
      if (!box) return;
      if (!results.length) {
        box.innerHTML = '<p class="vod-hub__empty">No hay coincidencias. Prueba otra fuente o pega la URL directa.</p>';
        return;
      }
      const downloadable = [];
      const reference = [];
      results.forEach((item, idx) => {
        (this.isVodDownloadable(item) ? downloadable : reference).push({ item, idx });
      });
      let html = '';
      if (downloadable.length) {
        html += `<div class="vod-hub__results-head">⬇ Listos para importar o descargar</div>`;
        html += downloadable.map(({ item, idx }) => this.renderVodHubCard(item, idx)).join('');
      }
      if (reference.length) {
        html += `<div class="vod-hub__results-head vod-hub__results-head--ref">ℹ Solo información (TMDB)</div>`;
        html += reference.map(({ item, idx }) => this.renderVodHubCard(item, idx)).join('');
      }
      box.innerHTML = html;
      this._vodSearchResults = results;
    } catch (e) {
      if (status) {
        status.textContent = `✕ ${e.message}`;
        status.className = 'vod-hub__status vod-hub__status--err';
      }
      toast(e.message, true);
    }
  },

  async importVodFromSearch(dataset, download, cardEl = null) {
    const { type, source, slug, url, title, year, index } = dataset;
    if (!slug && !url) {
      toast('Sin enlace — elige un resultado con URL o slug', true);
      return;
    }
    if (source === 'tmdb' && download) {
      toast('TMDB solo muestra información — elige un enlace de la web para descargar', true);
      return;
    }
    const idx = index !== undefined && index !== '' ? parseInt(index, 10) : -1;
    const item = (idx >= 0 && this._vodSearchResults?.[idx]) ? this._vodSearchResults[idx] : { title, slug, url, source };

    let quality = '1080';
    if (download) {
      const picked = await this.pickVodDownloadQuality(item);
      if (!picked) return;
      quality = picked;
    }

    const qualityLabel = this.vodQualityLabelFor(quality);
    const siteName = this.vodSiteDisplayName({ source, url, source_site: '' });
    const action = download ? 'descargar' : 'importar al catálogo';
    const label = title || slug || url;
    const extra = download ? `\nCalidad: ${qualityLabel}\nSitio: ${siteName}` : '';
    if (!confirm(`¿${action}?\n\n${label}${extra}`)) return;
    try {
      if (download && cardEl) {
        this.renderVodCardProgress(cardEl, { active: true, percent: 0, message: 'Preparando…' }, '…');
      }
      toast(download ? `Descargando (${qualityLabel})…` : 'Importando…');
      let importSource = source;
      if (source === 'tmdb') importSource = 'allcalidad';
      const r = await api('/admin/vod-import', {
        method: 'POST',
        body: JSON.stringify({
          type,
          source: importSource,
          slug: slug || undefined,
          url: url || undefined,
          title,
          year: year ? parseInt(year, 10) : undefined,
          quality,
          download: !!download,
          manual_download: !!download
        })
      });
      toast(r.message || (download ? 'Descarga iniciada' : 'Importado al catálogo'));
      if (download) {
        await this.loadVod();
        this.startVodPoll(2500);
        if (type === 'series') this.startSeriesPoll();
        const movieId = r.id;
        if (movieId && cardEl) {
          this._vodSearchDownloads[movieId] = { cardEl };
          const p = this.vodProgressFor({ id: movieId }) || { active: true, percent: 0, message: 'En cola…' };
          this.renderVodCardProgress(cardEl, p, movieId);
        } else if (movieId) {
          this.go('vod');
          setTimeout(() => {
            document.querySelector(`#xui-vod tr[data-movie-id="${movieId}"]`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 400);
        }
      } else if (this.section === 'vod') {
        await this.loadVod();
      }
    } catch (e) {
      toast(e.message, true);
    }
  },

  async runVodNightlyNow() {
    if (!confirm('¿Ejecutar ahora la búsqueda y descarga de estrenos (Cuevana + AllCalidad)?')) return;
    try {
      toast('Iniciando job VOD nocturno…');
      const r = await api('/admin/vod-nightly/run', {
        method: 'POST',
        body: JSON.stringify({ limit: parseInt($('#vod-nightly-limit')?.value, 10) || 2 })
      });
      if (r.skipped) toast(r.reason || 'Omitido');
      else {
        toast(`Cuevana: ${r.cuevana?.downloaded || 0} desc. · AllCalidad: ${r.allcalidad?.downloaded || 0} desc.`);
      }
      this.loadSettings();
      if (this.section === 'vod') this.loadVod();
    } catch (e) {
      toast(e.message, true);
    }
  },

  async resumeAllStuckVod() {
    if (!confirm('¿Iniciar la descarga de TODO el contenido pendiente?\n\nPelículas y capítulos se descargarán uno por uno en segundo plano (puede tardar horas).')) return;
    try {
      toast('Iniciando cola de descargas…');
      const r = await api('/admin/movies/download-all', { method: 'POST' });
      toast(r.message || `Cola: ${r.pending_count || 0} películas · ${r.series_pending_count || 0} capítulos`);
      this.startVodPoll();
      this.startSeriesPoll();
    } catch (e) {
      toast(e.message, true);
    }
  },

  async resumeVodDownload(id) {
    try {
      toast('Reanudando descarga…');
      await api(`/admin/movies/${id}/resume-download`, { method: 'POST' });
      toast('Descarga reanudada en segundo plano');
      this.startVodPoll();
    } catch (e) {
      toast(e.message, true);
    }
  },

  async refreshAllPosters() {
    if (!confirm('¿Actualizar carátulas de todas las películas y series con TMDB?')) return;
    try {
      toast('Buscando carátulas...');
      const r = await api('/admin/settings/refresh-all-posters', { method: 'POST' });
      toast(`${r.updated} carátulas actualizadas (${r.movies} películas, ${r.series} series)`);
    } catch (e) { toast(e.message, true); }
  },

  async refreshAllTrailers() {
    if (!confirm('¿Importar tráilers de YouTube (TMDB) para todas las películas y series que no tengan?')) return;
    try {
      toast('Importando tráilers… puede tardar un minuto');
      const r = await api('/admin/settings/refresh-trailers', { method: 'POST' });
      const errNote = r.errors?.length ? ` · ${r.errors.length} sin tráiler` : '';
      toast(`${r.updated} tráilers importados${errNote}`);
    } catch (e) { toast(e.message, true); }
  },

  openModal(title, fields, data = {}, onSave) {
    $('#xui-modal-title').textContent = title;
    $('#xui-modal-fields').innerHTML = fields.map(f => {
      if (f.type === 'checkbox') return `<label class="xui-check"><input type="checkbox" id="mf-${f.key}" ${data[f.key] ? 'checked' : ''}> ${f.label}</label>`;
      if (f.type === 'textarea') return `<div class="xui-field"><label>${f.label}</label><textarea id="mf-${f.key}">${data[f.key] || ''}</textarea></div>`;
      if (f.type === 'select') return `<div class="xui-field"><label>${f.label}</label><select id="mf-${f.key}">${f.options.map(o=>`<option value="${o.v}" ${data[f.key]===o.v?'selected':''}>${o.l}</option>`).join('')}</select></div>`;
      if (f.type === 'file') return `<div class="xui-field"><label>${f.label}</label><input type="file" id="mf-${f.key}" accept="${f.accept||''}"></div>`;
      return `<div class="xui-field"><label>${f.label}</label><input type="${f.type||'text'}" id="mf-${f.key}" value="${(data[f.key]||'').toString().replace(/"/g,'&quot;')}" placeholder="${f.placeholder||''}"></div>`;
    }).join('');
    this._modalSave = onSave;
    this.hideUploadProgress();
    $('#xui-modal').classList.remove('hidden');
  },

  closeModal() {
    if (this._modalCancelCallback) {
      const cb = this._modalCancelCallback;
      this._modalCancelCallback = null;
      cb();
    }
    $('#xui-modal').classList.add('hidden');
    this._modalSave = null;
    this.hideUploadProgress();
    this._saving = false;
  },

  showUploadProgress(label, pct = 0, processing = false) {
    const wrap = $('#xui-upload-progress');
    const bar = $('#xui-upload-progress-bar');
    const pctEl = $('#xui-upload-progress-pct');
    if (!wrap || !bar) return;
    wrap.classList.remove('hidden');
    wrap.classList.toggle('processing', processing);
    $('#xui-upload-progress-label').textContent = label;
    if (processing) {
      pctEl.textContent = '…';
      bar.style.width = '100%';
    } else if (pct < 0) {
      pctEl.textContent = '…';
      bar.style.width = '30%';
    } else {
      pctEl.textContent = `${pct}%`;
      bar.style.width = `${pct}%`;
    }
    $('#xui-modal-save').disabled = true;
    $('#xui-modal-cancel').disabled = true;
    $('#xui-modal-close').disabled = true;
  },

  hideUploadProgress() {
    $('#xui-upload-progress')?.classList.add('hidden');
    $('#xui-upload-progress')?.classList.remove('processing');
    const bar = $('#xui-upload-progress-bar');
    if (bar) bar.style.width = '0%';
    $('#xui-modal-save').disabled = false;
    $('#xui-modal-cancel').disabled = false;
    $('#xui-modal-close').disabled = false;
  },

  onUploadProgress(info) {
    if (info.phase === 'processing') {
      this.showUploadProgress('Procesando video en el servidor…', 100, true);
      return;
    }
    const label = info.total > 0
      ? `Subiendo archivo… ${formatUploadBytes(info.loaded)} / ${formatUploadBytes(info.total)}`
      : `Subiendo archivo… ${formatUploadBytes(info.loaded)}`;
    this.showUploadProgress(label, info.pct);
  },

  uploadFormData(path, method, formData) {
    this.showUploadProgress('Iniciando subida…', 0);
    return apiUpload(path, { method, body: formData }, (info) => this.onUploadProgress(info));
  },

  getModalValues(keys) {
    const v = {};
    keys.forEach(k => {
      const el = $(`#mf-${k}`);
      if (!el) return;
      v[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return v;
  },

  async saveModal() {
    if (!this._modalSave || this._saving) return;
    this._saving = true;
    try {
      await this._modalSave();
    } catch (e) {
      toast(e.message, true);
      this.hideUploadProgress();
    } finally {
      this._saving = false;
    }
  },

  openChannelModal(id) {
    this.openStreamEditor(id);
  },

  bindStreamEditor() {
    if (this._streamEditorBound) return;
    this._streamEditorBound = true;
    $('#xui-stream-close')?.addEventListener('click', () => this.closeStreamEditor());
    $('#xui-stream-save-top')?.addEventListener('click', () => this.saveStreamEditor());
    $('#xui-stream-preview-close')?.addEventListener('click', () => this.stopStreamPreview());
    $('#xui-stream-tabs')?.addEventListener('click', (e) => {
      const tab = e.target.closest('.xui-stream-tab');
      if (!tab) return;
      this.streamEditor.tab = tab.dataset.tab;
      $$('.xui-stream-tab').forEach((t) => t.classList.toggle('active', t === tab));
      void this.renderStreamTab();
    });
    $('#xui-stream-editor')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="add-source"]')) {
        e.preventDefault();
        this.streamEditor.config.sources.push({ url: '', user_agent: '', referer: '', scan_status: '', scan_info: '' });
        void this.renderStreamTab();
        return;
      }
      if (e.target.closest('[data-action="del-source"]')) {
        e.preventDefault();
        const i = parseInt(e.target.closest('[data-action="del-source"]').dataset.index, 10);
        this.streamEditor.config.sources.splice(i, 1);
        void this.renderStreamTab();
        return;
      }
      if (e.target.closest('[data-action="scan-sources"]')) {
        e.preventDefault();
        this.scanStreamSources();
        return;
      }
      if (e.target.closest('[data-action="rtmp-start"]')) {
        e.preventDefault();
        this.startStreamRtmp();
        return;
      }
      if (e.target.closest('[data-action="rtmp-stop"]')) {
        e.preventDefault();
        this.stopStreamRtmp();
        return;
      }
      if (e.target.closest('[data-action="prev-tab"]')) {
        e.preventDefault();
        this.streamTabNav(-1);
        return;
      }
      if (e.target.closest('[data-action="next-tab"]')) {
        e.preventDefault();
        this.streamTabNav(1);
        return;
      }
      if (e.target.closest('[data-action="save-stream"]')) {
        e.preventDefault();
        this.saveStreamEditor();
      }
    });
  },

  streamTabOrder: ['details', 'sources', 'advanced', 'map', 'epg', 'rtmp', 'servers'],

  streamTabNav(dir) {
    const tabs = this.streamTabOrder;
    const i = tabs.indexOf(this.streamEditor.tab);
    const next = tabs[Math.max(0, Math.min(tabs.length - 1, i + dir))];
    this.streamEditor.tab = next;
    $$('.xui-stream-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === next));
    void this.renderStreamTab();
  },

  defaultStreamConfig() {
    return {
      enabled: true,
      direct_source: false,
      notes: '',
      order: 0,
      sources: [{ url: '', user_agent: '', referer: '', scan_status: '', scan_info: '' }],
      advanced: {
        generate_pts: true,
        native_frames: false,
        stream_all_codecs: false,
        allow_recording: false,
        direct_stream: false,
        restart_on_fps_drop: false,
        fps_threshold: 90,
        custom_channel_sid: '',
        on_demand_probesize: 256000,
        minute_delay: 0,
        user_agent: 'Mozilla/5.0',
        referer: '',
        http_proxy: '',
        custom_headers: '',
        ffmpeg_options: '',
        timeout: 30
      },
      map: { output_format: 'auto', container: 'mpegts', custom_map: '' },
      epg: { epg_id: '', channel_id: '', lang: 'es', xmltv_url: '' },
      rtmp: { enabled: false, push_url: 'rtmp://127.0.0.1/live', stream_key: '', auto_start: false },
      servers: { server_id: 'local', on_demand: true, transcode_profile: 'copy' }
    };
  },

  async openStreamEditor(id, tab) {
    this.bindStreamEditor();
    let channel = { name: '', logo: '', group_title: '', enabled: 1 };
    let config = this.defaultStreamConfig();
    let rtmp_status = { running: false };

    if (id) {
      const data = await api(`/live/channels/${id}`);
      channel = data;
      config = { ...this.defaultStreamConfig(), ...data.config };
      const upstream = data.primary_url || data.upstream_url || '';
      if (!config.sources?.length) {
        config.sources = [{ url: upstream || data.stream_url || '', user_agent: '', referer: '', scan_status: '', scan_info: '' }];
      }
      if (channel.cache_enabled && config.advanced.allow_recording !== true) {
        config.advanced.allow_recording = true;
      }
      rtmp_status = data.rtmp_status || rtmp_status;
    }

    const activeTab = tab || (id ? 'sources' : 'details');
    this.streamEditor = { id: id || null, tab: activeTab, config, channel, rtmp_status };
    $('#xui-stream-title').textContent = channel.name || 'Nuevo stream';
    $$('.xui-stream-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === activeTab));
    $('#xui-stream-editor').classList.remove('hidden');
    await this.renderStreamTab();
  },

  closeStreamEditor() {
    this.stopStreamPreview();
    $('#xui-stream-editor').classList.add('hidden');
    this.streamEditor = { id: null, tab: 'sources', config: null, channel: {}, rtmp_status: {} };
  },

  previewAuthToken() {
    return localStorage.getItem('vixtv_token') || localStorage.getItem('xupertv_token') || '';
  },

  previewStreamProxy(url, opts = {}) {
    const t = this.previewAuthToken();
    let q = `/api/live/stream?url=${encodeURIComponent(url)}&token=${encodeURIComponent(t)}`;
    const ua = opts.user_agent || opts.userAgent || '';
    const referer = opts.referer || '';
    if (ua) q += `&ua=${encodeURIComponent(ua)}`;
    if (referer) q += `&referer=${encodeURIComponent(referer)}`;
    return q;
  },

  stopStreamPreview() {
    if (this._previewHls) {
      this._previewHls.destroy();
      this._previewHls = null;
    }
    const video = $('#xui-stream-preview-video');
    if (video) {
      video.onerror = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    $('#xui-stream-preview')?.classList.add('hidden');
  },

  playStreamPreview(sourceUrl, title, meta, opts = {}) {
    if (!sourceUrl) return;
    this.stopStreamPreview();

    const box = $('#xui-stream-preview');
    const video = $('#xui-stream-preview-video');
    if (!box || !video) return;

    box.classList.remove('hidden');
    $('#xui-stream-preview-title').textContent = title || 'Preview';
    $('#xui-stream-preview-meta').textContent = meta ? meta : 'Cargando señal…';

    const adv = this.streamEditor?.config?.advanced || {};
    const srcOpts = {
      user_agent: opts.user_agent || adv.user_agent || '',
      referer: opts.referer || adv.referer || 'https://tv.vixred.com/'
    };
    const src = this.previewStreamProxy(sourceUrl, srcOpts);
    const isHls = /\.m3u8/i.test(sourceUrl) || /\/hls\//i.test(sourceUrl) || /\.isml\//i.test(sourceUrl);
    const authToken = this.previewAuthToken();

    video.muted = true;

    const onPlay = () => {
      const info = $('#xui-stream-preview-meta');
      if (info && info.textContent === 'Cargando señal…') info.textContent = meta || 'Reproduciendo';
    };

    const onFail = (msg) => {
      $('#xui-stream-preview-meta').textContent = msg || 'No se pudo reproducir';
    };

    if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
      this._previewHls = new Hls({
        maxBufferLength: 20,
        enableWorker: true,
        xhrSetup: (xhr, reqUrl) => {
          if (reqUrl.includes('/api/live/stream') && authToken) {
            xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
          }
        }
      });
      this._previewHls.loadSource(src);
      this._previewHls.attachMedia(video);
      this._previewHls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().then(onPlay).catch(() => onFail('Pulsa play en el preview'));
      });
      this._previewHls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) onFail('Error HLS al cargar preview');
      });
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.load();
      video.play().then(onPlay).catch(() => onFail('Pulsa play en el preview'));
    } else {
      video.src = src;
      video.load();
      video.play().then(onPlay).catch(() => onFail('Pulsa play en el preview'));
    }

    video.onerror = () => onFail('Error al reproducir preview');
  },

  escAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  },

  async renderStreamTab() {
    const { tab, config, channel, rtmp_status } = this.streamEditor;
    const body = $('#xui-stream-body');
    const footer = $('#xui-stream-footer');
    if (!body || !config) return;

    const field = (label, id, value, type = 'text', opts = {}) => {
      if (type === 'checkbox') {
        return `<label class="xui-check"><input type="checkbox" id="${id}" ${value ? 'checked' : ''}> ${label}</label>`;
      }
      if (type === 'textarea') {
        return `<div class="xui-field"><label>${label}</label><textarea id="${id}" rows="${opts.rows || 3}">${this.escAttr(value)}</textarea></div>`;
      }
      if (type === 'select') {
        return `<div class="xui-field"><label>${label}</label><select id="${id}">${opts.options.map((o) =>
          `<option value="${this.escAttr(o.v)}" ${value === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select></div>`;
      }
      return `<div class="xui-field"><label>${label}</label><input type="${type}" id="${id}" value="${this.escAttr(value)}" placeholder="${opts.placeholder || ''}"></div>`;
    };

    const adv = config.advanced || {};
    const advToggle = (id, label, on, tip = '') => `
      <div class="xui-adv-toggle-row">
        <label class="xui-switch" title="${this.escAttr(tip)}">
          <input type="checkbox" id="${id}" ${on ? 'checked' : ''}>
          <span class="xui-switch-slider"></span>
        </label>
        <span class="xui-adv-toggle-label">${label}</span>
        ${tip ? `<span class="xui-adv-info" title="${this.escAttr(tip)}">ⓘ</span>` : '<span class="xui-adv-info">ⓘ</span>'}
      </div>`;

    if (tab === 'details') {
      const groupOptions = await this.liveStreamCategoryOptions(channel.group_title);
      body.innerHTML = `<div class="xui-form-grid-2">
        ${field('Nombre del stream', 'se-name', channel.name)}
        ${field('Categoría / Bouquet', 'se-group', channel.group_title, 'select', { options: groupOptions })}
        ${field('URL del logo', 'se-logo', channel.logo)}
        ${field('Orden', 'se-order', config.order, 'number')}
        ${field('Habilitado', 'se-enabled', channel.enabled !== 0, 'checkbox')}
      </div>
      ${field('Notas', 'se-notes', config.notes, 'textarea', { rows: 4 })}`;
    } else if (tab === 'sources') {
      const rows = (config.sources || []).map((s, i) => `
        <tr>
          <td style="width:28px;color:#6c7293">${i + 1}</td>
          <td><input type="text" class="se-source-url" data-index="${i}" value="${this.escAttr(s.url)}" placeholder="https://.../playlist.m3u8"></td>
          <td style="width:140px"><span class="xui-source-scan ${s.scan_status === 'ok' ? 'ok' : s.scan_status === 'error' ? 'err' : s.scan_status === 'scanning' ? 'scanning' : ''}">${this.escAttr(s.scan_info || 'Not scanned')}</span></td>
          <td style="width:40px"><button type="button" class="xui-btn-row-del" data-action="del-source" data-index="${i}" title="Eliminar">✕</button></td>
        </tr>`).join('');
      body.innerHTML = `
        <table class="xui-sources-table">
          <thead><tr><th></th><th>URL</th><th>STREAM INFO</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="color:#6c7293;padding:12px">Sin fuentes — añade una fila</td></tr>'}</tbody>
        </table>`;
      footer.innerHTML = `
        <button type="button" class="xui-btn xui-btn-ghost" data-action="prev-tab">← Previous</button>
        <button type="button" class="xui-btn xui-btn-primary" data-action="add-source">Add Row</button>
        <button type="button" class="xui-btn" style="background:#e91e8c;color:#fff" disabled title="Próximamente">Providers</button>
        <button type="button" class="xui-btn" style="background:#17a2b8;color:#fff" data-action="scan-sources">Scan Sources</button>
        <button type="button" class="xui-btn xui-btn-ghost" data-action="next-tab">Next →</button>`;
      return;
    } else if (tab === 'advanced') {
      body.innerHTML = `<div class="xui-advanced-panel">
        <div class="xui-adv-toggles-grid">
          <div class="xui-adv-toggles-col">
            ${advToggle('se-gen-pts', 'Generate PTS', adv.generate_pts !== false, 'Generar timestamps PTS en el stream')}
            ${advToggle('se-native-frames', 'Native Frames', !!adv.native_frames, 'Usar frames nativos sin remux')}
            ${advToggle('se-all-codecs', 'Stream All Codecs', !!adv.stream_all_codecs, 'Transmitir todos los codecs del origen')}
            ${advToggle('se-allow-rec', 'Allow Recording', adv.allow_recording === true, 'Restream en tu servidor: el canal se descarga con FFmpeg y los clientes ven la señal local (/cache/live/…) para evitar cortes y congelamientos')}
          </div>
          <div class="xui-adv-toggles-col">
            ${advToggle('se-adv-direct', 'Direct Source', !!config.direct_source, 'Reproducir directamente desde la fuente')}
            ${advToggle('se-direct-stream', 'Direct Stream', !!adv.direct_stream, 'Stream directo sin transcodificar en el servidor')}
            ${advToggle('se-fps-restart', 'Restart on FPS Drop', !!adv.restart_on_fps_drop, 'Reiniciar si cae el FPS')}
          </div>
        </div>
        <div class="xui-adv-fields">
          <div class="xui-adv-field-row xui-adv-field-inline">
            <label for="se-fps-threshold">FPS Threshold % <span class="xui-adv-info">ⓘ</span></label>
            <input type="number" id="se-fps-threshold" class="xui-adv-input-sm" value="${adv.fps_threshold ?? 90}" min="1" max="100">
          </div>
          <div class="xui-adv-field-row">
            <label for="se-channel-sid">Custom Channel SID <span class="xui-adv-info">ⓘ</span></label>
            <input type="text" id="se-channel-sid" class="xui-adv-input" value="${this.escAttr(adv.custom_channel_sid || '')}" placeholder="">
          </div>
          <div class="xui-form-grid-2 xui-adv-field-pair">
            <div class="xui-adv-field-row">
              <label for="se-probesize">On Demand Probesize <span class="xui-adv-info">ⓘ</span></label>
              <input type="number" id="se-probesize" class="xui-adv-input" value="${adv.on_demand_probesize ?? 256000}">
            </div>
            <div class="xui-adv-field-row">
              <label for="se-minute-delay">Minute Delay <span class="xui-adv-info">ⓘ</span></label>
              <input type="number" id="se-minute-delay" class="xui-adv-input" value="${adv.minute_delay ?? 0}" min="0">
            </div>
          </div>
          <div class="xui-adv-field-row">
            <label for="se-ua">User Agent <span class="xui-adv-info">ⓘ</span></label>
            <input type="text" id="se-ua" class="xui-adv-input" value="${this.escAttr(adv.user_agent || 'Mozilla/5.0')}">
          </div>
          <div class="xui-adv-field-row">
            <label for="se-proxy">HTTP Proxy <span class="xui-adv-info">ⓘ</span></label>
            <input type="text" id="se-proxy" class="xui-adv-input" value="${this.escAttr(adv.http_proxy || '')}" placeholder="">
          </div>
          <details class="xui-adv-more">
            <summary>Opciones extra (Referer, headers, FFmpeg)</summary>
            <div class="xui-adv-field-row">
              <label for="se-referer">Referer</label>
              <input type="text" id="se-referer" class="xui-adv-input" value="${this.escAttr(adv.referer || '')}">
            </div>
            <div class="xui-adv-field-row">
              <label for="se-headers">Headers personalizados</label>
              <textarea id="se-headers" class="xui-adv-input" rows="2">${this.escAttr(adv.custom_headers || '')}</textarea>
            </div>
            <div class="xui-adv-field-row">
              <label for="se-ffmpeg">Opciones FFmpeg</label>
              <textarea id="se-ffmpeg" class="xui-adv-input" rows="2">${this.escAttr(adv.ffmpeg_options || '')}</textarea>
            </div>
            <div class="xui-adv-field-row xui-adv-field-inline">
              <label for="se-timeout">Timeout escaneo (seg)</label>
              <input type="number" id="se-timeout" class="xui-adv-input-sm" value="${adv.timeout ?? 30}">
            </div>
          </details>
        </div>
      </div>`;
    } else if (tab === 'map') {
      body.innerHTML = `<div class="xui-form-grid-2">
        ${field('Formato de salida', 'se-map-format', config.map.output_format, 'select', { options: [
          { v: 'auto', l: 'Auto' }, { v: 'hls', l: 'HLS' }, { v: 'mpegts', l: 'MPEG-TS' }, { v: 'rtmp', l: 'RTMP' }
        ]})}
        ${field('Contenedor', 'se-map-container', config.map.container, 'select', { options: [
          { v: 'mpegts', l: 'MPEG-TS' }, { v: 'mp4', l: 'MP4' }, { v: 'flv', l: 'FLV' }
        ]})}
      </div>
      ${field('Custom map / alias', 'se-map-custom', config.map.custom_map, 'textarea')}`;
    } else if (tab === 'epg') {
      body.innerHTML = `<div class="xui-form-grid-2">
        ${field('EPG ID (tvg-id)', 'se-epg-id', config.epg.epg_id)}
        ${field('Canal EPG', 'se-epg-ch', config.epg.channel_id)}
        ${field('Idioma EPG', 'se-epg-lang', config.epg.lang)}
        ${field('URL XMLTV', 'se-epg-xml', config.epg.xmltv_url)}
      </div>
      <p style="color:#6c7293;font-size:.85rem;margin-top:12px">Los datos EPG se usan para guía de programación y coincidencia con listas M3U.</p>`;
    } else if (tab === 'rtmp') {
      const running = rtmp_status?.running;
      body.innerHTML = `
        <div class="xui-rtmp-status ${running ? 'running' : 'stopped'}">
          ${running
            ? `● RTMP Push activo — PID ${rtmp_status.pid || '?'} → ${this.escAttr(rtmp_status.target)}`
            : '○ RTMP Push detenido'}
        </div>
        ${field('Habilitar RTMP Push', 'se-rtmp-enabled', config.rtmp.enabled, 'checkbox')}
        <div class="xui-form-grid-2">
          ${field('URL RTMP servidor', 'se-rtmp-url', config.rtmp.push_url, 'text', { placeholder: 'rtmp://servidor/live' })}
          ${field('Stream key', 'se-rtmp-key', config.rtmp.stream_key)}
        </div>
        ${field('Iniciar push al guardar', 'se-rtmp-auto', config.rtmp.auto_start, 'checkbox')}
        <p style="color:#6c7293;font-size:.85rem">La salida envía la primera fuente activa a tu servidor RTMP (nginx-rtmp, OBS, etc.) mediante FFmpeg.</p>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button type="button" class="xui-btn xui-btn-success" data-action="rtmp-start" ${running ? 'disabled' : ''}>▶ Iniciar Push</button>
          <button type="button" class="xui-btn xui-btn-danger" data-action="rtmp-stop" ${!running ? 'disabled' : ''}>■ Detener Push</button>
        </div>`;
    } else if (tab === 'servers') {
      body.innerHTML = `<div class="xui-form-grid-2">
        ${field('Servidor', 'se-server', config.servers.server_id, 'select', { options: [
          { v: 'local', l: 'Servidor local (Vix TV)' }
        ]})}
        ${field('Perfil transcodificación', 'se-transcode', config.servers.transcode_profile, 'select', { options: [
          { v: 'copy', l: 'Copy (sin transcodificar)' }, { v: 'transcode', l: 'Transcode H.264/AAC' }
        ]})}
      </div>
      ${field('On demand', 'se-ondemand', config.servers.on_demand, 'checkbox')}
      <p style="color:#6c7293;font-size:.85rem;margin-top:12px">Activa <strong>Allow Recording</strong> en Advanced para que Vix TV retransmita el canal desde tu servidor hacia los clientes.</p>`;
    }

    footer.innerHTML = footer.innerHTML || `
      <button type="button" class="xui-btn xui-btn-ghost" data-action="prev-tab">← Previous</button>
      <button type="button" class="xui-btn xui-btn-primary" data-action="save-stream">💾 Guardar</button>
      <button type="button" class="xui-btn xui-btn-ghost" data-action="next-tab">Next →</button>`;
  },

  collectStreamEditorData() {
    const { config, channel } = this.streamEditor;
    const g = (id) => $(`#${id}`);

    channel.name = g('se-name')?.value?.trim() ?? channel.name;
    channel.group_title = g('se-group')?.value?.trim() ?? channel.group_title;
    channel.logo = g('se-logo')?.value?.trim() ?? channel.logo;
    channel.enabled = g('se-enabled') ? (g('se-enabled').checked ? 1 : 0) : channel.enabled;

    if (g('se-order')) config.order = parseInt(g('se-order').value, 10) || 0;
    if (g('se-notes')) config.notes = g('se-notes').value;

    if (g('se-gen-pts')) config.advanced.generate_pts = g('se-gen-pts').checked;
    if (g('se-native-frames')) config.advanced.native_frames = g('se-native-frames').checked;
    if (g('se-all-codecs')) config.advanced.stream_all_codecs = g('se-all-codecs').checked;
    if (g('se-allow-rec')) config.advanced.allow_recording = g('se-allow-rec').checked;
    if (g('se-adv-direct')) config.direct_source = g('se-adv-direct').checked;
    if (g('se-direct-stream')) config.advanced.direct_stream = g('se-direct-stream').checked;
    if (g('se-fps-restart')) config.advanced.restart_on_fps_drop = g('se-fps-restart').checked;
    if (g('se-fps-threshold')) config.advanced.fps_threshold = parseInt(g('se-fps-threshold').value, 10) || 90;
    if (g('se-channel-sid')) config.advanced.custom_channel_sid = g('se-channel-sid').value.trim();
    if (g('se-probesize')) config.advanced.on_demand_probesize = parseInt(g('se-probesize').value, 10) || 256000;
    if (g('se-minute-delay')) config.advanced.minute_delay = parseInt(g('se-minute-delay').value, 10) || 0;
    if (g('se-ua')) config.advanced.user_agent = g('se-ua').value.trim() || 'Mozilla/5.0';
    if (g('se-proxy')) config.advanced.http_proxy = g('se-proxy').value.trim();
    if (g('se-referer')) config.advanced.referer = g('se-referer').value.trim();
    if (g('se-timeout')) config.advanced.timeout = parseInt(g('se-timeout').value, 10) || 30;
    if (g('se-headers')) config.advanced.custom_headers = g('se-headers').value;
    if (g('se-ffmpeg')) config.advanced.ffmpeg_options = g('se-ffmpeg').value;

    $$('.se-source-url').forEach((inp) => {
      const i = parseInt(inp.dataset.index, 10);
      if (!config.sources[i]) config.sources[i] = {};
      config.sources[i].url = inp.value.trim();
    });
    config.sources = (config.sources || []).filter((s) => s.url);

    if (g('se-map-format')) config.map.output_format = g('se-map-format').value;
    if (g('se-map-container')) config.map.container = g('se-map-container').value;
    if (g('se-map-custom')) config.map.custom_map = g('se-map-custom').value;

    if (g('se-epg-id')) config.epg.epg_id = g('se-epg-id').value;
    if (g('se-epg-ch')) config.epg.channel_id = g('se-epg-ch').value;
    if (g('se-epg-lang')) config.epg.lang = g('se-epg-lang').value;
    if (g('se-epg-xml')) config.epg.xmltv_url = g('se-epg-xml').value;

    if (g('se-rtmp-enabled')) config.rtmp.enabled = g('se-rtmp-enabled').checked;
    if (g('se-rtmp-url')) config.rtmp.push_url = g('se-rtmp-url').value.trim();
    if (g('se-rtmp-key')) config.rtmp.stream_key = g('se-rtmp-key').value.trim();
    if (g('se-rtmp-auto')) config.rtmp.auto_start = g('se-rtmp-auto').checked;

    if (g('se-server')) config.servers.server_id = g('se-server').value;
    if (g('se-transcode')) config.servers.transcode_profile = g('se-transcode').value;
    if (g('se-ondemand')) config.servers.on_demand = g('se-ondemand').checked;

    return { channel, config };
  },

  async saveStreamEditor() {
    const { channel, config } = this.collectStreamEditorData();
    let { id } = this.streamEditor;
    if (!channel.name) return toast('Nombre del stream requerido', true);
    if (!channel.group_title) return toast('Selecciona una categoría / bouquet', true);
    if (!config.sources.length) return toast('Añade al menos una URL de fuente', true);

    try {
      if (id) {
        await api(`/live/channels/${id}/config`, {
          method: 'PUT',
          body: JSON.stringify({
            name: channel.name,
            logo: channel.logo,
            group_title: channel.group_title,
            enabled: channel.enabled,
            stream_url: config.sources[0].url,
            config
          })
        });
        toast('Stream guardado');
      } else {
        const r = await api('/live/channels', {
          method: 'POST',
          body: JSON.stringify({
            name: channel.name,
            logo: channel.logo,
            group_title: channel.group_title,
            stream_url: config.sources[0].url,
            enabled: channel.enabled !== 0 ? 1 : 0,
            config
          })
        });
        id = r.id;
        this.streamEditor.id = id;
        toast('Stream creado');
      }
      $('#xui-stream-title').textContent = channel.name;
      await this.refresh();
      this.closeStreamEditor();
    } catch (e) {
      toast(e.message, true);
    }
  },

  async scanStreamSources() {
    this.collectStreamEditorData();
    const { id, config } = this.streamEditor;
    if (!config.sources.length) return toast('No hay URLs para escanear', true);
    const urls = config.sources.filter((s) => s.url);
    if (!urls.length) return toast('Introduce al menos una URL', true);

    config.sources.forEach((s) => {
      if (s.url) {
        s.scan_status = 'scanning';
        s.scan_info = 'Escaneando…';
      }
    });
    void this.renderStreamTab();

    try {
      const r = await api(id ? `/live/channels/${id}/sources/scan` : '/live/sources/scan', {
        method: 'POST',
        body: JSON.stringify({ sources: config.sources.filter((s) => s.url), advanced: config.advanced })
      });
      let idx = 0;
      config.sources.forEach((s) => {
        if (!s.url) return;
        const res = r.results?.[idx++];
        if (res) {
          s.scan_status = res.scan_status;
          s.scan_info = res.scan_info;
        }
      });
      toast('Escaneo completado');
      void this.renderStreamTab();

      const previewSource = config.sources.find((s) => s.url && s.scan_status === 'ok')
        || config.sources.find((s) => s.url);
      if (previewSource?.url) {
        this.playStreamPreview(
          previewSource.url,
          this.streamEditor.channel?.name || 'Preview',
          previewSource.scan_info || '',
          { user_agent: previewSource.user_agent, referer: previewSource.referer || config.advanced?.referer }
        );
      }
    } catch (e) {
      toast(e.message, true);
      config.sources.forEach((s) => {
        if (s.scan_status === 'scanning') {
          s.scan_status = '';
          s.scan_info = 'Not scanned';
        }
      });
      void this.renderStreamTab();
    }
  },

  async startStreamRtmp() {
    this.collectStreamEditorData();
    const { id, config } = this.streamEditor;
    if (!id) return toast('Guarda el stream antes de iniciar RTMP', true);
    try {
      const r = await api(`/live/channels/${id}/rtmp/start`, {
        method: 'POST',
        body: JSON.stringify({ config })
      });
      this.streamEditor.rtmp_status = r.status || { running: true };
      toast('RTMP Push iniciado');
      void this.renderStreamTab();
    } catch (e) {
      toast(e.message, true);
    }
  },

  async stopStreamRtmp() {
    const { id } = this.streamEditor;
    if (!id) return;
    try {
      const r = await api(`/live/channels/${id}/rtmp/stop`, { method: 'POST' });
      this.streamEditor.rtmp_status = r.status || { running: false };
      toast('RTMP Push detenido');
      void this.renderStreamTab();
    } catch (e) {
      toast(e.message, true);
    }
  },

  openVodModal(id) {
    const load = async () => {
      let data = {};
      if (id) {
        const m = await api(`/movies/${id}`);
        data = { ...m, video_url: m.video_path, poster_url: m.poster };
      }
      const fields = [
        { key: 'title', label: 'Título' },
        { key: 'genre', label: 'Categoría', type: 'select', options: await this.categoryOptions('movie', data.genre) },
        { key: 'year', label: 'Año', type: 'number' },
        { key: 'description', label: 'Descripción', type: 'textarea' },
        { key: 'video_url', label: 'URL del video (mp4/m3u8)' },
        { key: 'poster_url', label: 'URL carátula' },
        { key: 'video', label: 'O subir archivo video', type: 'file', accept: 'video/*' },
        { key: 'poster', label: 'O subir carátula', type: 'file', accept: 'image/*' }
      ];
      this.openModal(id ? 'Editar película VOD' : 'Nueva película VOD', fields, data, async () => {
        const v = this.getModalValues(['title','genre','year','description','video_url','poster_url']);
        if (!v.genre) return toast('Selecciona una categoría', true);
        const fd = new FormData();
        Object.entries(v).forEach(([k,val]) => { if (k !== 'video' && k !== 'poster') fd.append(k, val); });
        const vid = $(`#mf-video`)?.files[0]; if (vid) fd.append('video', vid);
        const post = $(`#mf-poster`)?.files[0]; if (post) fd.append('poster', post);
        let saved;
        try {
          if (vid || post) {
            saved = await this.uploadFormData(
              id ? `/movies/${id}` : '/movies',
              id ? 'PUT' : 'POST',
              fd
            );
          } else if (id) saved = await api(`/movies/${id}`, { method: 'PUT', body: fd });
          else saved = await api('/movies', { method: 'POST', body: fd });
        } finally {
          this.hideUploadProgress();
        }
        if (vid && saved?.processing) toast('Video subido. Optimizando en segundo plano…');
        else if (vid) toast('Video optimizado — reproducción instantánea');
        else toast('Película guardada');
        this.closeModal(); this.refresh();
      });
    };
    load();
  },

  openSeriesModal(id) {
    const load = async () => {
      let data = {};
      if (id) { const s = await api(`/series/${id}`); data = { ...s, poster_url: s.poster }; }
      const fields = [
        { key: 'title', label: 'Título' },
        { key: 'genre', label: 'Categoría', type: 'select', options: await this.categoryOptions('series', data.genre) },
        { key: 'allcalidad_slug', label: 'Slug AllCalidad', placeholder: 'ej: from-2022' },
        { key: 'description', label: 'Descripción', type: 'textarea' },
        { key: 'poster_url', label: 'URL carátula' },
        { key: 'series_poster', label: 'O subir carátula', type: 'file', accept: 'image/*' }
      ];
      this.openModal(id ? 'Editar serie' : 'Nueva serie', fields, data, async () => {
        const v = this.getModalValues(['title','genre','allcalidad_slug','description','poster_url']);
        if (!v.genre) return toast('Selecciona una categoría', true);
        const fd = new FormData();
        fd.append('title', v.title); fd.append('genre', v.genre); fd.append('description', v.description);
        fd.append('allcalidad_slug', v.allcalidad_slug || '');
        fd.append('poster_url', v.poster_url);
        const post = $(`#mf-series_poster`)?.files[0]; if (post) fd.append('series_poster', post);
        if (id) await api(`/series/${id}`, { method: 'PUT', body: fd });
        else await api('/series', { method: 'POST', body: fd });
        toast('Serie guardada');
        this.closeModal();
        await this.refreshSeriesKeepOpen();
      });
    };
    load();
  },

  openEpisodeModal(seriesId, epId, defaultSeason) {
    const fields = [
      { key: 'season', label: 'Temporada', type: 'number' },
      { key: 'episode', label: 'Capítulo', type: 'number' },
      { key: 'title', label: 'Título del capítulo' },
      { key: 'description', label: 'Descripción', type: 'textarea' },
      { key: 'video_url', label: 'URL del video' },
      { key: 'poster_url', label: 'URL miniatura' },
      { key: 'video', label: 'O subir video', type: 'file', accept: 'video/*' }
    ];
    const load = async () => {
      let data = { season: defaultSeason || 1, episode: 1 };
      if (epId) {
        const s = await api(`/series/${seriesId}`);
        this.seriesCache[seriesId] = s;
        const ep = s.episodes.find((e) => e.id === epId || e.id === parseInt(epId, 10));
        if (ep) data = { ...ep, video_url: ep.video_path, poster_url: ep.poster };
      } else if (defaultSeason) {
        data.season = defaultSeason;
        const cached = this.seriesCache[seriesId];
        if (cached?.episodes) {
          data.episode = this.nextEpisodeNumber(cached.episodes, defaultSeason);
        } else {
          const s = await api(`/series/${seriesId}`);
          this.seriesCache[seriesId] = s;
          data.episode = this.nextEpisodeNumber(s.episodes, defaultSeason);
        }
      }
      this.openModal(epId ? 'Editar capítulo' : `Nuevo capítulo · T${data.season}`, fields, data, async () => {
        const v = this.getModalValues(['season','episode','title','description','video_url','poster_url']);
        const fd = new FormData();
        Object.entries(v).forEach(([k, val]) => fd.append(k, val));
        const vid = $(`#mf-video`)?.files[0]; if (vid) fd.append('video', vid);
        let saved;
        try {
          if (vid) {
            saved = await this.uploadFormData(
              epId ? `/series/${seriesId}/episodes/${epId}` : `/series/${seriesId}/episodes`,
              epId ? 'PUT' : 'POST',
              fd
            );
          } else if (epId) saved = await api(`/series/${seriesId}/episodes/${epId}`, { method: 'PUT', body: fd });
          else saved = await api(`/series/${seriesId}/episodes`, { method: 'POST', body: fd });
        } finally {
          this.hideUploadProgress();
        }
        if (vid && saved?.processing) toast('Video subido. Optimizando en segundo plano…');
        else if (vid) toast('Video optimizado — reproducción instantánea');
        else toast('Capítulo guardado');
        this.seriesExpanded.add(seriesId);
        delete this.seriesCache[seriesId];
        this.closeModal();
        await this.refreshSeriesKeepOpen();
      });
    };
    load();
  },

  async importM3u() {
    const name = $('#xui-m3u-name').value.trim();
    const url = $('#xui-m3u-url').value.trim();
    if (!name || !url) return toast('Nombre y URL requeridos', true);
    try {
      const r = await api('/live/playlists', { method: 'POST', body: JSON.stringify({ name, m3u_url: url }) });
      toast(`Importado: ${r.live||r.channels||0} en vivo, ${r.movies||0} películas, ${r.series||0} series (${r.episodes||0} eps)`);
      $('#xui-m3u-name').value = ''; $('#xui-m3u-url').value = '';
      this.refresh();
    } catch (e) { toast(e.message, true); }
  },

  async createUser() {
    const username = $('#xui-new-user').value.trim();
    const password = $('#xui-new-pass').value;
    const role = $('#xui-new-role').value;
    const expiry = $('#xui-new-expiry')?.value || 'never';
    if (!username || !password) return toast('Usuario y contraseña requeridos', true);
    try {
      await api('/auth/users', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          role,
          expiry,
          can_live: $('#xui-new-live')?.checked !== false,
          can_movies: $('#xui-new-movies')?.checked !== false,
          can_series: $('#xui-new-series')?.checked !== false
        })
      });
      toast(`Usuario "${username}" creado. Comparte la contraseña que definiste al crear la línea.`);
      $('#xui-new-user').value = '';
      $('#xui-new-pass').value = '';
      this.refresh();
    } catch (e) { toast(e.message, true); }
  },

  async deleteChannel(id, name = '') {
    const label = name ? `"${name}"` : `ID ${id}`;
    if (!confirm(`¿Eliminar el canal ${label}?\n\nSe borrará de la base de datos y ya no aparecerá en En Vivo.`)) return;
    this.closeStreamMenus();
    try {
      await api(`/live/channels/${id}`, { method: 'DELETE' });
      if (this._streamsCache) {
        this._streamsCache = this._streamsCache.filter((c) => c.id !== id);
      }
      toast('Canal eliminado');
      if (this.section === 'streams') this.renderStreamsTable(this._streamsCache || []);
      else this.refresh();
    } catch (e) {
      toast(e.message || 'No se pudo eliminar', true);
    }
  },
  async deleteVod(id) { if (!confirm('¿Eliminar película?')) return; await api(`/movies/${id}`, { method: 'DELETE' }); toast('Eliminado'); this.refresh(); },
  async deleteSeries(id) {
    if (!confirm('¿Eliminar serie y episodios?')) return;
    await api(`/series/${id}`, { method: 'DELETE' });
    this.seriesExpanded.delete(id);
    delete this.seriesCache[id];
    toast('Eliminado');
    this.refresh();
  },
  async deleteEpisode(sid, eid) {
    if (!confirm('¿Eliminar capítulo?')) return;
    await api(`/series/${sid}/episodes/${eid}`, { method: 'DELETE' });
    delete this.seriesCache[sid];
    toast('Eliminado');
    this.seriesExpanded.add(sid);
    await this.refreshSeriesKeepOpen();
  },
  async deletePlaylist(id) { if (!confirm('¿Eliminar lista y canales?')) return; await api(`/live/playlists/${id}`, { method: 'DELETE' }); toast('Eliminado'); this.refresh(); },
  async refreshPlaylist(id) {
    try {
      const r = await api(`/live/playlists/${id}/refresh`, { method: 'POST' });
      toast(`${r.live || 0} live · ${r.movies || 0} películas · ${r.series || 0} series`);
      this.refresh();
    } catch (e) { toast(e.message, true); }
  },
  async changeOwnPassword() {
    const current = $('#xui-admin-cur-pass')?.value || '';
    const next = $('#xui-admin-new-pass')?.value || '';
    const next2 = $('#xui-admin-new-pass2')?.value || '';
    if (!current || !next) return toast('Completa todos los campos', true);
    if (next !== next2) return toast('Las contraseñas nuevas no coinciden', true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next })
      });
      toast('Contraseña actualizada');
      $('#xui-admin-cur-pass').value = '';
      $('#xui-admin-new-pass').value = '';
      $('#xui-admin-new-pass2').value = '';
    } catch (e) { toast(e.message, true); }
  },

  async resetUserPassword(id, username = '') {
    const label = username ? `"${username}"` : `ID ${id}`;
    const password = prompt(`Nueva contraseña para ${label}:`);
    if (!password) return;
    if (password.length < 4) return toast('Mínimo 4 caracteres', true);
    try {
      await api(`/auth/users/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      toast(`Contraseña restablecida para ${username || 'usuario'}`);
    } catch (e) { toast(e.message, true); }
  },

  async deleteUser(id) { if (!confirm('¿Eliminar usuario?')) return; await api(`/auth/users/${id}`, { method: 'DELETE' }); toast('Eliminado'); this.refresh(); },
  async toggleUser(id, active) { await api(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }); this.refresh(); },

  openCategoryModal(id, name = '') {
    const fields = [{ key: 'name', label: 'Nombre de la categoría' }];
    this.openModal(id ? 'Editar categoría' : 'Nueva categoría', fields, { name }, async () => {
      const v = this.getModalValues(['name']);
      if (!v.name?.trim()) return toast('Nombre requerido', true);
      try {
        if (id) {
          await api(`/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name: v.name.trim() }) });
        } else {
          await api('/categories', { method: 'POST', body: JSON.stringify({ name: v.name.trim(), type: this.catType }) });
        }
        toast('Categoría guardada');
        this.closeModal();
        this.refresh();
      } catch (e) { toast(e.message, true); }
    });
  },

  async deleteCategory(id, name, count) {
    if (count > 0) return toast(`No se puede eliminar: ${count} elemento(s) usan "${name}"`, true);
    if (!confirm(`¿Eliminar categoría "${name}"?`)) return;
    try {
      await api(`/categories/${id}`, { method: 'DELETE' });
      toast('Categoría eliminada');
      this.refresh();
    } catch (e) { toast(e.message, true); }
  }
};
