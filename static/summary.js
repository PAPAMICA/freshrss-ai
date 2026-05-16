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
		const params = new URLSearchParams({ aiDigestAction: action });
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
		modalEl.innerHTML = `
<div class="aid-backdrop"></div>
<div class="aid-panel">
  <div class="aid-panel-header">
    <div class="aid-header-left">
      <span class="aid-header-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.65-4.56A2.5 2.5 0 0 1 2 12a2.5 2.5 0 0 1 2.39-2.48 2.5 2.5 0 0 1 1.65-4.56A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.65-4.56A2.5 2.5 0 0 0 22 12a2.5 2.5 0 0 0-2.39-2.48 2.5 2.5 0 0 0-1.65-4.56A2.5 2.5 0 0 0 14.5 2Z"/></svg></span>
      <div>
        <h2 id="aid-title">Résumé IA</h2>
        <span class="aid-header-meta" id="aid-meta"></span>
      </div>
    </div>
    <div class="aid-header-actions">
      <button class="aid-btn aid-btn-ghost" id="aid-email-btn" title="Envoyer par email"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> <span>Email</span></button>
      <button class="aid-btn aid-btn-primary" id="aid-mark-all-btn" title="Tout marquer comme lu" style="display:none"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6 9 17l-5-5"/></svg> <span>Tout marquer lu</span></button>
      <button class="aid-btn aid-btn-ghost aid-close-btn" id="aid-close" title="Fermer (Échap)">&#x2715;</button>
    </div>
  </div>
  <div class="aid-panel-body">
    <div class="aid-loading" id="aid-loading">
      <div class="aid-spinner"></div>
      <p id="aid-loading-text">Récupération des articles…</p>
    </div>
    <div class="aid-content" id="aid-content" style="display:none">
      <div class="aid-summary" id="aid-summary"></div>
    </div>
    <div class="aid-error" id="aid-error" style="display:none">
      <span class="aid-error-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
      <div>
        <strong>Une erreur est survenue</strong>
        <p id="aid-error-msg"></p>
      </div>
    </div>
  </div>
  <div class="aid-panel-footer" id="aid-footer" style="display:none">
    <div class="aid-footer-left">
      <span class="aid-footer-info" id="aid-footer-info"></span>
    </div>
    <div class="aid-articles-list" id="aid-articles-list"></div>
  </div>
</div>`;

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
		document.getElementById('aid-footer').style.display = 'none';
		document.getElementById('aid-mark-all-btn').style.display = 'none';
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
			if (el) el.style.display = s === section ? '' : 'none';
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
		var checkboxes = document.querySelectorAll('.aid-article-check:checked');
		var ids = Array.from(checkboxes).map(function(cb) { return cb.value; }).filter(function(id) {
			return !markedReadIds.has(id);
		});

		if (ids.length === 0) {
			showNotification('Tous les articles sélectionnés sont déjà marqués comme lus.', 'info');
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
		fetch(buildUrl('markRead'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'ids=' + encodeURIComponent(JSON.stringify(ids)),
		})
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
					showSection('content');
				});

				renderArticleList(data.articles || []);

				document.getElementById('aid-footer').style.display = '';
				updateFooterStatus();

				if (currentArticleIds.length > 0) {
					document.getElementById('aid-mark-all-btn').style.display = '';
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
			if (keyField) keyField.style.display = p.needs_key ? '' : 'none';

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
					this.style.display = 'none';
					modelInput.style.display = '';
					modelInput.focus();
				} else {
					modelInput.value = this.value;
				}
			});
			modelInput.addEventListener('blur', function() {
				if (this.value && modelSel.options.length > 1) {
					modelSel.style.display = '';
					this.style.display = 'none';
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
				emailSettings.style.display = this.checked ? '' : 'none';
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
				testResult.style.display = '';
				testResult.className = 'adc-test-result';
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

		// ── Test email ─────────────────────────────────────────────────────
		var testEmailBtn    = gid('aid-test-email');
		var testEmailStatus = gid('aid-email-status');
		if (testEmailBtn && testEmailStatus) {
			testEmailBtn.addEventListener('click', function() {
				var btn = this;
				btn.disabled = true;
				testEmailStatus.textContent = 'Envoi…';
				testEmailStatus.className = 'adc-inline-status';

				fetch('/i/?aiDigestAction=emailReport&get=a')
					.then(function(r) { return r.json(); })
					.then(function(data) {
						testEmailStatus.textContent = data.success ? (data.message || 'Envoyé !') : (data.error || 'Erreur');
						testEmailStatus.className = 'adc-inline-status ' + (data.success ? 'success' : 'error');
						btn.disabled = false;
					})
					.catch(function() {
						testEmailStatus.textContent = 'Erreur réseau';
						testEmailStatus.className = 'adc-inline-status error';
						btn.disabled = false;
					});
			});
		}
	}

	// ─── Init ─────────────────────────────────────────────────────────────────

	function init() {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', function() {
				wireOrInjectButton();
				createModal();
				initConfigPage();
			});
		} else {
			wireOrInjectButton();
			createModal();
			initConfigPage();
		}

		// Watch for configure page being loaded via FreshRSS AJAX
		var observer = new MutationObserver(function(mutations) {
			for (var i = 0; i < mutations.length; i++) {
				var nodes = mutations[i].addedNodes;
				for (var j = 0; j < nodes.length; j++) {
					if (nodes[j].nodeType === 1) {
						initConfigPage(nodes[j].ownerDocument);
					}
				}
			}
		});
		observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
	}

	init();

})();
