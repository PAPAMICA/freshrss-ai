/* global marked */
'use strict';

(function () {

	// ─── Marked.js lazy loader ────────────────────────────────────────────────

	let markedLoaded = false;
	let markedCallbacks = [];

	function loadMarked(cb) {
		if (markedLoaded) { cb(); return; }
		markedCallbacks.push(cb);
		if (markedCallbacks.length > 1) return;

		const script = document.createElement('script');
		script.src = 'https://cdn.jsdelivr.net/npm/marked@9/marked.min.js';
		script.onload = () => {
			markedLoaded = true;
			markedCallbacks.forEach(fn => fn());
			markedCallbacks = [];
		};
		script.onerror = () => {
			markedLoaded = true;
			window.marked = { parse: text => escapeHtml(text).replace(/\n/g, '<br>') };
			markedCallbacks.forEach(fn => fn());
			markedCallbacks = [];
		};
		document.head.appendChild(script);
	}

	// ─── Utilities ────────────────────────────────────────────────────────────

	function getCurrentGet() {
		return new URLSearchParams(window.location.search).get('get') || 'a';
	}

	function buildUrl(action, extra) {
		const params = new URLSearchParams({ aiDigestAction: action, _t: Date.now() });
		if (extra) Object.keys(extra).forEach(k => params.set(k, extra[k]));
		return '?' + params.toString();
	}

	function escapeHtml(str) {
		const div = document.createElement('div');
		div.textContent = str || '';
		return div.innerHTML;
	}

	function sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	// ─── State ────────────────────────────────────────────────────────────────

	let currentArticleIds = [];
	let markedReadIds = new Set();
	let modalEl = null;
	let modalCreated = false;

	// ─── Toast notification ───────────────────────────────────────────────────

	let toastEl = null;
	let toastTimeout = null;

	function showNotification(message, type) {
		type = type || 'info';
		if (!toastEl) {
			toastEl = document.createElement('div');
			toastEl.id = 'ai-digest-toast';
			toastEl.className = 'aid-toast';
			document.body.appendChild(toastEl);
		}
		toastEl.textContent = message;
		toastEl.className = 'aid-toast aid-toast--' + type + ' aid-toast--visible';
		clearTimeout(toastTimeout);
		toastTimeout = setTimeout(() => toastEl.classList.remove('aid-toast--visible'), 4000);
	}

	// ─── Modal ────────────────────────────────────────────────────────────────

	function createModal() {
		if (modalCreated) return;
		modalCreated = true;

		modalEl = document.createElement('div');
		modalEl.id = 'ai-digest-modal';
		modalEl.className = 'aid-modal';
		modalEl.setAttribute('role', 'dialog');
		modalEl.setAttribute('aria-modal', 'true');
		modalEl.setAttribute('aria-labelledby', 'aid-title');
		// No inline style="" here — CSP blocks them. Use aid-hidden class instead.
		modalEl.innerHTML = [
			'<div class="aid-backdrop"></div>',
			'<div class="aid-panel">',
			'  <div class="aid-panel-header">',
			'    <div class="aid-header-left">',
			'      <span class="aid-header-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.65-4.56A2.5 2.5 0 0 1 2 12a2.5 2.5 0 0 1 2.39-2.48 2.5 2.5 0 0 1 1.65-4.56A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.65-4.56A2.5 2.5 0 0 0 22 12a2.5 2.5 0 0 0-2.39-2.48 2.5 2.5 0 0 0-1.65-4.56A2.5 2.5 0 0 0 14.5 2Z"/></svg></span>',
			'      <div>',
			'        <h2 id="aid-title">R\u00e9sum\u00e9 IA</h2>',
			'        <span class="aid-header-meta" id="aid-meta"></span>',
			'      </div>',
			'    </div>',
			'    <div class="aid-header-actions">',
			'      <button class="aid-btn aid-btn-ghost" id="aid-email-btn" title="Envoyer par email"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> <span>Email</span></button>',
			'      <button class="aid-btn aid-btn-primary aid-hidden" id="aid-mark-all-btn" title="Tout marquer comme lu"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6 9 17l-5-5"/></svg> <span>Tout marquer lu</span></button>',
			'      <button class="aid-btn aid-btn-ghost aid-close-btn" id="aid-close" title="Fermer (\u00c9chap)">&#x2715;</button>',
			'    </div>',
			'  </div>',
			'  <div class="aid-panel-body">',
			'    <div class="aid-loading" id="aid-loading">',
			'      <div class="aid-spinner"></div>',
			'      <p id="aid-loading-text">R\u00e9cup\u00e9ration des articles\u2026</p>',
			'    </div>',
			'    <div class="aid-content aid-hidden" id="aid-content">',
			'      <div class="aid-summary" id="aid-summary"></div>',
			'    </div>',
			'    <div class="aid-error aid-hidden" id="aid-error">',
			'      <span class="aid-error-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>',
			'      <div><strong>Une erreur est survenue</strong><p id="aid-error-msg"></p></div>',
			'    </div>',
			'  </div>',
			'  <div class="aid-panel-footer aid-hidden" id="aid-footer">',
			'    <div class="aid-footer-left"><span class="aid-footer-info" id="aid-footer-info"></span></div>',
			'    <div class="aid-articles-list" id="aid-articles-list"></div>',
			'  </div>',
			'</div>',
		].join('\n');

		document.body.appendChild(modalEl);

		// Event listeners
		modalEl.querySelector('.aid-backdrop').addEventListener('click', closeModal);
		document.getElementById('aid-close').addEventListener('click', closeModal);
		document.getElementById('aid-mark-all-btn').addEventListener('click', markAllRead);
		document.getElementById('aid-email-btn').addEventListener('click', sendEmailReport);
		document.addEventListener('keydown', function(e) {
			if (e.key === 'Escape' && modalEl.classList.contains('aid-modal--visible')) closeModal();
		});
	}

	function openModal() {
		createModal();
		modalEl.classList.add('aid-modal--visible');
		document.body.classList.add('aid-modal-open');
		showSection('loading');
		document.getElementById('aid-loading-text').textContent = 'Récupération des articles…';
		document.getElementById('aid-footer').classList.add('aid-hidden');
		document.getElementById('aid-mark-all-btn').classList.add('aid-hidden');
		document.getElementById('aid-meta').textContent = '';
		document.getElementById('aid-articles-list').innerHTML = '';
		document.getElementById('aid-summary').innerHTML = '';
	}

	function closeModal() {
		if (!modalEl) return;
		modalEl.classList.remove('aid-modal--visible');
		document.body.classList.remove('aid-modal-open');
	}

	function showSection(section) {
		['loading', 'content', 'error'].forEach(function(s) {
			var el = document.getElementById('aid-' + s);
			if (el) {
				if (s === section) el.classList.remove('aid-hidden');
				else el.classList.add('aid-hidden');
			}
		});
	}

	// ─── Articles list ────────────────────────────────────────────────────────

	function renderArticleList(articles) {
		var container = document.getElementById('aid-articles-list');
		container.innerHTML = '';
		if (!articles || articles.length === 0) return;

		var toggle = document.createElement('button');
		toggle.className = 'aid-btn aid-btn-ghost aid-articles-toggle';
		toggle.innerHTML = 'Voir les ' + articles.length + ' articles r\u00e9sum\u00e9s';

		var list = document.createElement('div');
		list.className = 'aid-articles-items';

		toggle.addEventListener('click', function() {
			var open = list.classList.toggle('aid-articles-list--open');
			toggle.innerHTML = open
				? 'Masquer la liste'
				: 'Voir les ' + articles.length + ' articles r\u00e9sum\u00e9s';
		});

		articles.forEach(function(article) {
			var item = document.createElement('div');
			item.className = 'aid-article-item';
			item.dataset.id = article.id;

			var safeTitle = escapeHtml(article.title);
			var safeLink = escapeHtml(article.link);

			item.innerHTML = `
<label class="aid-article-label">
  <input type="checkbox" class="aid-article-check" value="${escapeHtml(article.id)}" checked>
  <span class="aid-article-title">
    <a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>
  </span>
</label>
<button class="aid-article-read-btn" title="Marquer comme lu"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><path d="M20 6 9 17l-5-5"/></svg></button>`;

			item.querySelector('.aid-article-read-btn').addEventListener('click', function() {
				markSingleRead(article.id, item);
			});

			list.appendChild(item);
		});

		container.appendChild(toggle);
		container.appendChild(list);
	}

	function markSingleRead(id, itemEl) {
		if (markedReadIds.has(id)) return;
		callMarkRead([id], function() {
			markedReadIds.add(id);
			itemEl.classList.add('aid-article-item--read');
			updateFooterStatus();
		});
	}

	function markAllRead() {
		// Use all article IDs from the summary, minus those already marked read
		var ids = currentArticleIds.filter(function(id) {
			return !markedReadIds.has(id);
		});

		if (ids.length === 0) {
			showNotification('Tous les articles sont déjà marqués comme lus.', 'info');
			return;
		}

		var btn = document.getElementById('aid-mark-all-btn');
		btn.disabled = true;
		btn.innerHTML = '⏳ <span>Marquage…</span>';

		callMarkRead(ids, function(result) {
			ids.forEach(function(id) {
				markedReadIds.add(id);
				var item = document.querySelector('.aid-article-item[data-id="' + id + '"]');
				if (item) item.classList.add('aid-article-item--read');
			});
			btn.disabled = false;
			btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6 9 17l-5-5"/></svg> <span>Tout marquer lu</span>';
			updateFooterStatus();
			showNotification((result.affected || ids.length) + ' article(s) marqué(s) comme lu(s) !', 'success');
		}, function() {
			btn.disabled = false;
			btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6 9 17l-5-5"/></svg> <span>Tout marquer lu</span>';
		});
	}

	function callMarkRead(ids, onSuccess, onError) {
		// GET avoids the FreshRSS CSRF check that blocks all POSTs.
		// Minz_Request::param() reads from both GET and POST.
		fetch(buildUrl('markRead', { ids: JSON.stringify(ids) }))
		.then(function(r) { return r.json(); })
		.then(function(data) {
			if (data.success) {
				if (onSuccess) onSuccess(data);
			} else {
				showNotification('Erreur : ' + (data.error || 'Inconnue'), 'error');
				if (onError) onError(data);
			}
		})
		.catch(function(err) {
			showNotification('Erreur réseau : ' + err.message, 'error');
			if (onError) onError(err);
		});
	}

	function updateFooterStatus() {
		var total = currentArticleIds.length;
		var read = markedReadIds.size;
		var el = document.getElementById('aid-footer-info');
		if (el) el.textContent = read + '/' + total + ' article(s) marqué(s) comme lu(s)';
	}

	// ─── Post-process rendered markdown ──────────────────────────────────────

	function postProcessSummary(el) {
		// Open all links in new tab
		el.querySelectorAll('a').forEach(function(a) {
			a.setAttribute('target', '_blank');
			a.setAttribute('rel', 'noopener noreferrer');
		});

		// Find "Sources" heading and style its links as pills
		el.querySelectorAll('h2, h3').forEach(function(heading) {
			if (/sources?/i.test(heading.textContent.trim())) {
				heading.classList.add('aid-sources-heading');
				var node = heading.nextElementSibling;
				while (node) {
					node.classList.add('aid-sources-block');
					node.querySelectorAll('a').forEach(function(a) {
						a.classList.add('aid-source-pill');
					});
					node = node.nextElementSibling;
				}
			}
		});

		// Style vulnerability table rows by score
		el.querySelectorAll('table').forEach(function(table) {
			table.classList.add('aid-vuln-table');
			table.querySelectorAll('tbody tr').forEach(function(row) {
				var scoreCell = row.cells[1];
				if (!scoreCell) return;
				var raw = scoreCell.textContent;
				var txt = raw.toLowerCase();
				var numMatch = raw.match(/(\d+(?:\.\d+)?)/);
				if (numMatch) {
					var score = parseFloat(numMatch[1]);
					if (score >= 9.0)     row.classList.add('aid-vuln-critique');
					else if (score >= 7.5) row.classList.add('aid-vuln-high');
					else if (score >= 5.0) row.classList.add('aid-vuln-medium');
					else                   row.classList.add('aid-vuln-low');
				} else if (txt.includes('critique') || txt.includes('critical')) row.classList.add('aid-vuln-critique');
				else if (txt.includes('élevé') || txt.includes('high'))          row.classList.add('aid-vuln-high');
				else if (txt.includes('moyen') || txt.includes('medium'))        row.classList.add('aid-vuln-medium');
				else if (txt.includes('faible') || txt.includes('low'))          row.classList.add('aid-vuln-low');
			});
		});
	}

	// ─── Main generate ────────────────────────────────────────────────────────

	function generateSummary() {
		openModal();
		currentArticleIds = [];
		markedReadIds = new Set();

		var get = getCurrentGet();

		fetch(buildUrl('generate', { get: get }))
			.then(function(resp) {
				if (!resp.ok) throw new Error('Erreur HTTP ' + resp.status);
				document.getElementById('aid-loading-text').textContent = 'Analyse par l\'IA en cours…';
				return resp.json();
			})
			.then(function(data) {
				if (!data.success) {
					document.getElementById('aid-error-msg').textContent = data.error || 'Erreur inconnue';
					showSection('error');
					return;
				}

				currentArticleIds = data.article_ids || [];

				var metaEl = document.getElementById('aid-meta');
				if (metaEl) metaEl.textContent = data.count + ' article(s) analysé(s)';

			loadMarked(function() {
				var summaryEl = document.getElementById('aid-summary');
				try {
					if (window.marked && window.marked.parse) {
						marked.setOptions({ breaks: true, gfm: true });
						summaryEl.innerHTML = marked.parse(data.summary || '');
					} else {
						summaryEl.innerHTML = '<pre>' + escapeHtml(data.summary || '') + '</pre>';
					}
				} catch (e) {
					summaryEl.innerHTML = '<pre>' + escapeHtml(data.summary || '') + '</pre>';
				}
				postProcessSummary(summaryEl);
				showSection('content');
			});

			renderArticleList(data.articles || []);

			document.getElementById('aid-footer').classList.remove('aid-hidden');
			updateFooterStatus();

			if (currentArticleIds.length > 0) {
				document.getElementById('aid-mark-all-btn').classList.remove('aid-hidden');
			}
			})
			.catch(function(err) {
				document.getElementById('aid-error-msg').textContent = err.message || 'Une erreur est survenue';
				showSection('error');
			});
	}

	// ─── Email ────────────────────────────────────────────────────────────────

	function sendEmailReport() {
		var btn = document.getElementById('aid-email-btn');
		var origContent = btn.innerHTML;
		btn.disabled = true;
		btn.innerHTML = '⏳ <span>Envoi…</span>';

		var get = getCurrentGet();

		fetch(buildUrl('emailReport', { get: get }))
			.then(function(r) { return r.json(); })
			.then(function(data) {
				if (data.success) {
					showNotification('✅ ' + (data.message || 'Email envoyé !'), 'success');
				} else {
					showNotification('❌ ' + (data.error || 'Erreur lors de l\'envoi'), 'error');
				}
				btn.disabled = false;
				btn.innerHTML = origContent;
			})
			.catch(function(err) {
				showNotification('❌ Erreur réseau : ' + err.message, 'error');
				btn.disabled = false;
				btn.innerHTML = origContent;
			});
	}

	// ─── Button wiring ────────────────────────────────────────────────────────

	// Expose open function for PHP-injected button (onclick="window._aidOpen()")
	window._aidOpen = generateSummary;

	function wireOrInjectButton() {
		// Button injected server-side via nav_menu hook
		var existing = document.getElementById('ai-digest-trigger');
		if (existing) {
			existing.addEventListener('click', generateSummary);
			return;
		}

		// Only inject fallback button if user is authenticated (marker present)
		if (!document.getElementById('aid-auth-marker')) return;

		// Fallback: inject button via JS if PHP hook didn't fire (e.g. different theme)
		var selectors = ['#nav_menu', '.nav_menu', '#sidebar .panel', '.toolbar', '#toolbar', 'header nav', '.flux_header'];
		var container = null;
		for (var i = 0; i < selectors.length; i++) {
			container = document.querySelector(selectors[i]);
			if (container) break;
		}

		var btn = document.createElement('button');
		btn.id = 'ai-digest-trigger';
		btn.className = 'aid-trigger-btn';
		btn.setAttribute('title', 'Résumer les articles non lus avec l\'IA');
		btn.innerHTML = '<span class="aid-trigger-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.65-4.56A2.5 2.5 0 0 1 2 12a2.5 2.5 0 0 1 2.39-2.48 2.5 2.5 0 0 1 1.65-4.56A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.65-4.56A2.5 2.5 0 0 0 22 12a2.5 2.5 0 0 0-2.39-2.48 2.5 2.5 0 0 0-1.65-4.56A2.5 2.5 0 0 0 14.5 2Z"/></svg></span><span class="aid-trigger-label">R\u00e9sum\u00e9 IA</span>';
		btn.addEventListener('click', generateSummary);

		if (container) {
			var wrapper = document.createElement('li');
			wrapper.className = 'aid-nav-item';
			wrapper.appendChild(btn);
			container.prepend(wrapper);
		} else {
			// Last resort: floating action button
			var fab = document.createElement('button');
			fab.id = 'ai-digest-fab';
			fab.className = 'aid-fab';
			fab.setAttribute('title', 'Résumé IA');
			fab.innerHTML = '🧠';
			fab.addEventListener('click', generateSummary);
			document.body.appendChild(fab);
		}
	}

	// ─── Configure page handler ───────────────────────────────────────────────
	// FreshRSS loads configure.phtml via AJAX and inserts it via innerHTML,
	// so <script> tags in that file never execute. We use a MutationObserver
	// to detect when the configure elements appear in the DOM and init them here.

	function initConfigPage(root) {
		var dataEl = (root || document).getElementById('aid-config-data');
		if (!dataEl || dataEl.dataset.aidInit === '1') return;
		dataEl.dataset.aidInit = '1';

		var PROVIDERS = {};
		var DEFAULT_PROMPT = '';
		try {
			PROVIDERS = JSON.parse(dataEl.getAttribute('data-providers') || '{}');
			DEFAULT_PROMPT = dataEl.getAttribute('data-default-prompt') || '';
		} catch (e) { /* ignore parse errors */ }

		function gid(id) { return document.getElementById(id); }

		// ── Provider <select> ─────────────────────────────────────────────
		var providerSel = gid('aid-provider');
		if (providerSel) {
			providerSel.addEventListener('change', function() {
				applyProvider(this.value);
			});
		}

		function applyProvider(key) {
			var p = PROVIDERS[key];
			if (!p) return;

			var keyField = gid('aid-field-key');
			if (keyField) {
				if (p.needs_key) keyField.classList.remove('aid-hidden');
				else keyField.classList.add('aid-hidden');
			}

			var urlInput = gid('aid-api-url');
			if (urlInput) {
				urlInput.readOnly = !p.needs_url;
				if (p.url) urlInput.value = p.url;
				else if (p.needs_url) urlInput.value = '';
			}

			var sel = gid('aid-model-select');
			var modelInput = gid('aid-model');
			var currentModel = modelInput ? modelInput.value : '';
			if (sel) {
				sel.innerHTML = '';
				(p.models || []).forEach(function(m) {
					var opt = document.createElement('option');
					opt.value = m; opt.textContent = m;
					if (m === currentModel) opt.selected = true;
					sel.appendChild(opt);
				});
				var custom = document.createElement('option');
				custom.value = '__custom__'; custom.textContent = '— Saisir un modèle —';
				sel.appendChild(custom);

				if (p.models.length > 0 && modelInput && p.models.indexOf(currentModel) === -1) {
					modelInput.value = p.models[0];
					sel.options[0].selected = true;
				}
			}
		}

		// ── Model select / text toggle ─────────────────────────────────────
		var modelSel   = gid('aid-model-select');
		var modelInput = gid('aid-model');
		if (modelSel && modelInput) {
			modelSel.addEventListener('change', function() {
				if (this.value === '__custom__') {
					this.classList.add('aid-hidden');
					modelInput.classList.remove('aid-hidden');
					modelInput.focus();
				} else {
					modelInput.value = this.value;
				}
			});
			modelInput.addEventListener('blur', function() {
				if (this.value && modelSel.options.length > 1) {
					modelSel.classList.remove('aid-hidden');
					this.classList.add('aid-hidden');
				}
			});
			if (modelSel.value && modelSel.value !== '__custom__') {
				modelInput.value = modelSel.value;
			}
		}

		// ── Range sliders ──────────────────────────────────────────────────
		[
			['aid-temp', 'aid-temp-badge', function(v) { return parseFloat(v).toFixed(1); }],
			['aid-art',  'aid-art-badge',  function(v) { return v; }],
			['aid-chr',  'aid-chr-badge',  function(v) { return v; }],
		].forEach(function(triplet) {
			var inp = gid(triplet[0]), badge = gid(triplet[1]);
			if (inp && badge) {
				inp.addEventListener('input', function() { badge.textContent = triplet[2](this.value); });
			}
		});

		// ── Password toggle ────────────────────────────────────────────────
		var pwdToggle = gid('aid-toggle-pwd');
		var pwdInput  = gid('aid-api-key');
		if (pwdToggle && pwdInput) {
			pwdToggle.addEventListener('click', function() {
				var show = pwdInput.type === 'password';
				pwdInput.type = show ? 'text' : 'password';
				this.textContent = show ? 'Masquer' : 'Afficher';
			});
		}

		// ── Email section toggle ───────────────────────────────────────────
		var emailToggle   = gid('aid-email-toggle');
		var emailSettings = gid('aid-email-settings');
		if (emailToggle && emailSettings) {
			emailToggle.addEventListener('change', function() {
				if (this.checked) emailSettings.classList.remove('aid-hidden');
				else emailSettings.classList.add('aid-hidden');
			});
		}

		// ── Reset prompt ───────────────────────────────────────────────────
		var resetBtn = gid('aid-reset-prompt');
		if (resetBtn) {
			resetBtn.addEventListener('click', function() {
				if (window.confirm('Réinitialiser le prompt par défaut ?')) {
					var ta = gid('aid-prompt');
					if (ta) ta.value = DEFAULT_PROMPT;
				}
			});
		}

		// ── Test API connection ────────────────────────────────────────────
		var testBtn    = gid('aid-test-btn');
		var testResult = gid('aid-test-result');
		if (testBtn && testResult) {
			testBtn.addEventListener('click', function() {
				var btn = this;
				btn.disabled = true;
				testResult.classList.remove('aid-hidden');
				testResult.className = 'aid-test-result';
				testResult.textContent = 'Test en cours…';

				fetch('/i/?aiDigestAction=testConnection')
					.then(function(r) { return r.json(); })
					.then(function(data) {
						testResult.className = 'adc-test-result ' + (data.success ? 'success' : 'error');
						testResult.textContent = data.success ? (data.message || 'Connexion réussie !') : (data.error || 'Erreur inconnue');
						btn.disabled = false;
					})
					.catch(function(e) {
						testResult.className = 'adc-test-result error';
						testResult.textContent = 'Erreur réseau : ' + e.message;
						btn.disabled = false;
					});
			});
		}

		// ── Subscribers list on configure page ────────────────────────────
		initSubscribersList();

		// ── Test email ─────────────────────────────────────────────────────
		var testEmailBtn    = gid('aid-test-email');
		var forceSendBtn    = gid('aid-force-send');
		var testEmailStatus = gid('aid-email-status');

		function doEmailAction(btn, url, label) {
			btn.disabled = true;
			testEmailStatus.textContent = label;
			testEmailStatus.className = 'aid-status';
			fetch(url)
				.then(function(r) { return r.json(); })
				.then(function(data) {
					testEmailStatus.textContent = data.success ? (data.message || 'OK') : (data.error || 'Erreur');
					testEmailStatus.className = 'aid-status ' + (data.success ? 'ok' : 'err');
					// Refresh newsletter sidebar after forced send
					if (data.success) {
						newsletterHistory = [];
						var existing = document.getElementById('aid-newsletter-section');
						if (existing) existing.remove();
						sidebarRetries = 0;
						loadNewsletterHistory();
					}
					btn.disabled = false;
				})
				.catch(function() {
					testEmailStatus.textContent = 'Erreur réseau';
					testEmailStatus.className = 'aid-status err';
					btn.disabled = false;
				});
		}

		if (testEmailBtn && testEmailStatus) {
			testEmailBtn.addEventListener('click', function() {
				doEmailAction(this, '/i/?aiDigestAction=emailReport&get=a&_t=' + Date.now(), 'Envoi test…');
			});
		}

		if (forceSendBtn && testEmailStatus) {
			forceSendBtn.addEventListener('click', function() {
				if (!confirm('Envoyer le digest maintenant ? Cela marquera les articles comme envoyés et les exclura du prochain envoi automatique.')) return;
				doEmailAction(this, '/i/?aiDigestAction=emailReport&get=a&_t=' + Date.now(), 'Génération et envoi…');
			});
		}
	}

	// ─── Emailed articles tracking ────────────────────────────────────────────

	var emailedIds = new Set();

	function loadEmailedIds() {
		fetch(buildUrl('emailedIds'))
			.then(function(r) { return r.json(); })
			.then(function(data) {
				if (Array.isArray(data.ids)) {
					data.ids.forEach(function(id) { emailedIds.add(String(id)); });
					decorateEmailedArticles();
				}
			})
			.catch(function() {});
	}

	var AI_ICON_SVG = '<svg class="aid-emailed-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="Résumé inclus dans un digest envoyé"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.65-4.56A2.5 2.5 0 0 1 2 12a2.5 2.5 0 0 1 2.39-2.48 2.5 2.5 0 0 1 1.65-4.56A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.65-4.56A2.5 2.5 0 0 0 22 12a2.5 2.5 0 0 0-2.39-2.48 2.5 2.5 0 0 0-1.65-4.56A2.5 2.5 0 0 0 14.5 2Z"/></svg>';
	// Keep for sidebar section icon
	var EMAILED_SVG = AI_ICON_SVG;

	function decorateArticleEl(el) {
		// FreshRSS uses id="flux_1234567" and data-entry attribute
		var raw = el.getAttribute('data-entry') || el.getAttribute('data-id') || el.getAttribute('id') || '';
		var id  = raw.replace(/^[^0-9]*/, '');
		if (!id || !emailedIds.has(id)) return;
		if (el.querySelector('.aid-emailed-icon')) return;

		// Inject as a new <li class="item manage"> after the existing manage items (read/bookmark)
		// FreshRSS article header: ul.horizontal-list.flux_header > li.item.manage
		var header = el.querySelector('ul.flux_header, ul.horizontal-list');
		if (header) {
			var lastManage = null;
			header.querySelectorAll('li.item.manage').forEach(function(li) { lastManage = li; });
			var li = document.createElement('li');
			li.className = 'item manage aid-emailed-manage';
			li.innerHTML = '<span class="item-element aid-emailed-wrap">' + AI_ICON_SVG + '</span>';
			if (lastManage && lastManage.nextSibling) {
				header.insertBefore(li, lastManage.nextSibling);
			} else if (lastManage) {
				header.appendChild(li);
			}
		}
	}

	function decorateEmailedArticles() {
		document.querySelectorAll('.flux').forEach(function(el) {
			decorateArticleEl(el);
		});
	}

	// ─── Newsletter sidebar section ───────────────────────────────────────────

	var newsletterHistory = [];
	var sidebarRetries = 0;
	var historyLoaded = false;

	function loadNewsletterHistory() {
		fetch(buildUrl('emailHistory'))
			.then(function(r) { return r.json(); })
			.then(function(data) {
				newsletterHistory = Array.isArray(data.history) ? data.history : [];
				historyLoaded = true;
				refreshNewsletterContent();
			})
			.catch(function() {
				historyLoaded = true;
				refreshNewsletterContent();
			});
	}

	function refreshNewsletterContent() {
		var existing = document.getElementById('aid-newsletter-section');
		if (existing) {
			updateNewsletterSidebarList(existing);
		} else {
			tryInjectNewsletterSidebar();
		}
	}

function updateNewsletterSidebarList(section) {
	var titleEl = section.querySelector('.aid-newsletter-title .title');
	var titleLink = section.querySelector('.aid-newsletter-title');
	var count = getUnreadCount();
	if (titleEl) {
		titleEl.textContent = 'Newsletter IA';
		titleEl.setAttribute('data-unread', count);
	}
	if (titleLink) {
		titleLink.setAttribute('data-unread', count);
	}
}

	function isConfigurePage() {
		return /[?&]c=(configure|extension|auth|user)(&|$)/.test(window.location.search)
			|| !!document.getElementById('aid-cfg');
	}

	function tryInjectNewsletterSidebar() {
		if (!historyLoaded) return;
		if (isConfigurePage()) return;
		if (document.getElementById('aid-newsletter-section')) return;
		var inserted = injectNewsletterSidebar();
		// Retry up to 10× with increasing delay if sidebar not in DOM yet
		if (!inserted && sidebarRetries < 10) {
			sidebarRetries++;
			setTimeout(tryInjectNewsletterSidebar, sidebarRetries * 300);
		}
	}

	function findSidebarContainer() {
		// In this FreshRSS/Mapco theme, categories are li.tree-folder.category inside ul#sidebar
		return document.getElementById('sidebar')
			|| document.querySelector('ul.tree')
			|| document.querySelector('#aside_feed ul')
			|| null;
	}

	function injectNewsletterSidebar() {
		if (document.getElementById('aid-newsletter-section')) return true;

		var sidebar = findSidebarContainer();
		if (!sidebar) return false;

		// Build a li.tree-folder.category matching FreshRSS's native structure
		var section = document.createElement('li');
		section.className = 'tree-folder category aid-newsletter-section';
		section.id = 'aid-newsletter-section';

	var nlCount = getUnreadCount();

	section.innerHTML = [
		'<a class="tree-folder-title aid-newsletter-title" href="#" data-unread="' + nlCount + '">',
		'  <span class="aid-nl-icon">' + EMAILED_SVG + '</span>',
		'  <span class="title" data-unread="' + nlCount + '">Newsletter IA</span>',
		'</a>',
	].join('\n');

		// Insert before li.tree-folder.category.favorites (FreshRSS native favorites item)
		var favorites = sidebar.querySelector('li.tree-folder.category.favorites')
			|| sidebar.querySelector('li.category.favorites');
		if (!favorites) {
			// Fallback: find by text
			sidebar.querySelectorAll('li.tree-folder').forEach(function(li) {
				if (!favorites && /favori/i.test(li.textContent.trim().slice(0, 40))) favorites = li;
			});
		}
		if (favorites) {
			sidebar.insertBefore(section, favorites);
		} else {
			// Prepend after any non-li elements at top
			var firstLi = sidebar.querySelector('li');
			sidebar.insertBefore(section, firstLi || sidebar.firstChild);
		}

	// ── Event handlers ──────────────────────────────────────────────────

	// Click title → affiche la liste dans la zone centrale (#stream)
	section.querySelector('.aid-newsletter-title').addEventListener('click', function(e) {
		e.preventDefault();
		openNewsletterList();
	});

	// ── Subscription form ───────────────────────────────────────────────
		var subForm = document.createElement('div');
		subForm.className = 'aid-subscribe-form';
		subForm.innerHTML = [
			'<button type="button" class="aid-subscribe-toggle-btn">',
			'  <span class="aid-subscribe-toggle-icon">',
			'    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
			'  </span>',
			'  S\'abonner à la newsletter',
			'</button>',
			'<div class="aid-subscribe-body aid-hidden">',
			'  <div class="aid-subscribe-row">',
			'    <input type="email" class="aid-subscribe-input" placeholder="votre@email.com">',
			'    <button class="aid-subscribe-btn btn">S\'abonner</button>',
			'  </div>',
			'  <span class="aid-subscribe-status"></span>',
			'</div>',
		].join('');
		section.appendChild(subForm);

		subForm.querySelector('.aid-subscribe-toggle-btn').addEventListener('click', function() {
			var body = subForm.querySelector('.aid-subscribe-body');
			body.classList.toggle('aid-hidden');
			if (!body.classList.contains('aid-hidden')) {
				subForm.querySelector('.aid-subscribe-input').focus();
			}
		});

		subForm.querySelector('.aid-subscribe-btn').addEventListener('click', function() {
			var input  = subForm.querySelector('.aid-subscribe-input');
			var status = subForm.querySelector('.aid-subscribe-status');
			var email  = input.value.trim();
			if (!email) return;
			this.disabled = true;
			status.textContent = '…';
			fetch(buildUrl('subscribe', { email: email }))
				.then(function(r) { return r.json(); })
				.then(function(data) {
					status.textContent = data.message || data.error || '';
					status.className   = 'aid-subscribe-status ' + (data.success ? 'ok' : 'err');
					if (data.success) {
						input.value = '';
						setTimeout(function() { subForm.querySelector('.aid-subscribe-body').classList.add('aid-hidden'); }, 2000);
					}
				})
				.catch(function() { status.textContent = 'Erreur réseau'; status.className = 'aid-subscribe-status err'; })
				.finally(function() { subForm.querySelector('.aid-subscribe-btn').disabled = false; });
		});

		return true;
	}

	// ─── Configure page newsletter history ────────────────────────────────────

	function initSubscribersList() {
		var container = document.getElementById('aid-subscribers-list');
		if (!container) return;

		function renderSubscribers(subs) {
			if (!subs || subs.length === 0) {
				container.innerHTML = '<p class="aid-hint">Aucun abonné pour l\'instant.</p>';
				return;
			}

			var rows = subs.map(function(sub) {
				var date = sub.ts ? new Date(sub.ts * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
				return '<tr>'
					+ '<td class="aid-sub-email">' + escapeHtml(sub.email) + '</td>'
					+ '<td class="aid-sub-date">' + date + '</td>'
					+ '<td class="aid-sub-count">' + (sub.sent_count || 0) + '</td>'
					+ '<td class="aid-sub-actions">'
					+ '<button class="btn aid-sub-delete" data-email="' + escapeHtml(sub.email) + '">Supprimer</button>'
					+ '</td>'
					+ '</tr>';
			}).join('');

			container.innerHTML = '<table class="aid-subscribers-table">'
				+ '<thead><tr>'
				+ '<th>Email</th>'
				+ '<th>Abonné depuis</th>'
				+ '<th>Newsletters reçues</th>'
				+ '<th></th>'
				+ '</tr></thead>'
				+ '<tbody>' + rows + '</tbody>'
				+ '</table>';

			container.querySelectorAll('.aid-sub-delete').forEach(function(btn) {
				btn.addEventListener('click', function() {
					var email = btn.getAttribute('data-email');
					if (!confirm('Supprimer l\'abonné « ' + email + ' » ?')) return;
					btn.disabled = true;
					fetch(buildUrl('unsubscribe', { email: email }))
						.then(function(r) { return r.json(); })
						.then(function(data) {
					if (data.success) {
							var row = btn.closest('tr');
							row.classList.add('aid-sub-row-removing');
							setTimeout(function() {
									row.remove();
									if (!container.querySelector('tbody tr')) {
										container.innerHTML = '<p class="aid-hint">Aucun abonné pour l\'instant.</p>';
									}
								}, 300);
							} else {
								btn.disabled = false;
							}
						})
						.catch(function() { btn.disabled = false; });
				});
			});
		}

		fetch(buildUrl('subscribersFull'))
			.then(function(r) { return r.json(); })
			.then(function(data) { renderSubscribers(data.subscribers || []); })
			.catch(function() {
				container.innerHTML = '<p class="aid-hint">Erreur lors du chargement des abonnés.</p>';
			});
	}

	// ─── Newsletter read tracking (localStorage) ─────────────────────────────

	function getReadNewsletterTs() {
		try {
			return new Set(JSON.parse(localStorage.getItem('aid-newsletter-read') || '[]'));
		} catch (e) { return new Set(); }
	}

	function saveReadNewsletterTs(readSet) {
		try {
			localStorage.setItem('aid-newsletter-read', JSON.stringify(Array.from(readSet)));
		} catch (e) {}
	}

	function getUnreadCount() {
		var readSet = getReadNewsletterTs();
		return newsletterHistory.filter(function(rec) { return !readSet.has(rec.ts); }).length;
	}

	function refreshNewsletterUnreadCount() {
		var section = document.getElementById('aid-newsletter-section');
		if (!section) return;
		var count = getUnreadCount();
		var titleEl = section.querySelector('.aid-newsletter-title .title');
		var titleLink = section.querySelector('.aid-newsletter-title');
		if (titleEl) titleEl.setAttribute('data-unread', count);
		if (titleLink) titleLink.setAttribute('data-unread', count);
	}

	function markNewsletterRead(ts) {
		var readSet = getReadNewsletterTs();
		if (readSet.has(ts)) return;
		readSet.add(ts);
		saveReadNewsletterTs(readSet);
		refreshNewsletterUnreadCount();
		// Mettre à jour l'item dans la liste si elle est visible
		var item = document.querySelector('.aid-newsletter-list-item[data-ts="' + ts + '"]');
		if (item) {
			item.classList.add('aid-newsletter-read');
			item.classList.remove('not_read');
			var btn = item.querySelector('.aid-nl-mark-read-btn');
			if (btn) btn.disabled = true;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────

	function setStreamNativeVisible(visible) {
		var stream = document.getElementById('stream');
		if (!stream) return;
		// Cache/restaure TOUS les enfants directs de #stream qui ne sont pas les nôtres
		Array.from(stream.children).forEach(function(el) {
			if (!el.classList.contains('aid-newsletter-flux')) {
				el.classList.toggle('aid-nl-stream-hidden', !visible);
			}
		});
	}

	function openNewsletterList() {
		var stream = document.getElementById('stream');
		if (!stream) {
			showNotification('Zone d\'affichage introuvable.', 'error');
			return;
		}

		// Retirer tout contenu newsletter précédent
		stream.querySelectorAll('.aid-newsletter-flux').forEach(function(el) { el.remove(); });

		// Masquer le message "aucun article" et les contrôles natifs FreshRSS
		setStreamNativeVisible(false);

		// Marquer le sidebar comme actif
		var section = document.getElementById('aid-newsletter-section');
		if (section) section.classList.add('active');

		if (!newsletterHistory.length) {
			var emptyEl = document.createElement('div');
			emptyEl.className = 'flux aid-newsletter-flux aid-newsletter-list-view';
			emptyEl.innerHTML = [
				'<ul class="horizontal-list flux_header websitefull">',
				'  <li class="item website full">',
				'    <span class="item-element">',
				'      <span class="aid-nl-favicon">' + EMAILED_SVG + '</span>',
				'      <span class="websiteName">Newsletter IA</span>',
				'    </span>',
				'  </li>',
				'</ul>',
				'<article class="flux_content"><div class="content content_large">',
				'  <p>Aucun digest envoyé pour l\'instant.</p>',
				'</div></article>',
			].join('\n');
			stream.insertBefore(emptyEl, stream.firstChild);
			return;
		}

		// Afficher chaque newsletter comme un article expandable (comme les articles RSS natifs)
		var readSet = getReadNewsletterTs();
		var fragment = document.createDocumentFragment();
		newsletterHistory.forEach(function(rec, idx) {
			var d = new Date(rec.ts * 1000);
			var dateStr = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
			var isRead = readSet.has(rec.ts);

			var fluxEl = document.createElement('div');
			fluxEl.className = 'flux aid-newsletter-flux aid-newsletter-list-item' + (isRead ? ' aid-newsletter-read' : ' not_read');
			fluxEl.dataset.idx = String(idx);
			fluxEl.dataset.ts = String(rec.ts);

			var checkSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6 9 17l-5-5"/></svg>';

			fluxEl.innerHTML = [
				'<ul class="horizontal-list flux_header websitefull">',
				'  <li class="item website full">',
				'    <span class="item-element">',
				'      <span class="aid-nl-favicon">' + EMAILED_SVG + '</span>',
				'      <span class="websiteName">Newsletter IA</span>',
				'    </span>',
				'  </li>',
				'  <li class="item titleAuthorSummaryDate">',
				'    <span class="item-element title">Digest du ' + escapeHtml(dateStr) + '</span>',
				'    <span class="item-element date"><time>' + rec.count + ' article' + (rec.count > 1 ? 's' : '') + '</time></span>',
				'  </li>',
				'  <li class="item manage aid-nl-actions">',
				'    <button class="item-element aid-nl-mark-read-btn" title="Marquer comme lu"' + (isRead ? ' disabled' : '') + '>',
				'      ' + checkSvg,
				'    </button>',
				'  </li>',
				'</ul>',
				'<article class="flux_content aid-nl-content">',
				'  <div class="content content_large">',
				'    <div class="aid-nl-stream-body"></div>',
				'  </div>',
				'</article>',
			].join('\n');

			// Bouton "marquer comme lu" — stoppe la propagation
			fluxEl.querySelector('.aid-nl-mark-read-btn').addEventListener('click', function(e) {
				e.stopPropagation();
				e.preventDefault();
				markNewsletterRead(rec.ts);
			});

			// Clic sur l'item = expand/collapse inline (comme un article RSS)
			fluxEl.addEventListener('click', function(e) {
				e.stopPropagation();
				e.preventDefault();
				toggleNewsletterItem(fluxEl, idx, rec.ts);
			});

			fragment.appendChild(fluxEl);
		});

		stream.insertBefore(fragment, stream.firstChild);
		stream.scrollTop = 0;
	}

	function toggleNewsletterItem(fluxEl, idx, ts) {
		var content = fluxEl.querySelector('.aid-nl-content');
		var isOpen = fluxEl.classList.contains('active');

		if (isOpen) {
			// Fermer
			fluxEl.classList.remove('active', 'current');
			content.classList.remove('aid-nl-content--open');
		} else {
			// Fermer tout autre item ouvert
			document.querySelectorAll('.aid-newsletter-list-item.active').forEach(function(el) {
				el.classList.remove('active', 'current');
				var c = el.querySelector('.aid-nl-content');
				if (c) c.classList.remove('aid-nl-content--open');
			});

			// Ouvrir
			fluxEl.classList.add('active', 'current');
			content.classList.add('aid-nl-content--open');

			// Marquer comme lu
			markNewsletterRead(ts);

			// Charger l'iframe si pas encore fait
			var body = content.querySelector('.aid-nl-stream-body');
			if (body && !body.querySelector('iframe')) {
				var iframe = document.createElement('iframe');
				iframe.className = 'aid-nl-stream-iframe';
				iframe.setAttribute('sandbox', 'allow-scripts allow-popups');
				body.appendChild(iframe);

				function onHeightMsg(e) {
					if (e.data && e.data.type === 'aid-nl-height' && e.data.h > 100) {
						iframe.setAttribute('height', String(Math.round(e.data.h)));
					}
				}
				window.addEventListener('message', onHeightMsg);

				iframe.src = buildUrl('emailRender', { idx: idx });

				setTimeout(function() {
					if (!iframe.getAttribute('height') || parseInt(iframe.getAttribute('height'), 10) < 200) {
						iframe.setAttribute('height', '600');
					}
				}, 2000);

				// Nettoyage listener quand l'item est fermé à nouveau
				fluxEl.addEventListener('click', function cleanup() {
					if (!fluxEl.classList.contains('active')) {
						window.removeEventListener('message', onHeightMsg);
						fluxEl.removeEventListener('click', cleanup);
					}
				});
			}

			// Scroll vers l'item
			fluxEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	function openNewsletterEmail(idx) {
		var stream = document.getElementById('stream');
		if (stream) {
			openNewsletterInStream(idx, stream);
		} else {
			openNewsletterOverlay(idx);
		}
	}

	function openNewsletterInStream(idx, stream) {
		fetch(buildUrl('emailContent', { idx: idx }))
			.then(function(r) { return r.json(); })
			.then(function(data) {
				if (!data.html) return;

				var rec = newsletterHistory[idx];
				if (!rec) return;

				// Marquer automatiquement comme lu à l'ouverture
				markNewsletterRead(rec.ts);
				var d = new Date(rec.ts * 1000);
				var dateStr = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

			// Remove any previously opened newsletter flux and hide native articles
			stream.querySelectorAll('.aid-newsletter-flux').forEach(function(el) { el.remove(); });
			setStreamNativeVisible(false);

				var fluxEl = document.createElement('div');
				fluxEl.className = 'flux active current aid-newsletter-flux not_read';

				fluxEl.innerHTML = [
					'<ul class="horizontal-list flux_header websitefull">',
					'  <li class="item manage">',
					'    <a class="item-element aid-nl-stream-close" href="#" title="Fermer">',
					'      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="icon" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
					'    </a>',
					'  </li>',
					'  <li class="item website full">',
					'    <span class="item-element">',
					'      <span class="aid-nl-favicon">' + EMAILED_SVG + '</span>',
					'      <span class="websiteName">Newsletter IA</span>',
					'    </span>',
					'  </li>',
					'  <li class="item titleAuthorSummaryDate">',
					'    <span class="item-element title">Digest du ' + escapeHtml(dateStr) + '</span>',
					'    <span class="item-element date"><time>' + rec.count + ' article' + (rec.count > 1 ? 's' : '') + '</time>&nbsp;</span>',
					'  </li>',
					'</ul>',
					'<article class="flux_content" dir="auto">',
					'  <div class="content content_large">',
					'    <div class="text aid-nl-stream-body"></div>',
					'  </div>',
					'</article>',
				].join('\n');

				stream.insertBefore(fluxEl, stream.firstChild);

			// Inject email HTML via iframe (blob URL preserves all inline CSS/styles)
			var bodyDiv = fluxEl.querySelector('.aid-nl-stream-body');
			var iframe = document.createElement('iframe');
			iframe.className = 'aid-nl-stream-iframe';
			// allow-scripts: runs the postMessage height reporter; allow-popups: opens links
			// No allow-same-origin: prevents iframe content from accessing parent cookies/DOM
			iframe.setAttribute('sandbox', 'allow-scripts allow-popups');
			bodyDiv.appendChild(iframe);

			// Load via dedicated endpoint that serves its own permissive CSP
			// (avoids parent-page CSP blocking email inline styles/scripts)
			iframe.src = buildUrl('emailRender', { idx: idx });

		// Listen for height messages from the iframe
		function onHeightMsg(e) {
			if (e.data && e.data.type === 'aid-nl-height' && e.data.h > 100) {
				iframe.setAttribute('height', String(Math.round(e.data.h)));
			}
		}
		window.addEventListener('message', onHeightMsg);

		// Fallback height if postMessage doesn't fire within 2s
		setTimeout(function() {
			if (!iframe.getAttribute('height') || parseInt(iframe.getAttribute('height'), 10) < 200) {
				iframe.setAttribute('height', '600');
			}
		}, 2000);

			// Close button — retour à la liste des newsletters
			fluxEl.querySelector('.aid-nl-stream-close').addEventListener('click', function(e) {
				e.preventDefault();
				window.removeEventListener('message', onHeightMsg);
				fluxEl.remove();
				// Si on venait de la liste (pas d'autres flux natifs dans le stream), retour à la liste
				var stream = document.getElementById('stream');
				var hasNativeFlux = stream && stream.querySelector('.flux:not(.aid-newsletter-flux)');
				if (!hasNativeFlux) {
					openNewsletterList();
				} else {
					setStreamNativeVisible(true);
				}
			});

			// Scroll to the article
			fluxEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
			})
			.catch(function() {});
	}

	function openNewsletterOverlay(idx) {
		var overlay = document.createElement('div');
		overlay.className = 'aid-nl-overlay';
		overlay.innerHTML = [
			'<div class="aid-nl-viewer">',
			'  <button class="aid-nl-close" title="Fermer">&#x2715;</button>',
			'  <iframe class="aid-nl-frame" sandbox="allow-scripts allow-popups"></iframe>',
			'</div>',
		].join('');
		document.body.appendChild(overlay);

		overlay.querySelector('iframe').src = buildUrl('emailRender', { idx: idx });

		overlay.querySelector('.aid-nl-close').addEventListener('click', function() {
			overlay.remove();
		});
		overlay.addEventListener('click', function(e) {
			if (e.target === overlay) overlay.remove();
		});
	}

	// ─── Init ─────────────────────────────────────────────────────────────────

	function init() {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', function() {
				wireOrInjectButton();
				createModal();
				initConfigPage();
				loadEmailedIds();
				loadNewsletterHistory();
			});
		} else {
			wireOrInjectButton();
			createModal();
			initConfigPage();
			loadEmailedIds();
			loadNewsletterHistory();
		}

		// Watch for configure page being loaded via FreshRSS AJAX
		// and for new articles being added to the list
		var observer = new MutationObserver(function(mutations) {
			var hasNativeFlux = false;
			for (var i = 0; i < mutations.length; i++) {
				var nodes = mutations[i].addedNodes;
				for (var j = 0; j < nodes.length; j++) {
					var node = nodes[j];
					if (node.nodeType !== 1) continue;
					initConfigPage(node.ownerDocument);
					// Ne compter que les .flux natifs (pas ceux de l'extension)
					if (node.classList && node.classList.contains('flux') && !node.classList.contains('aid-newsletter-flux')) {
						hasNativeFlux = true;
					} else if (node.querySelector && node.querySelector('.flux:not(.aid-newsletter-flux)')) {
						hasNativeFlux = true;
					}
				}
			}
			if (hasNativeFlux) {
				decorateEmailedArticles();
				// Des articles natifs FreshRSS viennent d'être chargés : nettoyer la vue newsletter
				var nlItems = document.querySelectorAll('.aid-newsletter-flux');
				if (nlItems.length) {
					nlItems.forEach(function(el) { el.remove(); });
					setStreamNativeVisible(true);
					var nlSection = document.getElementById('aid-newsletter-section');
					if (nlSection) nlSection.classList.remove('active');
				}
			}
			// Retry sidebar injection if the categories nav just appeared (only once history is loaded)
			if (!document.getElementById('aid-newsletter-section') && findSidebarContainer() && historyLoaded) {
				tryInjectNewsletterSidebar();
			}
		});
		observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
	}

	init();

})();
