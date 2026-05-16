<?php

declare(strict_types=1);

class AIDigestExtension extends Minz_Extension {

	private const DEFAULT_PROMPT = 'You are an experienced news editor and cybersecurity analyst.

Your task is to analyze the provided RSS articles and produce a structured digest in {{LANGUAGE}}.

---

## SECTION 1 — Vulnerability table (ONLY if security articles exist)

If any articles mention CVEs, security vulnerabilities, patches or zero-days, output this Markdown table FIRST:

| Vulnérabilité | Score | Technologie | Résumé |
|---|---|---|---|
| CVE-XXXX-XXXX | 9.8 Critique | Apache | Description courte en français |

Score labels: use the language {{LANGUAGE}} for severity names.

If no security articles → skip this section entirely.

---

## SECTION 2 — News digest

# [Titre principal reflétant l\'actualité du jour]

## [Sujet 1]
Paragraphe de synthèse...

## [Sujet 2]
Paragraphe de synthèse...

Rules:
- Group and merge articles on the same topic.
- Neutral journalistic tone, entirely in {{LANGUAGE}}.
- Mention key facts: people, companies, products, countries.
- Ignore ads and sponsored content.

---

## SECTION 3 — Sources

## Sources

List each referenced article as a Markdown link, one per line:
[Article title in {{LANGUAGE}}](URL)

---

Articles:
{{ARTICLES}}';

	public function init(): void {
		$this->registerHook('freshrss_init', [$this, 'onFreshRSSInit']);
		$this->registerHook('nav_menu', [$this, 'renderNavButton']);
		$this->registerHook('freshrss_user_maintenance', [$this, 'onUserMaintenance']);

		Minz_View::appendStyle($this->getFileUrl('summary.css', 'css'));
		Minz_View::appendScript($this->getFileUrl('summary.js', 'js'));

		// Allow external CDN for marked.js (Markdown renderer)
		$this->csp_policies['script-src'] = "'self' https://cdn.jsdelivr.net";
	}

	public function renderNavButton(): string {
		$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
			. '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.65-4.56A2.5 2.5 0 0 1 2 12a2.5 2.5 0 0 1 2.39-2.48 2.5 2.5 0 0 1 1.65-4.56A2.5 2.5 0 0 1 9.5 2Z"/>'
			. '<path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.65-4.56A2.5 2.5 0 0 0 22 12a2.5 2.5 0 0 0-2.39-2.48 2.5 2.5 0 0 0-1.65-4.56A2.5 2.5 0 0 0 14.5 2Z"/>'
			. '</svg>';
		return '<li class="aid-nav-item">'
			. '<button id="ai-digest-trigger" class="aid-trigger-btn" '
			. 'title="Résumer les articles non lus avec l\'IA">'
			. '<span class="aid-trigger-icon">' . $svg . '</span>'
			. '<span class="aid-trigger-label">Résumé IA</span>'
			. '</button>'
			. '</li>';
	}

	public function onFreshRSSInit(): void {
		$action = Minz_Request::param('aiDigestAction', '');
		if (empty($action)) {
			return;
		}

		// Vider tous les buffers de sortie ouverts par FreshRSS
		while (ob_get_level() > 0) {
			ob_end_clean();
		}

		header('Cache-Control: no-store, no-cache, must-revalidate');
		header('Pragma: no-cache');

		if (!FreshRSS_Auth::hasAccess()) {
			http_response_code(401);
			header('Content-Type: application/json; charset=utf-8');
			echo json_encode(['error' => 'Non autorisé'], JSON_UNESCAPED_UNICODE);
			exit;
		}

		header('Content-Type: application/json; charset=utf-8');

		switch ($action) {
			case 'generate':
				$get = Minz_Request::param('get', 'a');
				echo json_encode($this->generateSummary((string)$get), JSON_UNESCAPED_UNICODE);
				break;
			case 'markRead':
				$rawIds = Minz_Request::param('ids', '');
				$ids = json_decode((string)$rawIds, true);
				if (!is_array($ids)) {
					$ids = [];
				}
				echo json_encode($this->markArticlesRead($ids), JSON_UNESCAPED_UNICODE);
				break;
			case 'emailReport':
				$get = Minz_Request::param('get', 'a');
				echo json_encode($this->sendEmailReport((string)$get), JSON_UNESCAPED_UNICODE);
				break;
			case 'config':
				echo json_encode($this->getPublicConfig(), JSON_UNESCAPED_UNICODE);
				break;
			case 'testConnection':
				echo json_encode($this->testConnection(), JSON_UNESCAPED_UNICODE);
				break;
			default:
				echo json_encode(['error' => 'Action inconnue'], JSON_UNESCAPED_UNICODE);
		}
		exit;
	}

