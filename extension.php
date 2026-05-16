<?php

declare(strict_types=1);

class AIDigestExtension extends Minz_Extension {

	private const DEFAULT_PROMPT = 'You are an experienced news editor.

Your task is to analyze multiple news articles coming from RSS feeds and produce a concise and clear news digest in French.

Instructions:
- Group and merge articles covering the same topic or event.
- Avoid duplicates and repetitive information.
- Prioritize the most important and impactful news.
- Keep a neutral and professional journalistic tone.
- Write in fluent natural French.
- Create short sections with a title for each major topic.
- Mention important facts, companies, countries, products, or people involved.
- If multiple sources discuss the same event, synthesize them into a single coherent summary.
- Ignore advertisements, sponsored content, and irrelevant details.
- Keep the final output concise but informative.

Output format:
- One main title (use # Title)
- Then multiple sections:
  ## Topic title
  Short summarized paragraph

Articles:
{{ARTICLES}}';

	public function init(): void {
		$this->registerHook('freshrss_init', [$this, 'onFreshRSSInit']);
		$this->registerHook('nav_menu', [$this, 'renderNavButton']);

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
			. 'title="Résumer les articles non lus avec l\'IA" onclick="(window._aidOpen||function(){})();return false;">'
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
			state: FreshRSS_Entry::STATE_UNREAD,
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

		$articlesJson = [];
		foreach ($entries as $entry) {
			$articlesJson[] = [
				'source' => $entry['feed'],
				'title' => $entry['title'],
				'content' => $entry['content'],
			];
		}

		$articlesText = json_encode($articlesJson, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
		return str_replace('{{ARTICLES}}', $articlesText, $promptTemplate);
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

			$summary = $result['summary'];
			$count = $result['count'];

			$htmlBody = $this->buildEmailHtml($summary, $count);

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

	private function buildEmailHtml(string $summary, int $count): string {
		// Convert markdown-like headings to HTML for the email
		$html = htmlspecialchars($summary, ENT_QUOTES, 'UTF-8');
		$html = preg_replace('/^# (.+)$/m', '<h1>$1</h1>', $html);
		$html = preg_replace('/^## (.+)$/m', '<h2>$1</h2>', $html);
		$html = preg_replace('/^### (.+)$/m', '<h3>$1</h3>', $html);
		$html = preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $html);
		$html = preg_replace('/\*(.+?)\*/s', '<em>$1</em>', $html);
		$html = nl2br($html);

		$date = date('l d F Y', time());

		return <<<HTML
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Digest IA - {$date}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; margin: 0; padding: 20px; color: #1a202c; }
  .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 40px; color: white; }
  .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
  .header .meta { margin-top: 8px; opacity: 0.85; font-size: 14px; }
  .badge { display: inline-block; background: rgba(255,255,255,0.2); border-radius: 20px; padding: 3px 12px; font-size: 12px; margin-left: 8px; }
  .content { padding: 32px 40px; line-height: 1.7; }
  .content h1 { font-size: 22px; color: #2d3748; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-top: 0; }
  .content h2 { font-size: 18px; color: #4a5568; margin-top: 28px; margin-bottom: 8px; }
  .content h3 { font-size: 16px; color: #718096; }
  .content p { color: #4a5568; margin: 8px 0; }
  .footer { background: #f7fafc; padding: 20px 40px; border-top: 1px solid #e2e8f0; text-align: center; color: #a0aec0; font-size: 12px; }
  .footer a { color: #667eea; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="header-icon">🧠</div>
    <h1>Digest IA<span class="badge">{$count} articles</span></h1>
    <div class="meta">{$date}</div>
  </div>
  <div class="content">
    {$html}
  </div>
  <div class="footer">
    Généré automatiquement par <a href="#">FreshRSS AI Digest</a>
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
		$host = (string) $this->cfg('smtp_host', '');
		$port = (int) $this->cfg('smtp_port', 587);
		$user = (string) $this->cfg('smtp_user', '');
		$pass = (string) $this->cfg('smtp_pass', '');
		$tls = (bool) $this->cfg('smtp_tls', true);
		$from = (string) $this->cfg('email_from', 'freshrss@localhost');
		$fromName = (string) $this->cfg('email_from_name', 'FreshRSS AI Digest');

		$prefix = $tls ? 'tls://' : '';
		$socket = @fsockopen($prefix . $host, $port, $errno, $errstr, 10);

		if (!$socket) {
			throw new Exception('SMTP connexion échouée : ' . $errstr . ' (' . $errno . ')');
		}

		$boundary = md5((string) time());
		$messageId = '<' . time() . '.' . rand() . '@freshrss>';

		$headers = implode("\r\n", [
			'MIME-Version: 1.0',
			'Content-Type: text/html; charset=UTF-8',
			'From: =?UTF-8?B?' . base64_encode($fromName) . '?= <' . $from . '>',
			'To: ' . $to,
			'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
			'Message-ID: ' . $messageId,
			'Date: ' . date('r'),
		]);

		$recv = function() use ($socket) {
			$response = '';
			while ($line = fgets($socket, 515)) {
				$response .= $line;
				if (substr($line, 3, 1) === ' ') {
					break;
				}
			}
			return $response;
		};

		$send = function(string $cmd) use ($socket) {
			fputs($socket, $cmd . "\r\n");
		};

		$recv(); // banner
		$send('EHLO ' . gethostname());
		$recv();

		if (!empty($user) && !empty($pass)) {
			$send('AUTH LOGIN');
			$recv();
			$send(base64_encode($user));
			$recv();
			$send(base64_encode($pass));
			$recv();
		}

		$send('MAIL FROM:<' . $from . '>');
		$recv();
		$send('RCPT TO:<' . $to . '>');
		$recv();
		$send('DATA');
		$recv();
		$send($headers . "\r\n\r\n" . $htmlBody . "\r\n.");
		$recv();
		$send('QUIT');
		fclose($socket);

		return true;
	}

	// ─── Cron entrypoint ──────────────────────────────────────────────────────

	/**
	 * Called by cron.php to send the daily/weekly report.
	 * Usage: php path/to/freshrss/extensions/xExtension-AIDigest/cron.php
	 */
	public function runCron(): void {
		$schedule = (string) $this->cfg('email_schedule', 'never');
		$hour = (int) $this->cfg('email_hour', 8);
		$currentHour = (int) date('G');

		if ($schedule === 'never') {
			return;
		}

		if ($currentHour !== $hour) {
			return;
		}

		if ($schedule === 'weekly' && date('N') !== '1') { // Monday only
			return;
		}

		$this->sendEmailReport('a');
	}
}
