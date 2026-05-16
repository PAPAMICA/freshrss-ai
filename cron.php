<?php

/**
 * AI Digest — Cron script
 *
 * Sends the automated AI digest email report.
 * Respects the schedule configured in the extension settings.
 *
 * Setup (crontab -e):
 *   0 8 * * * www-data php /path/to/freshrss/extensions/xExtension-AIDigest/cron.php >> /var/log/freshrss-ai-digest.log 2>&1
 *
 * With a specific user:
 *   0 8 * * * www-data php /path/to/freshrss/extensions/xExtension-AIDigest/cron.php myusername
 *
 * Or via environment variable:
 *   FRESHRSS_USER=myusername php /path/to/freshrss/extensions/xExtension-AIDigest/cron.php
 */

declare(strict_types=1);

// ─── Find FreshRSS root ───────────────────────────────────────────────────────

$dir = __DIR__;
$freshrssRoot = null;

for ($i = 0; $i < 8; $i++) {
	$dir = dirname($dir);
	if (file_exists($dir . '/constants.php') && file_exists($dir . '/cli')) {
		$freshrssRoot = $dir;
		break;
	}
}

if ($freshrssRoot === null) {
	fwrite(STDERR, "[AI Digest] ERREUR: Impossible de trouver la racine FreshRSS.\n");
	fwrite(STDERR, "Assurez-vous que l'extension est dans le dossier extensions/ de FreshRSS.\n");
	exit(1);
}

// ─── Bootstrap FreshRSS ───────────────────────────────────────────────────────

define('STDIN_DEFINED', true); // Prevent interactive prompts

chdir($freshrssRoot);

require_once $freshrssRoot . '/constants.php';
require_once LIB_PATH . '/lib_rss.php';

// Determine user
$username = (string)(getenv('FRESHRSS_USER') ?: ($argv[1] ?? ''));

if (empty($username)) {
	// Try to get default user from system config
	try {
		$systemConf = FreshRSS_Context::initSystem(true);
		$username = FreshRSS_Context::systemConf()->default_user ?? '';
	} catch (Exception $e) {
		fwrite(STDERR, "[AI Digest] ERREUR lors du chargement de la configuration système: " . $e->getMessage() . "\n");
		exit(1);
	}
}

if (empty($username)) {
	fwrite(STDERR, "[AI Digest] ERREUR: Aucun utilisateur spécifié.\n");
	fwrite(STDERR, "Usage: php cron.php <username>\n");
	fwrite(STDERR, "Ou: FRESHRSS_USER=<username> php cron.php\n");
	exit(1);
}

try {
	FreshRSS_Context::initUser($username);
} catch (Exception $e) {
	fwrite(STDERR, "[AI Digest] ERREUR lors de l'initialisation de l'utilisateur '$username': " . $e->getMessage() . "\n");
	exit(1);
}

// ─── Load extensions ──────────────────────────────────────────────────────────

try {
	Minz_ExtensionManager::init();
	$systemExtList = FreshRSS_Context::systemConf()->attributeArray('extensions_enabled') ?? [];
	Minz_ExtensionManager::enableByList($systemExtList, 'system');
} catch (Exception $e) {
	fwrite(STDERR, "[AI Digest] ERREUR lors du chargement des extensions: " . $e->getMessage() . "\n");
	exit(1);
}

/** @var AIDigestExtension|null $extension */
$extension = Minz_ExtensionManager::findExtension('AI Digest');

if (!$extension instanceof AIDigestExtension) {
	fwrite(STDERR, "[AI Digest] ERREUR: Extension 'AI Digest' introuvable ou non activée.\n");
	fwrite(STDERR, "Vérifiez qu'elle est bien activée dans Administration → Extensions.\n");
	exit(1);
}

// ─── Run the cron ─────────────────────────────────────────────────────────────

$timestamp = date('Y-m-d H:i:s');
echo "[AI Digest] {$timestamp} — Utilisateur: {$username}\n";
echo "[AI Digest] {$timestamp} — Vérification de la planification…\n";

try {
	$extension->runCron();
	echo "[AI Digest] {$timestamp} — Terminé.\n";
} catch (Exception $e) {
	fwrite(STDERR, "[AI Digest] {$timestamp} ERREUR: " . $e->getMessage() . "\n");
	exit(1);
}

exit(0);