	public function handleConfigureAction(): void {
		parent::handleConfigureAction();
		if (!Minz_Request::isPost()) {
			return;
		}

		// Load current config as base so partial saves don't erase other settings
		$current = $this->getSystemConfiguration();
		$section = Minz_Request::param('aid_section', 'all');

		if ($section === 'ia' || $section === 'all') {
			$current['provider']     = (string) Minz_Request::param('ai_provider', $current['provider'] ?? 'openai');
			$current['api_key']      = (string) Minz_Request::param('ai_api_key', $current['api_key'] ?? '');
			$current['api_base_url'] = (string) Minz_Request::param('ai_api_base_url', $current['api_base_url'] ?? '');
			$current['model']        = (string) Minz_Request::param('ai_model', $current['model'] ?? 'gpt-4o-mini');
			$current['language']     = (string) Minz_Request::param('ai_language', $current['language'] ?? 'French');
			$current['prompt']       = (string) Minz_Request::param('ai_prompt', $current['prompt'] ?? self::DEFAULT_PROMPT);
			$current['max_articles'] = min(200, max(1, (int) Minz_Request::param('ai_max_articles', $current['max_articles'] ?? 50)));
			$current['max_chars']    = min(10000, max(100, (int) Minz_Request::param('ai_max_chars', $current['max_chars'] ?? 2000)));
			$current['temperature']  = min(2.0, max(0.0, (float) Minz_Request::param('ai_temperature', $current['temperature'] ?? 0.3)));
		}

		if ($section === 'mail' || $section === 'all') {
			$current['email_enabled']   = Minz_Request::param('email_enabled') === '1';
			$current['email_to']        = (string) Minz_Request::param('email_to', $current['email_to'] ?? '');
			$current['email_from']      = (string) Minz_Request::param('email_from', $current['email_from'] ?? '');
			$current['email_from_name'] = (string) Minz_Request::param('email_from_name', $current['email_from_name'] ?? 'FreshRSS AI Digest');
			$current['email_schedule']  = (string) Minz_Request::param('email_schedule', $current['email_schedule'] ?? 'never');
			$current['email_hour']      = min(23, max(0, (int) Minz_Request::param('email_hour', $current['email_hour'] ?? 8)));
			$current['smtp_host']       = (string) Minz_Request::param('smtp_host', $current['smtp_host'] ?? '');
			$current['smtp_port']       = (int) Minz_Request::param('smtp_port', $current['smtp_port'] ?? 587);
			$current['smtp_user']       = (string) Minz_Request::param('smtp_user', $current['smtp_user'] ?? '');
			$current['smtp_pass']       = (string) Minz_Request::param('smtp_pass', $current['smtp_pass'] ?? '');
			$current['smtp_tls']        = Minz_Request::param('smtp_tls') === '1';
		}

		$this->setSystemConfiguration($current);
	}

	// ─── Configuration helpers ─────────────────────────────────────────────────

	private function cfg(string $key, mixed $default = ''): mixed {
		$config = $this->getSystemConfiguration();
		return $config[$key] ?? $default;
	}

	private function getPublicConfig(): array {
		return [
			'provider' => $this->cfg('provider', 'openai'),
			'model' => $this->cfg('model', 'gpt-4o-mini'),
			'max_articles' => $this->cfg('max_articles', 50),
		];
	}

	private function testConnection(): array {
		try {
			$prompt = 'Reply with exactly: {"ok":true}';
			$result = $this->callLLM($prompt);
			$clean = trim($result);
			return ['success' => true, 'message' => 'Connexion réussie ! Réponse : ' . mb_substr($clean, 0, 120)];
		} catch (Exception $e) {
			return ['success' => false, 'error' => $e->getMessage()];
		}
	}

	// ─── Core: summary generation ──────────────────────────────────────────────

	private function generateSummary(string $get): array {
		try {
			$entries = $this->fetchUnreadEntries($get);
			if (empty($entries)) {
				return ['success' => false, 'error' => 'Aucun article non lu trouvé dans cette vue.'];
			}

			$prompt = $this->buildPrompt($entries);
			$summary = $this->callLLM($prompt);

			$articleIds = array_map(fn($e) => $e['id'], $entries);
			$articleTitles = array_map(fn($e) => ['id' => $e['id'], 'title' => $e['title'], 'link' => $e['link']], $entries);

			return [
				'success' => true,
				'summary' => $summary,
				'article_ids' => $articleIds,
				'articles' => $articleTitles,
				'count' => count($entries),
			];
		} catch (Exception $e) {
			Minz_Log::error('AIDigest::generateSummary error: ' . $e->getMessage());
			return ['success' => false, 'error' => $e->getMessage()];
		}
	}

	/**
	 * Fetch unread entries based on filter context (all / category / feed)
	 * @return array<int, array{id:string, title:string, content:string, link:string, date:int, feed:string}>
	 */
	private function fetchUnreadEntries(string $get): array {
		$entryDAO = FreshRSS_Factory::createEntryDao();
		$maxArticles = (int) $this->cfg('max_articles', 50);
		$maxChars = (int) $this->cfg('max_chars', 2000);

		$type = 'a';
		$id = 0;

		if (preg_match('/^([cCfFtT])_(\d+)$/', $get, $m)) {
			$type = strtolower($m[1]);
			$id = (int) $m[2];
		} elseif ($get === 'starred' || $get === 's') {
			$type = 's';
		}

		$entries = [];
		$traversable = $entryDAO->listWhere(
			type: $type,
			id: $id,
			state: FreshRSS_Entry::STATE_NOT_READ,
			limit: $maxArticles,
		);

		foreach ($traversable as $entry) {
			/** @var FreshRSS_Entry $entry */
			$content = strip_tags($entry->content(false));
			$content = preg_replace('/\s+/', ' ', $content);
			$content = mb_substr(trim($content), 0, $maxChars, 'UTF-8');

			$feedName = '';
			try {
				$feed = $entry->feed();
				if ($feed !== null) {
					$feedName = $feed->name();
				}
			} catch (Exception $e) {
				// ignore
			}

			$entries[] = [
				'id' => $entry->id(),
				'title' => $entry->title(),
				'content' => $content,
				'link' => htmlspecialchars_decode($entry->link(), ENT_QUOTES),
				'date' => $entry->date(),
				'feed' => $feedName,
			];
		}

		return $entries;
	}

	private function buildPrompt(array $entries): string {
		$promptTemplate = (string) $this->cfg('prompt', self::DEFAULT_PROMPT);
		$language       = (string) $this->cfg('language', 'French');

		$articlesJson = [];
		foreach ($entries as $entry) {
			$articlesJson[] = [
				'source'  => $entry['feed'],
				'title'   => $entry['title'],
				'url'     => $entry['link'],
				'content' => $entry['content'],
			];
		}

		$articlesText = json_encode($articlesJson, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
		$prompt = str_replace('{{ARTICLES}}', $articlesText, $promptTemplate);
		$prompt = str_replace('{{LANGUAGE}}', $language, $prompt);
		return $prompt;
	}

	// ─── LLM API call (multi-provider) ────────────────────────────────────────

	private function callLLM(string $prompt): string {
		$provider = (string) $this->cfg('provider', 'openai');
		$apiKey = (string) $this->cfg('api_key', '');
		$model = (string) $this->cfg('model', 'gpt-4o-mini');
		$temperature = (float) $this->cfg('temperature', 0.3);
		$baseUrl = (string) $this->cfg('api_base_url', '');

		switch ($provider) {
			case 'anthropic':
				return $this->callAnthropic($prompt, $apiKey, $model, $temperature);
			case 'mistral':
				return $this->callOpenAICompatible(
					$prompt, $apiKey, $model, $temperature,
					'https://api.mistral.ai/v1/chat/completions'
				);
			case 'ollama':
				$ollamaUrl = rtrim($baseUrl ?: 'http://localhost:11434', '/') . '/api/chat';
				return $this->callOllama($prompt, $model, $ollamaUrl);
			case 'custom':
				$url = rtrim($baseUrl, '/') . '/chat/completions';
				return $this->callOpenAICompatible($prompt, $apiKey, $model, $temperature, $url);
			case 'openai':
			default:
				return $this->callOpenAICompatible(
					$prompt, $apiKey, $model, $temperature,
					'https://api.openai.com/v1/chat/completions'
				);
		}
	}

	private function callOpenAICompatible(string $prompt, string $apiKey, string $model, float $temperature, string $url): string {
		$payload = [
			'model' => $model,
			'messages' => [
				['role' => 'user', 'content' => $prompt],
			],
			'temperature' => $temperature,
		];

		$headers = [
			'Content-Type: application/json',
		];
		if (!empty($apiKey)) {
			$headers[] = 'Authorization: Bearer ' . $apiKey;
		}

		$response = $this->httpPost($url, $payload, $headers);
		$json = json_decode($response, true);

		if (isset($json['choices'][0]['message']['content'])) {
			return $json['choices'][0]['message']['content'];
		}

		$error = $json['error']['message'] ?? $response;
		throw new Exception('Erreur API LLM : ' . $error);
	}

	private function callAnthropic(string $prompt, string $apiKey, string $model, float $temperature): string {
		$payload = [
			'model' => $model ?: 'claude-3-5-haiku-20241022',
			'max_tokens' => 4096,
			'temperature' => $temperature,
			'messages' => [
				['role' => 'user', 'content' => $prompt],
			],
		];

		$headers = [
			'Content-Type: application/json',
			'x-api-key: ' . $apiKey,
			'anthropic-version: 2023-06-01',
		];

		$response = $this->httpPost('https://api.anthropic.com/v1/messages', $payload, $headers);
		$json = json_decode($response, true);

		if (isset($json['content'][0]['text'])) {
			return $json['content'][0]['text'];
		}

		$error = $json['error']['message'] ?? $response;
		throw new Exception('Erreur API Anthropic : ' . $error);
	}

	private function callOllama(string $prompt, string $model, string $url): string {
		$payload = [
			'model' => $model,
			'messages' => [
				['role' => 'user', 'content' => $prompt],
			],
			'stream' => false,
		];

		$response = $this->httpPost($url, $payload, ['Content-Type: application/json']);
		$json = json_decode($response, true);

		if (isset($json['message']['content'])) {
			return $json['message']['content'];
		}

		throw new Exception('Erreur API Ollama : ' . ($response ?: 'Réponse vide'));
	}

	private function httpPost(string $url, array $payload, array $headers): string {
		$ch = curl_init($url);
		if ($ch === false) {
			throw new Exception('Impossible d\'initialiser cURL');
		}

		curl_setopt_array($ch, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_POST => true,
			CURLOPT_HTTPHEADER => $headers,
			CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
			CURLOPT_TIMEOUT => 120,
			CURLOPT_CONNECTTIMEOUT => 10,
			CURLOPT_SSL_VERIFYPEER => true,
		]);

		$response = curl_exec($ch);
		$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		$curlError = curl_error($ch);
		curl_close($ch);

		if ($curlError) {
			throw new Exception('Erreur cURL : ' . $curlError);
		}

		if (!is_string($response) || empty($response)) {
			throw new Exception('Réponse vide du serveur (HTTP ' . $httpCode . ')');
		}

		return $response;
	}

	// ─── Mark articles as read ─────────────────────────────────────────────────

	private function markArticlesRead(array $ids): array {
		if (empty($ids)) {
			return ['success' => false, 'error' => 'Aucun ID fourni'];
		}

		try {
			$entryDAO = FreshRSS_Factory::createEntryDao();
			$affected = $entryDAO->markRead($ids, true);

			return [
				'success' => true,
				'affected' => $affected,
				'message' => $affected . ' article(s) marqué(s) comme lu(s)',
			];
		} catch (Exception $e) {
			Minz_Log::error('AIDigest::markArticlesRead error: ' . $e->getMessage());
			return ['success' => false, 'error' => $e->getMessage()];
		}
	}

	// ─── Email report ──────────────────────────────────────────────────────────

	private function sendEmailReport(string $get = 'a'): array {
		$emailTo = (string) $this->cfg('email_to', '');
		if (empty($emailTo)) {
			return ['success' => false, 'error' => 'Adresse email non configurée'];
		}

		try {
			$result = $this->generateSummary($get);
			if (!$result['success']) {
				return $result;
			}

		$summary  = $result['summary'];
		$count    = $result['count'];
		$articles = $result['articles'] ?? [];

		$htmlBody = $this->buildEmailHtml($summary, $count, $articles);

			$sent = $this->sendEmail(
				$emailTo,
				'Digest IA - ' . date('d/m/Y'),
				$htmlBody
			);

			if ($sent) {
				return ['success' => true, 'message' => 'Email envoyé à ' . $emailTo];
			}
			return ['success' => false, 'error' => 'Échec de l\'envoi de l\'email'];
		} catch (Exception $e) {
			Minz_Log::error('AIDigest::sendEmailReport error: ' . $e->getMessage());
			return ['success' => false, 'error' => $e->getMessage()];
		}
	}

	/** Convert a markdown table block to an HTML table. */
	private function markdownTableToHtml(string $block): string {
		$rows = array_filter(array_map('trim', explode("\n", trim($block))));
		$rows = array_values($rows);
		if (count($rows) < 2) return htmlspecialchars($block, ENT_QUOTES, 'UTF-8');

		$parseRow = function(string $row): array {
			$row = trim($row, '| ');
			return array_map('trim', explode('|', $row));
		};

		$heads = $parseRow($rows[0]);
		// rows[1] is the separator line (---|---), skip it
		$body  = array_slice($rows, 2);

		$html  = '<table class="vuln-table"><thead><tr>';
		foreach ($heads as $h) {
			$html .= '<th>' . htmlspecialchars($h, ENT_QUOTES, 'UTF-8') . '</th>';
		}
		$html .= '</tr></thead><tbody>';

		foreach ($body as $row) {
			$cells = $parseRow($row);
			// Detect severity for row class
			$scoreText = strtolower($cells[1] ?? '');
			if (str_contains($scoreText, 'critique'))   $cls = 'vuln-critique';
			elseif (str_contains($scoreText, 'élevé') || str_contains($scoreText, 'elev')) $cls = 'vuln-high';
			elseif (str_contains($scoreText, 'moyen'))  $cls = 'vuln-medium';
			elseif (str_contains($scoreText, 'faible')) $cls = 'vuln-low';
			else $cls = '';

			$html .= '<tr' . ($cls ? ' class="' . $cls . '"' : '') . '>';
			foreach ($cells as $cell) {
				$html .= '<td>' . htmlspecialchars($cell, ENT_QUOTES, 'UTF-8') . '</td>';
			}
			$html .= '</tr>';
		}
		$html .= '</tbody></table>';
		return $html;
	}

	/** Minimal Markdown → HTML converter for email (no external lib). */
	private function markdownToEmailHtml(string $md): string {
		// Split into blocks on double newlines
		$blocks = preg_split('/\n{2,}/', trim($md));
		$out = '';

		foreach ($blocks as $block) {
			$block = trim($block);
			if ($block === '') continue;

			// Fenced code block
			if (str_starts_with($block, '```')) {
				$inner = preg_replace('/^```[^\n]*\n?/', '', $block);
				$inner = preg_replace('/```$/', '', $inner);
				$out .= '<pre><code>' . htmlspecialchars(trim($inner), ENT_QUOTES, 'UTF-8') . '</code></pre>';
				continue;
			}

			// Markdown table (line contains | and second line is separator)
			$lines = explode("\n", $block);
			if (count($lines) >= 2 && str_contains($lines[0], '|') && preg_match('/^\|?[\s\-|:]+\|?$/', $lines[1])) {
				$out .= $this->markdownTableToHtml($block);
				continue;
			}

			// Heading
			if (preg_match('/^(#{1,3}) (.+)$/', $block, $m)) {
				$level = strlen($m[1]);
				$text  = htmlspecialchars($m[2], ENT_QUOTES, 'UTF-8');
				$out  .= "<h{$level}>{$text}</h{$level}>";
				continue;
			}

			// Unordered list
			if (preg_match('/^[-*] /m', $block)) {
				$items = preg_split('/\n/', $block);
				$out .= '<ul>';
				foreach ($items as $item) {
					$item = preg_replace('/^[-*] /', '', trim($item));
					$out .= '<li>' . $this->inlineMarkdown($item) . '</li>';
				}
				$out .= '</ul>';
				continue;
			}

			// Ordered list
			if (preg_match('/^\d+\. /m', $block)) {
				$items = preg_split('/\n/', $block);
				$out .= '<ol>';
				foreach ($items as $item) {
					$item = preg_replace('/^\d+\. /', '', trim($item));
					$out .= '<li>' . $this->inlineMarkdown($item) . '</li>';
				}
				$out .= '</ol>';
				continue;
			}

			// Paragraph (multi-line → join with space)
			$text = implode(' ', $lines);
			$out .= '<p>' . $this->inlineMarkdown($text) . '</p>';
		}

		return $out;
	}

	/** Apply inline markdown (bold, italic, links, code). */
	private function inlineMarkdown(string $text): string {
		$text = htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
		// Links [text](url) — unescape the URL
		$text = preg_replace_callback(
			'/\[([^\]]+)\]\(([^)]+)\)/',
			function($m) {
				$label = $m[1]; // already escaped via htmlspecialchars above
				$url   = htmlspecialchars_decode($m[2], ENT_QUOTES);
				$url   = filter_var($url, FILTER_SANITIZE_URL);
				return '<a href="' . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '" style="color:#667eea">' . $label . '</a>';
			},
			$text
		);
		$text = preg_replace('/\*\*(.+?)\*\*/', '<strong>$1</strong>', $text);
		$text = preg_replace('/\*(.+?)\*/',     '<em>$1</em>',         $text);
		$text = preg_replace('/`(.+?)`/',        '<code>$1</code>',     $text);
		return $text;
	}

	/** Localized date string based on configured language. */
	private function localizedDate(int $ts = 0): string {
		if ($ts === 0) $ts = time();
		$lang = strtolower((string) $this->cfg('language', 'French'));

		$data = [
			'french'     => ['days' => ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'],
			                 'months' => ['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'],
			                 'fmt' => '{day} {d} {month} {Y}'],
			'english'    => ['days' => ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
			                 'months' => ['','January','February','March','April','May','June','July','August','September','October','November','December'],
			                 'fmt' => '{day}, {month} {d}, {Y}'],
			'german'     => ['days' => ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'],
			                 'months' => ['','Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
			                 'fmt' => '{day}, {d}. {month} {Y}'],
			'spanish'    => ['days' => ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'],
			                 'months' => ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'],
			                 'fmt' => '{day} {d} de {month} de {Y}'],
			'italian'    => ['days' => ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'],
			                 'months' => ['','Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'],
			                 'fmt' => '{day} {d} {month} {Y}'],
			'portuguese' => ['days' => ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'],
			                 'months' => ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
			                 'fmt' => '{day}, {d} de {month} de {Y}'],
		];

		$d = $data[$lang] ?? $data['english'];
		$fmt = str_replace(
			['{day}', '{d}', '{month}', '{Y}'],
			[$d['days'][(int)date('w', $ts)], (int)date('j', $ts), $d['months'][(int)date('n', $ts)], date('Y', $ts)],
			$d['fmt']
		);
		return $fmt;
	}

	private function buildEmailHtml(string $summary, int $count, array $articles = []): string {
		$html = $this->markdownToEmailHtml($summary);
		$date = $this->localizedDate();

		// Build article links section
		$sourcesHtml = '';
		if (!empty($articles)) {
			$sourcesHtml = '<div class="sources"><h2>Articles analysés</h2><ul>';
			foreach ($articles as $art) {
				$title = htmlspecialchars($art['title'] ?? '', ENT_QUOTES, 'UTF-8');
				$link  = htmlspecialchars($art['link']  ?? '', ENT_QUOTES, 'UTF-8');
				if ($link) {
					$sourcesHtml .= '<li><a href="' . $link . '">' . $title . '</a></li>';
				} else {
					$sourcesHtml .= '<li>' . $title . '</li>';
				}
			}
			$sourcesHtml .= '</ul></div>';
		}

		return <<<HTML
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Digest IA — {$date}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f4f8; margin: 0; padding: 20px; color: #1a202c; }
  .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 40px; color: white; }
  .header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
  .header .meta { opacity: .85; font-size: 13px; }
  .badge { display: inline-block; background: rgba(255,255,255,0.2); border-radius: 20px; padding: 2px 10px; font-size: 12px; margin-left: 8px; vertical-align: middle; }
  .content { padding: 32px 40px; line-height: 1.7; }
  .content h1 { font-size: 20px; color: #2d3748; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-top: 0; }
  .content h2 { font-size: 16px; color: #4a5568; margin-top: 28px; margin-bottom: 6px; padding-left: 10px; border-left: 3px solid #667eea; }
  .content h3 { font-size: 14px; color: #718096; }
  .content p { color: #4a5568; margin: 8px 0; font-size: 14px; }
  .content ul, .content ol { color: #4a5568; font-size: 14px; padding-left: 20px; }
  .content a { color: #667eea; }
  /* Vulnerability table */
  .vuln-table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; font-size: 13px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
  .vuln-table th { background: #edf2f7; padding: 9px 12px; text-align: left; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #718096; border-bottom: 2px solid #e2e8f0; }
  .vuln-table td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .vuln-table tr:last-child td { border-bottom: none; }
  .vuln-critique { border-left: 4px solid #dc2626; } .vuln-critique td:nth-child(2) { color: #dc2626; font-weight: 700; }
  .vuln-high     { border-left: 4px solid #ea580c; } .vuln-high td:nth-child(2)     { color: #ea580c; font-weight: 700; }
  .vuln-medium   { border-left: 4px solid #d97706; } .vuln-medium td:nth-child(2)   { color: #d97706; font-weight: 600; }
  .vuln-low      { border-left: 4px solid #16a34a; } .vuln-low td:nth-child(2)      { color: #16a34a; font-weight: 600; }
  /* Sources */
  .sources { background: #f7fafc; border-top: 2px solid #e2e8f0; padding: 24px 40px; }
  .sources h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #718096; margin: 0 0 14px; }
  .sources ul { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px; }
  .sources li a { display: inline-block; padding: 4px 12px; background: #ebf4ff; border: 1px solid #bee3f8; border-radius: 20px; color: #3182ce; text-decoration: none; font-size: 12px; font-weight: 500; }
  .footer { background: #f7fafc; padding: 16px 40px; border-top: 1px solid #e2e8f0; text-align: center; color: #a0aec0; font-size: 11px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Digest IA <span class="badge">{$count} articles</span></h1>
    <div class="meta">{$date}</div>
  </div>
  <div class="content">
    {$html}
  </div>
  {$sourcesHtml}
  <div class="footer">
    Généré par FreshRSS AI Digest &bull; {$date}
  </div>
</div>
</body>
</html>
HTML;
	}

	private function sendEmail(string $to, string $subject, string $htmlBody): bool {
		$smtpHost = (string) $this->cfg('smtp_host', '');
		$emailFrom = (string) $this->cfg('email_from', 'freshrss@localhost');
		$emailFromName = (string) $this->cfg('email_from_name', 'FreshRSS AI Digest');

		if (!empty($smtpHost)) {
			return $this->sendEmailSmtp($to, $subject, $htmlBody);
		}

		// Fallback: PHP mail()
		$headers = [
			'MIME-Version: 1.0',
			'Content-Type: text/html; charset=UTF-8',
			'From: ' . $emailFromName . ' <' . $emailFrom . '>',
			'X-Mailer: FreshRSS AI Digest',
		];

		return mail($to, $subject, $htmlBody, implode("\r\n", $headers));
	}

	private function sendEmailSmtp(string $to, string $subject, string $htmlBody): bool {
		$host      = (string) $this->cfg('smtp_host', '');
		$port      = (int)    $this->cfg('smtp_port', 587);
		$user      = (string) $this->cfg('smtp_user', '');
		$pass      = (string) $this->cfg('smtp_pass', '');
		$tls       = (bool)   $this->cfg('smtp_tls', true);
		$from      = (string) $this->cfg('email_from', 'freshrss@localhost');
		$fromName  = (string) $this->cfg('email_from_name', 'FreshRSS AI Digest');
		$ehlo      = gethostname() ?: 'localhost';

		// Port 465 = SMTPS (SSL dès la connexion)
		// Port 587/25 = STARTTLS (connexion TCP puis upgrade)
		$isSmtps = ($port === 465);
		$prefix  = $isSmtps ? 'ssl://' : '';

		$context = stream_context_create([
			'ssl' => [
				'verify_peer'       => true,
				'verify_peer_name'  => true,
				'allow_self_signed' => false,
			],
		]);

		$socket = @stream_socket_client(
			$prefix . $host . ':' . $port,
			$errno, $errstr, 15,
			STREAM_CLIENT_CONNECT, $context
		);

		if (!$socket) {
			throw new Exception('SMTP connexion échouée : ' . ($errstr ?: 'hôte inaccessible') . ' (code ' . $errno . ')');
		}

		stream_set_timeout($socket, 15);

		$recv = function() use ($socket): string {
			$response = '';
			while ($line = fgets($socket, 512)) {
				$response .= $line;
				if (isset($line[3]) && $line[3] === ' ') {
					break;
				}
			}
			return $response;
		};

		$send = function(string $cmd) use ($socket): void {
			fputs($socket, $cmd . "\r\n");
		};

		$recv(); // banner serveur
		$send('EHLO ' . $ehlo);
		$recv();

		// STARTTLS sur port 587 (ou tout port non-465 avec TLS activé)
		if ($tls && !$isSmtps) {
			$send('STARTTLS');
			$res = $recv();
			if (!str_starts_with(trim($res), '220')) {
				throw new Exception('STARTTLS refusé par le serveur : ' . trim($res));
			}
			if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
				throw new Exception('Négociation TLS échouée');
			}
			// Ré-identifier après STARTTLS
			$send('EHLO ' . $ehlo);
			$recv();
		}

		// Authentification
		if (!empty($user) && !empty($pass)) {
			$send('AUTH LOGIN');
			$recv();
			$send(base64_encode($user));
			$recv();
			$send(base64_encode($pass));
			$authResp = $recv();
			if (!str_starts_with(trim($authResp), '235')) {
				throw new Exception('SMTP authentification échouée : ' . trim($authResp));
			}
		}

		$fromDomain = substr(strrchr($from, '@') ?: '@freshrss.local', 1);
		$messageId  = '<' . time() . '.' . random_int(100000, 999999) . '@' . $fromDomain . '>';
		$boundary   = 'b_' . bin2hex(random_bytes(12));

		// Plain-text fallback (required by anti-spam filters)
		$plainText = wordwrap(
			html_entity_decode(strip_tags(str_replace(['</p>', '<br>', '<br/>', '<br />', '</li>', '</tr>'], "\n", $htmlBody)), ENT_QUOTES, 'UTF-8'),
			76, "\n", true
		);

		$message = implode("\r\n", [
			'MIME-Version: 1.0',
			'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
			'From: =?UTF-8?B?' . base64_encode($fromName) . '?= <' . $from . '>',
			'To: ' . $to,
			'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
			'Message-ID: ' . $messageId,
			'Date: ' . date('r'),
			'X-Mailer: FreshRSS AI Digest',
			'',
			'--' . $boundary,
			'Content-Type: text/plain; charset=UTF-8',
			'Content-Transfer-Encoding: quoted-printable',
			'',
			quoted_printable_encode($plainText),
			'',
			'--' . $boundary,
			'Content-Type: text/html; charset=UTF-8',
			'Content-Transfer-Encoding: quoted-printable',
			'',
			quoted_printable_encode($htmlBody),
			'',
			'--' . $boundary . '--',
		]);

		$send('MAIL FROM:<' . $from . '>');
		$recv();
		$send('RCPT TO:<' . $to . '>');
		$recv();
		$send('DATA');
		$recv();
		// Dot-stuffing: any line starting with "." must be doubled per RFC 5321
		$stuffed = preg_replace('/\r\n\./', "\r\n..", $message);
		fputs($socket, $stuffed . "\r\n.\r\n");
		$dataResp = $recv();
		$send('QUIT');
		fclose($socket);

		if (!str_starts_with(trim($dataResp), '250')) {
			throw new Exception('Envoi rejeté par le serveur : ' . trim($dataResp));
		}

		return true;
	}

	// ─── Cron entrypoint ──────────────────────────────────────────────────────

	/**
	 * Called automatically by FreshRSS during each feed refresh cycle.
	 * Sends the email report if the configured schedule and hour match,
	 * and no report has been sent yet during this time window.
	 */
	public function onUserMaintenance(): void {
		$schedule = (string) $this->cfg('email_schedule', 'never');
		if ($schedule === 'never' || !(bool) $this->cfg('email_enabled', false)) {
			return;
		}

		$targetHour  = (int) $this->cfg('email_hour', 8);
		$currentHour = (int) date('G');
		if ($currentHour !== $targetHour) {
			return;
		}

		if ($schedule === 'weekly' && date('N') !== '1') { // lundi uniquement
			return;
		}

		// Prevent duplicate sends: skip if already sent within this hour window
		$lastSent = (int) $this->cfg('email_last_sent', 0);
		$windowStart = mktime($targetHour, 0, 0);
		if ($lastSent >= $windowStart) {
			return;
		}

		$result = $this->sendEmailReport('a');

		if ($result['success']) {
			$config = $this->getSystemConfiguration();
			$config['email_last_sent'] = time();
			$this->setSystemConfiguration($config);
			Minz_Log::notice('AIDigest: rapport email envoyé automatiquement.');
		} else {
			Minz_Log::error('AIDigest: échec du rapport email automatique — ' . ($result['error'] ?? '?'));
		}
	}
}
