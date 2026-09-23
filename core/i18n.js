// @ts-check
// Small core-side translator for short labels and validation messages returned to the renderer.
const { CONFIG } = require('./config');

const MESSAGES = {
  fr: { untitled:'Sans titre', failed:'Échec', setupRunning:'Installation déjà en cours', setupMissing:'setup.ps1 introuvable', setupWindows:'Installation automatique disponible uniquement sous Windows', setupStart:'Démarrage de l’installation…', setupDone:'Installation terminée', folderMissing:'Dossier introuvable' },
  en: { untitled:'Untitled', failed:'Failed', setupRunning:'Installation already in progress', setupMissing:'setup.ps1 not found', setupWindows:'Automatic installation is only available on Windows', setupStart:'Starting installation…', setupDone:'Installation complete', folderMissing:'Folder not found' },
  es: { untitled:'Sin título', failed:'Error', setupRunning:'Ya hay una instalación en curso', setupMissing:'No se encontró setup.ps1', setupWindows:'La instalación automática solo está disponible en Windows', setupStart:'Iniciando la instalación…', setupDone:'Instalación completada', folderMissing:'No se encontró la carpeta' },
  de: { untitled:'Ohne Titel', failed:'Fehlgeschlagen', setupRunning:'Installation läuft bereits', setupMissing:'setup.ps1 wurde nicht gefunden', setupWindows:'Die automatische Installation ist nur unter Windows verfügbar', setupStart:'Installation wird gestartet…', setupDone:'Installation abgeschlossen', folderMissing:'Ordner nicht gefunden' },
  ja: { untitled:'無題', failed:'失敗', setupRunning:'インストールがすでに進行中です', setupMissing:'setup.ps1 が見つかりません', setupWindows:'自動インストールは Windows でのみ利用できます', setupStart:'インストールを開始しています…', setupDone:'インストールが完了しました', folderMissing:'フォルダーが見つかりません' },
  zh: { untitled:'无标题', failed:'失败', setupRunning:'安装已在进行中', setupMissing:'找不到 setup.ps1', setupWindows:'自动安装仅支持 Windows', setupStart:'正在开始安装…', setupDone:'安装完成', folderMissing:'找不到文件夹' }
};

// Additional short messages returned through RPC. Array order: fr, en, es, de, ja, zh.
const EXTRA = {
  sourceMissing: ['Aucune source choisie','No source selected','No se ha seleccionado ninguna fuente','Keine Quelle ausgewählt','ソースが選択されていません','未选择源文件'],
  outputFolderMissing: ['Aucun dossier de sortie choisi','No output folder selected','No se ha seleccionado ninguna carpeta de salida','Kein Ausgabeordner ausgewählt','出力フォルダーが選択されていません','未选择输出文件夹'],
  invalidImageParams: ['Réglages de l’image incomplets','Incomplete image settings','Faltan ajustes de imagen','Unvollständige Bildeinstellungen','画像設定が不完全です','图像设置不完整'],
  invalidGifParams: ['Réglages du GIF incomplets','Incomplete GIF settings','Faltan ajustes de GIF','Unvollständige GIF-Einstellungen','GIF 設定が不完全です','GIF 设置不完整'],
  unknownJob: ['Tâche inconnue ou expirée','Unknown or expired task','Tarea desconocida o caducada','Unbekannte oder abgelaufene Aufgabe','不明または期限切れのタスクです','任务未知或已过期'],
  emptyResult: ['Résultat vide','Empty result','Resultado vacío','Leeres Ergebnis','結果が空です','结果为空'],
  unknownApp: ['Application inconnue','Unknown application','Aplicación desconocida','Unbekannte Anwendung','不明なアプリケーションです','未知应用'],
  panelDisconnected: ['Panneau non connecté','Panel is not connected','El panel no está conectado','Panel ist nicht verbunden','パネルが接続されていません','面板未连接'],
  panelTimeout: ['Le panneau NetsuBoard ne répond pas. Vérifie qu’il est ouvert dans l’application Adobe.','The NetsuBoard panel is not responding. Check that it is open in the Adobe application.','El panel de NetsuBoard no responde. Comprueba que está abierto en la aplicación de Adobe.','Das NetsuBoard-Panel antwortet nicht. Prüfe, ob es in der Adobe-Anwendung geöffnet ist.','NetsuBoard パネルが応答しません。Adobe アプリケーションでパネルが開いているか確認してください。','NetsuBoard 面板无响应。请确认它已在 Adobe 应用中打开。'],
  targetAppMissing: ['Aucune application cible choisie','No target application selected','No se ha seleccionado ninguna aplicación de destino','Keine Zielanwendung ausgewählt','対象アプリケーションが選択されていません','未选择目标应用'],
  invalidSnapshot: ['Instantané invalide','Invalid snapshot','Instantánea no válida','Ungültiger Snapshot','スナップショットが無効です','快照无效'],
  applicationMissing: ['Application introuvable','Application not found','No se encontró la aplicación','Anwendung nicht gefunden','アプリケーションが見つかりません','找不到应用'],
  panelSourceMissing: ['Fichiers du panneau introuvables','Panel files not found','No se encontraron los archivos del panel','Panel-Dateien nicht gefunden','パネルのファイルが見つかりません','找不到面板文件'],
  panelCopyFailed: ['Impossible de copier le panneau','Could not copy the panel','No se pudo copiar el panel','Das Panel konnte nicht kopiert werden','パネルをコピーできませんでした','无法复制面板'],
  webhookMissing: ['Webhook non configuré','Webhook is not configured','El webhook no está configurado','Webhook ist nicht konfiguriert','Webhook が設定されていません','Webhook 未配置'],
  reportSent: ['Rapport envoyé. Merci !','Report sent. Thank you!','Informe enviado. ¡Gracias!','Bericht gesendet. Vielen Dank!','レポートを送信しました。ありがとうございます！','报告已发送，谢谢！'],
  reportSendFailed: ['Impossible d’envoyer le rapport','Could not send the report','No se pudo enviar el informe','Bericht konnte nicht gesendet werden','レポートを送信できませんでした','报告发送失败'],
  reportRateLimited: ['Trop de rapports envoyés récemment. Réessaie dans une heure.','Too many reports sent recently. Try again in an hour.','Has enviado demasiados informes. Vuelve a intentarlo en una hora.','Zu viele Berichte gesendet. Versuche es in einer Stunde erneut.','レポートの送信が多すぎます。1 時間後にもう一度お試しください。','最近发送的报告过多，请一小时后再试。'],
  exportProfileMissing: ['Aucun profil d’export choisi','No export profile selected','No se ha seleccionado ningún perfil de exportación','Kein Exportprofil ausgewählt','書き出しプロファイルが選択されていません','未选择导出配置'],
  targetNotFolder: ['La cible n’est pas un dossier','The target is not a folder','El destino no es una carpeta','Das Ziel ist kein Ordner','対象はフォルダーではありません','目标不是文件夹'],
  unknownModel: ['Modèle inconnu','Unknown model','Modelo desconocido','Unbekanntes Modell','不明なモデルです','未知模型'],
  noDownload: ['Aucun téléchargement en cours','No download in progress','No hay ninguna descarga en curso','Kein Download läuft','進行中のダウンロードはありません','没有正在进行的下载'],
  notFound: ['Introuvable','Not found','No se encontró','Nicht gefunden','見つかりません','找不到'],
  invalidUrl: ['URL invalide','Invalid URL','URL no válida','Ungültige URL','URL が無効です','URL 无效'],
  sceneInvalid: ['Contenu du board illisible','Board content could not be read','No se puede leer el contenido del tablero','Board-Inhalt kann nicht gelesen werden','ボードの内容を読み込めません','无法读取画板内容'],
  destinationMissing: ['Aucune destination choisie','No destination selected','No se ha elegido ningún destino','Kein Ziel ausgewählt','保存先が選択されていません','未选择保存位置'],
  invalidArchive: ['Archive invalide ou non reconnue','Invalid or unrecognized archive','Archivo no válido o no reconocido','Ungültiges oder unbekanntes Archiv','アーカイブが無効か認識できません','存档无效或无法识别'],
  noShotsExport: ['Aucun plan à exporter','No shots to export','No hay planos para exportar','Keine Shots zum Exportieren','書き出すショットがありません','没有可导出的镜头'],
  exportFailed: ['Échec de l’export','Export failed','Falló la exportación','Export fehlgeschlagen','書き出しに失敗しました','导出失败'],
  libraryModelLocked: ['Impossible de supprimer ce modèle : il est fourni par une bibliothèque','This model comes with a library and cannot be removed','No se puede eliminar este modelo: viene incluido en una biblioteca','Dieses Modell gehört zu einer Bibliothek und kann nicht entfernt werden','このモデルはライブラリに含まれているため削除できません','此模型由库提供，无法删除'],
  exclusiveInstalled: ['Un seul de ces modèles peut être installé à la fois','Only one of these models can be installed at a time','Solo uno de estos modelos puede estar instalado a la vez','Nur eines dieser Modelle kann gleichzeitig installiert sein','これらのモデルは同時に 1 つしかインストールできません','这些模型同一时间只能安装一个'],
  sam2WeightsFirst: ['Installe d’abord un modèle SAM 2.1 : ce moteur n’apporte que le code et utilise les poids du modèle','Install a SAM 2.1 model first: this engine only ships the code and uses the model’s weights','Instala primero un modelo SAM 2.1: este motor solo aporta el código y usa los pesos del modelo','Installiere zuerst ein SAM-2.1-Modell: Diese Engine liefert nur den Code und nutzt die Gewichte des Modells','先に SAM 2.1 モデルをインストールしてください。このエンジンはコードのみで、モデルの重みを使用します','请先安装 SAM 2.1 模型：该引擎只提供代码，需使用该模型的权重'],
  unsupportedSource: ['Source non prise en charge','Unsupported source','Fuente no compatible','Nicht unterstützte Quelle','対応していないソースです','不支持的来源'],
  unreadableFile: ['Fichier illisible','Unreadable file','Archivo ilegible','Datei nicht lesbar','ファイルを読み込めません','文件无法读取'],
  unknownFormat: ['Format de fichier inconnu','Unknown file format','Formato de archivo desconocido','Unbekanntes Dateiformat','不明なファイル形式です','未知文件格式'],
  missingArchiveFile: ['Fichier requis absent de l’archive','Required file is missing from the archive','Falta un archivo necesario dentro del archivo comprimido','Erforderliche Datei fehlt im Archiv','アーカイブに必要なファイルがありません','存档中缺少必需文件'],
  localMediaRequired: ['Un fichier média local est requis','A local media file is required','Se necesita un archivo multimedia local','Eine lokale Mediendatei ist erforderlich','ローカルのメディアファイルが必要です','需要本地媒体文件'],
  noFrames: ['Aucune image extraite','No frames were extracted','No se extrajo ninguna imagen','Keine Frames extrahiert','画像を抽出できませんでした','未提取到任何帧'],
  targetMissing: ['Aucune cible choisie','No target selected','No se ha seleccionado ningún destino','Kein Ziel ausgewählt','対象が選択されていません','未选择目标'],
  databaseMissing: ['Base de données introuvable','Database not found','No se encontró la base de datos','Datenbank nicht gefunden','データベースが見つかりません','找不到数据库'],
  pathMissing: ['Chemin manquant','Path is missing','Falta la ruta','Pfad fehlt','パスがありません','缺少路径'],
  unsupportedType: ['Type non pris en charge','Unsupported type','Tipo no compatible','Nicht unterstützter Typ','対応していない形式です','不支持的类型'],
  noMediaDetected: ['Aucun média détecté sur la page','No media found on the page','No se detectó ningún contenido multimedia en la página','Keine Medien auf der Seite gefunden','ページにメディアが見つかりません','页面上未检测到媒体'],
  videoDimensionsMissing: ['Dimensions vidéo introuvables','Video dimensions not found','No se encontraron las dimensiones del vídeo','Videodimensionen nicht gefunden','動画のサイズを取得できません','找不到视频尺寸'],
  adobeDebugModeFailed: ['Mode de débogage Adobe non activé : l’extension non signée sera refusée','Adobe debug mode was not enabled: the unsigned extension will be rejected','No se activó el modo de depuración de Adobe: se rechazará la extensión sin firmar','Adobe-Debugmodus wurde nicht aktiviert: Die unsignierte Erweiterung wird abgelehnt','Adobe のデバッグモードを有効にできませんでした。未署名の拡張機能は拒否されます','未启用 Adobe 调试模式：未签名扩展将被拒绝'],
  rendererMissing: ['Interface non construite : lance npm run build','The interface is not built: run npm run build','La interfaz no está compilada: ejecuta npm run build','Die Oberfläche wurde nicht gebaut: Führe npm run build aus','インターフェースがビルドされていません。npm run build を実行してください','界面尚未构建：请运行 npm run build'],
  extractToolsMissing: ['Outils de téléchargement des médias absents','Media download tools are missing','Faltan las herramientas de descarga multimedia','Werkzeuge zum Herunterladen von Medien fehlen','メディア取得ツールがありません','缺少媒体下载工具'],
  openGraphFailed: ['Impossible de récupérer le média de la page','Could not retrieve media from the page','No se pudo recuperar el contenido multimedia de la página','Medien konnten nicht von der Seite abgerufen werden','ページからメディアを取得できませんでした','无法从页面获取媒体'],
  turboFrameUnsupported: ['RTX VSR ne sait pas rendre une image de test : lance l’upscale pour juger du résultat.','RTX VSR cannot render a test frame: run the upscale to judge the result.','RTX VSR no puede generar una imagen de prueba: ejecuta el escalado para ver el resultado.','RTX VSR kann kein Testbild rendern: Starte das Upscaling, um das Ergebnis zu sehen.','RTX VSR はテスト画像を生成できません。アップスケールを実行して結果を確認してください。','RTX VSR 无法生成测试帧：请运行超分辨率以查看结果。'],
  turboGifUnsupported: ['Impossible d’upscaler un GIF animé : le moteur ne rendrait que sa première image.','An animated GIF cannot be upscaled: the engine would only render its first frame.','Un GIF animado no puede escalarse: el motor solo generaría su primer fotograma.','Ein animiertes GIF kann nicht hochskaliert werden: Die Engine würde nur das erste Bild ausgeben.','アニメーション GIF はアップスケールできません。エンジンは最初のフレームしか出力しません。','动态 GIF 无法进行超分辨率处理：引擎只会输出第一帧。'],
  sdkArchiveMissing: ['Archive du SDK introuvable. La page NVIDIA vient de s’ouvrir : télécharge le zip, puis relance l’installation, NetsuBoard s’occupe du reste.','SDK archive not found. The NVIDIA page just opened: download the zip, then install again and NetsuBoard does the rest.','No se encontró el archivo del SDK. Se acaba de abrir la página de NVIDIA: descarga el zip y vuelve a instalar; NetsuBoard se encarga del resto.','SDK-Archiv nicht gefunden. Die NVIDIA-Seite wurde geöffnet: Lade das ZIP herunter und installiere erneut, NetsuBoard erledigt den Rest.','SDK のアーカイブが見つかりません。NVIDIA のページを開きました。zip をダウンロードしてもう一度インストールすると、残りは NetsuBoard が行います。','未找到 SDK 压缩包。已打开 NVIDIA 页面：下载 zip 后重新安装，其余由 NetsuBoard 自动完成。'],
  rtxCliMissing: ['RTXVideoProcessor n’est pas installé. Installe-le dans Paramètres › Modèle.','RTXVideoProcessor is not installed. Install it in Settings › Model.','RTXVideoProcessor no está instalado. Instálalo en Ajustes › Modelo.','RTXVideoProcessor ist nicht installiert. Installiere es unter Einstellungen › Modell.','RTXVideoProcessor がインストールされていません。「設定 › モデル」でインストールしてください。','未安装 RTXVideoProcessor。请在“设置 › 模型”中安装。'],
  rtxDllMissing: ['DLL du RTX Video SDK absentes (NVIDIA interdit de les redistribuer, copie-les toi-même)','RTX Video SDK DLLs are missing (NVIDIA does not allow redistributing them, copy them yourself)','Faltan las DLL del RTX Video SDK (NVIDIA no permite redistribuirlas, cópialas tú)','DLLs des RTX Video SDK fehlen (NVIDIA erlaubt keine Weitergabe, kopiere sie selbst)','RTX Video SDK の DLL がありません（NVIDIA が再配布を認めていないため、手動でコピーしてください）','缺少 RTX Video SDK 的 DLL（NVIDIA 不允许再分发，请自行复制）'],
  rtxScaleFixed: ['RTX VSR ne fait que du 2× : choisis l’échelle 2×','RTX VSR only upscales 2×: pick the 2× scale','RTX VSR solo escala a 2×: elige la escala 2×','RTX VSR skaliert nur um 2×: Wähle den Faktor 2×','RTX VSR の拡大率は 2× 固定です。2× を選択してください','RTX VSR 只支持 2× 放大：请选择 2×'],
  rtxInputTooLarge: ['RTX VSR n’accepte pas les sources de 1440p ou plus','RTX VSR does not accept sources at 1440p or above','RTX VSR no acepta fuentes de 1440p o superiores','RTX VSR akzeptiert keine Quellen ab 1440p','RTX VSR は 1440p 以上のソースに対応していません','RTX VSR 不支持 1440p 及以上的源'],
  downloadFailed: ['Échec du téléchargement','Download failed','Falló la descarga','Download fehlgeschlagen','ダウンロードに失敗しました','下载失败'],
  preparationFailed: ['Échec de la préparation','Preparation failed','Falló la preparación','Vorbereitung fehlgeschlagen','準備に失敗しました','准备失败'],
  installationFailed: ['Échec de l’installation','Installation failed','Falló la instalación','Installation fehlgeschlagen','インストールに失敗しました','安装失败'],
  unavailable: ['Indisponible','Unavailable','No disponible','Nicht verfügbar','利用できません','不可用'],
  pyRuntimeBroken: ['Paquet déjà installé mais impossible à charger (l’environnement Python est à réparer)','Package already installed but cannot be loaded (the Python environment needs repair)','El paquete ya está instalado pero no se puede cargar (hay que reparar el entorno de Python)','Paket ist installiert, lässt sich aber nicht laden (die Python-Umgebung muss repariert werden)','パッケージは導入済みですが読み込めません（Python 環境の修復が必要です）','软件包已安装但无法加载（需要修复 Python 环境）'],
  engineStalled: ['Le moteur ne répond plus : aucune progression depuis trop longtemps.','The engine stopped responding: no progress for too long.','El motor dejó de responder: no hay progreso desde hace demasiado tiempo.','Die Engine reagiert nicht mehr: zu lange kein Fortschritt.','エンジンが応答しません。長時間進行がありません。','引擎无响应：长时间没有进度。'],
  engineOutputUnreadable: ['Réponse du moteur illisible','The engine\'s response could not be read','No se pudo leer la respuesta del motor','Antwort der Engine ist nicht lesbar','エンジンの応答を読み取れません','无法读取引擎的响应'],
  engineSilentFor: ['aucune réponse pendant {seconds} s','no response for {seconds} s','sin respuesta durante {seconds} s','keine Antwort seit {seconds} s','{seconds} 秒間応答なし','{seconds} 秒无响应'],
  engineUnexpectedExit: ['arrêt inattendu','unexpected exit','cierre inesperado','unerwartet beendet','予期せず終了','意外退出'],
  detectEngineStopped: ['Le moteur de détection s’est arrêté','The detection engine stopped','El motor de detección se detuvo','Die Erkennungs-Engine wurde beendet','検出エンジンが停止しました','检测引擎已停止'],
  detectEngineUnavailable: ['Le moteur de détection ne démarre pas','The detection engine did not start','El motor de detección no se inicia','Die Erkennungs-Engine startet nicht','検出エンジンを起動できません','检测引擎无法启动'],
  searchEngineStopped: ['Moteur de recherche interrompu ({cause})','The search engine stopped ({cause})','El motor de búsqueda se detuvo ({cause})','Die Such-Engine wurde beendet ({cause})','検索エンジンが停止しました（{cause}）','搜索引擎已停止（{cause}）'],
  searchEngineUnavailable: ['Le moteur de recherche ne démarre pas','The search engine did not start','El motor de búsqueda no se inicia','Die Such-Engine startet nicht','検索エンジンを起動できません','搜索引擎无法启动'],
  searchIndexCancelled: ['Indexation annulée','Indexing cancelled','Indexación cancelada','Indexierung abgebrochen','インデックス作成をキャンセルしました','已取消索引'],
  upscaleEngineStopped: ['Le moteur d’upscale s’est arrêté','The upscale engine stopped','El motor de escalado se detuvo','Die Hochskalierungs-Engine wurde beendet','アップスケールエンジンが停止しました','超分辨率引擎已停止'],
  upscaleEngineUnavailable: ['Le moteur d’upscale ne démarre pas','The upscale engine did not start','El motor de escalado no se inicia','Die Hochskalierungs-Engine startet nicht','アップスケールエンジンを起動できません','超分辨率引擎无法启动'],
  processEngineStopped: ['Le moteur de traitement s’est arrêté','The processing engine stopped','El motor de procesamiento se detuvo','Die Verarbeitungs-Engine wurde beendet','処理エンジンが停止しました','处理引擎已停止'],
  processEngineUnavailable: ['Le moteur de traitement ne démarre pas','The processing engine did not start','El motor de procesamiento no se inicia','Die Verarbeitungs-Engine startet nicht','処理エンジンを起動できません','处理引擎无法启动'],
  transcribeEngineStopped: ['Le moteur de transcription s’est arrêté','The transcription engine stopped','El motor de transcripción se detuvo','Die Transkriptions-Engine wurde beendet','文字起こしエンジンが停止しました','转录引擎已停止'],
  transcribeEngineUnavailable: ['Le moteur de transcription ne démarre pas','The transcription engine did not start','El motor de transcripción no se inicia','Die Transkriptions-Engine startet nicht','文字起こしエンジンを起動できません','转录引擎无法启动'],
  upscaleTestTimeout: ['Test d’upscale interrompu après {seconds} s','Upscale test stopped after {seconds} s','Prueba de escalado detenida tras {seconds} s','Hochskalierungstest nach {seconds} s abgebrochen','アップスケールのテストを {seconds} 秒で中断しました','超分辨率测试在 {seconds} 秒后中止'],
  modelTestTimeout: ['Test du modèle interrompu après {seconds} s','Model test stopped after {seconds} s','Prueba del modelo detenida tras {seconds} s','Modelltest nach {seconds} s abgebrochen','モデルのテストを {seconds} 秒で中断しました','模型测试在 {seconds} 秒后中止'],
  outputOverwritesSource: ['Le fichier de sortie remplacerait la source. Choisis un autre nom ou un autre dossier.','The output file would replace the source. Choose another name or folder.','El archivo de salida reemplazaría el original. Elige otro nombre u otra carpeta.','Die Ausgabedatei würde die Quelle ersetzen. Wähle einen anderen Namen oder Ordner.','出力ファイルが元のファイルを上書きします。別の名前かフォルダーを選んでください。','输出文件会覆盖源文件。请换一个名称或文件夹。'],
  upscaleFailed: ['Échec de l’upscale','Upscale failed','Error al escalar','Hochskalierung fehlgeschlagen','アップスケールに失敗しました','超分辨率处理失败'],
  interpolationFailed: ['Échec de l’interpolation','Interpolation failed','Error en la interpolación','Interpolation fehlgeschlagen','補間に失敗しました','插帧失败'],
  depthFailed: ['Échec du calcul de profondeur','Depth estimation failed','Error al calcular la profundidad','Tiefenberechnung fehlgeschlagen','深度の推定に失敗しました','深度估计失败'],
  backgroundRemovalFailed: ['Échec du détourage','Background removal failed','Error al quitar el fondo','Freistellen fehlgeschlagen','背景の除去に失敗しました','背景移除失败'],
  shotFileSuffix: ['plan','shot','plano','Shot','ショット','镜头'],
  setupStageFfmpeg: ['Téléchargement de ffmpeg…','Downloading ffmpeg…','Descargando ffmpeg…','ffmpeg wird heruntergeladen…','ffmpeg をダウンロードしています…','正在下载 ffmpeg…'],
  setupStageShaders: ['Installation des shaders…','Installing shaders…','Instalando los shaders…','Shader werden installiert…','シェーダーをインストールしています…','正在安装着色器…'],
  setupStageYtdlp: ['Téléchargement de yt-dlp…','Downloading yt-dlp…','Descargando yt-dlp…','yt-dlp wird heruntergeladen…','yt-dlp をダウンロードしています…','正在下载 yt-dlp…'],
  setupStageConfig: ['Écriture de la configuration…','Writing the configuration…','Guardando la configuración…','Konfiguration wird geschrieben…','設定を書き込んでいます…','正在写入配置…'],
  setupFfmpegMissing: ['ffmpeg est introuvable après l’extraction','ffmpeg was not found after extraction','No se encontró ffmpeg después de extraerlo','ffmpeg wurde nach dem Entpacken nicht gefunden','展開後に ffmpeg が見つかりません','解压后找不到 ffmpeg'],
  setupShadersMissing: ['Shaders introuvables','Shaders not found','No se encontraron los shaders','Shader nicht gefunden','シェーダーが見つかりません','找不到着色器'],
  setupYtdlpMissing: ['yt-dlp est introuvable après le téléchargement','yt-dlp was not found after the download','No se encontró yt-dlp después de descargarlo','yt-dlp wurde nach dem Download nicht gefunden','ダウンロード後に yt-dlp が見つかりません','下载后找不到 yt-dlp'],
  setupVerifying: ['Vérification de l’installation…','Verifying the installation…','Verificando la instalación…','Installation wird geprüft…','インストールを確認しています…','正在验证安装…'],
  setupVerifyFailed: ['La vérification finale de l’installation a échoué. Relance l’installation.','The final installation check failed. Run the installation again.','La comprobación final de la instalación falló. Vuelve a ejecutar la instalación.','Die abschließende Prüfung der Installation ist fehlgeschlagen. Starte die Installation erneut.','インストールの最終確認に失敗しました。もう一度インストールしてください。','安装的最终检查失败。请重新运行安装。'],
  ytdlpMissing: ['yt-dlp introuvable ({path}). Relance l’installation pour l’ajouter.','yt-dlp not found ({path}). Run the installation again to add it.','No se encontró yt-dlp ({path}). Vuelve a ejecutar la instalación para añadirlo.','yt-dlp nicht gefunden ({path}). Starte die Installation erneut, um es hinzuzufügen.','yt-dlp が見つかりません（{path}）。もう一度インストールを実行して追加してください。','找不到 yt-dlp（{path}）。请重新运行安装以添加它。'],
  ytAuthNoSession: ['YouTube réserve cette vidéo aux comptes connectés, le board la lit donc dans son lecteur intégré. Aucune session configurée : connecte-toi à YouTube dans Firefox, ou indique un cookies.txt exporté dans « cookiesFile » de nr.config.json.','YouTube only shows this video to signed-in accounts, so the board plays it in its embedded player. No session is set up: sign in to YouTube in Firefox, or point "cookiesFile" in nr.config.json to an exported cookies.txt.','YouTube solo muestra este vídeo a cuentas con sesión iniciada, así que el tablero lo reproduce en su reproductor integrado. No hay ninguna sesión configurada: inicia sesión en YouTube en Firefox o indica un cookies.txt exportado en «cookiesFile» de nr.config.json.','YouTube zeigt dieses Video nur angemeldeten Konten, daher spielt das Board es im eingebetteten Player ab. Keine Sitzung eingerichtet: Melde dich in Firefox bei YouTube an, oder trage eine exportierte cookies.txt unter „cookiesFile“ in nr.config.json ein.','この動画は YouTube にログインしたアカウントでのみ視聴できるため、ボードでは埋め込みプレーヤーで再生します。セッションが設定されていません。Firefox で YouTube にログインするか、書き出した cookies.txt を nr.config.json の「cookiesFile」に指定してください。','YouTube 仅向已登录的账户提供此视频，因此画板会在内嵌播放器中播放。未设置会话：请在 Firefox 中登录 YouTube，或在 nr.config.json 的“cookiesFile”中指定导出的 cookies.txt。'],
  ytAuthAdvice: ['YouTube réserve cette vidéo aux comptes connectés, le board la lit donc dans son lecteur intégré. {details}. Le plus simple : se connecter une fois à YouTube dans Firefox, ou exporter un cookies.txt et l’indiquer dans « cookiesFile » de nr.config.json.','YouTube only shows this video to signed-in accounts, so the board plays it in its embedded player. {details}. Easiest: sign in to YouTube once in Firefox, or export a cookies.txt and point "cookiesFile" in nr.config.json to it.','YouTube solo muestra este vídeo a cuentas con sesión iniciada, así que el tablero lo reproduce en su reproductor integrado. {details}. Lo más sencillo: iniciar sesión una vez en YouTube en Firefox, o exportar un cookies.txt e indicarlo en «cookiesFile» de nr.config.json.','YouTube zeigt dieses Video nur angemeldeten Konten, daher spielt das Board es im eingebetteten Player ab. {details}. Am einfachsten: Melde dich einmal in Firefox bei YouTube an, oder exportiere eine cookies.txt und trage sie unter „cookiesFile“ in nr.config.json ein.','この動画は YouTube にログインしたアカウントでのみ視聴できるため、ボードでは埋め込みプレーヤーで再生します。{details}。最も簡単なのは、Firefox で一度 YouTube にログインするか、cookies.txt を書き出して nr.config.json の「cookiesFile」に指定することです。','YouTube 仅向已登录的账户提供此视频，因此画板会在内嵌播放器中播放。{details}。最简单的方法：在 Firefox 中登录一次 YouTube，或导出 cookies.txt 并在 nr.config.json 的“cookiesFile”中指定它。'],
  ytAuthLockedOne: ['{browsers} garde ses cookies verrouillés tant qu’il tourne (le fermer entièrement les libère)','{browsers} keeps its cookies locked while it runs (closing it completely frees them)','{browsers} mantiene sus cookies bloqueadas mientras está abierto (cerrarlo por completo las libera)','{browsers} hält seine Cookies gesperrt, solange es läuft (vollständiges Schließen gibt sie frei)','{browsers} は起動中は Cookie をロックしています（完全に終了すると解放されます）','{browsers} 运行时会锁定其 Cookie（完全关闭即可释放）'],
  ytAuthLockedMany: ['{browsers} gardent leurs cookies verrouillés tant qu’ils tournent (les fermer entièrement les libère)','{browsers} keep their cookies locked while they run (closing them completely frees them)','{browsers} mantienen sus cookies bloqueadas mientras están abiertos (cerrarlos por completo las libera)','{browsers} halten ihre Cookies gesperrt, solange sie laufen (vollständiges Schließen gibt sie frei)','{browsers} は起動中は Cookie をロックしています（完全に終了すると解放されます）','{browsers} 运行时会锁定其 Cookie（完全关闭即可释放）'],
  ytAuthSignedOutOne: ['{browsers} : lisible, mais sans session YouTube','{browsers}: readable, but not signed in to YouTube','{browsers}: legible, pero sin sesión de YouTube','{browsers}: lesbar, aber ohne YouTube-Sitzung','{browsers}：読み取れますが、YouTube にログインしていません','{browsers}：可读取，但未登录 YouTube'],
  ytAuthSignedOutMany: ['{browsers} : lisibles, mais sans session YouTube','{browsers}: readable, but not signed in to YouTube','{browsers}: legibles, pero sin sesión de YouTube','{browsers}: lesbar, aber ohne YouTube-Sitzung','{browsers}：読み取れますが、YouTube にログインしていません','{browsers}：可读取，但未登录 YouTube'],
  ytdlpFailed: ['yt-dlp a échoué (code {code})','yt-dlp failed (code {code})','yt-dlp falló (código {code})','yt-dlp ist fehlgeschlagen (Code {code})','yt-dlp が失敗しました（コード {code}）','yt-dlp 失败（代码 {code}）'],
  extractNothing: ['Aucun média à récupérer sur ce lien. Le compte est peut-être privé, le lien non pris en charge, ou l’outil à mettre à jour.','No media to get from this link. The account may be private, the link unsupported, or the tool out of date.','No hay ningún medio que obtener de este enlace. Puede que la cuenta sea privada, el enlace no sea compatible o haya que actualizar la herramienta.','Unter diesem Link gibt es keine Medien zum Abrufen. Das Konto ist vielleicht privat, der Link wird nicht unterstützt, oder das Tool ist veraltet.','このリンクから取得できるメディアがありません。アカウントが非公開か、リンクに対応していないか、ツールの更新が必要です。','无法从此链接获取媒体。账户可能是私密的，链接不受支持，或工具需要更新。'],
  extractOrganizeFailed: ['Impossible de ranger le média dans le projet','Could not file the media into the project','No se pudo guardar el medio en el proyecto','Das Medium konnte nicht im Projekt abgelegt werden','メディアをプロジェクトに整理できませんでした','无法将媒体归入项目'],
  shaderDirMissing: ['Dossier des shaders introuvable ({path}). Lance scripts/fetch-shaders.ps1 pour le créer.','Shader folder not found ({path}). Run scripts/fetch-shaders.ps1 to create it.','No se encontró la carpeta de shaders ({path}). Ejecuta scripts/fetch-shaders.ps1 para crearla.','Shader-Ordner nicht gefunden ({path}). Führe scripts/fetch-shaders.ps1 aus, um ihn anzulegen.','シェーダーフォルダーが見つかりません（{path}）。scripts/fetch-shaders.ps1 を実行して作成してください。','找不到着色器文件夹（{path}）。请运行 scripts/fetch-shaders.ps1 创建它。'],
  shaderMissing: ['Shader « {file} » introuvable dans {path}. Lance scripts/fetch-shaders.ps1 pour l’ajouter.','Shader "{file}" not found in {path}. Run scripts/fetch-shaders.ps1 to add it.','No se encontró el shader «{file}» en {path}. Ejecuta scripts/fetch-shaders.ps1 para añadirlo.','Shader „{file}“ in {path} nicht gefunden. Führe scripts/fetch-shaders.ps1 aus, um ihn hinzuzufügen.','シェーダー「{file}」が {path} に見つかりません。scripts/fetch-shaders.ps1 を実行して追加してください。','在 {path} 中找不到着色器“{file}”。请运行 scripts/fetch-shaders.ps1 添加它。'],
  ffmpegMissing: ['ffmpeg introuvable : {detail}','ffmpeg not found: {detail}','No se encontró ffmpeg: {detail}','ffmpeg nicht gefunden: {detail}','ffmpeg が見つかりません：{detail}','找不到 ffmpeg：{detail}'],
  turboFfmpegFailed: ['ffmpeg a échoué (code {code}). Vulkan ou libplacebo est peut-être indisponible.','ffmpeg failed (code {code}). Vulkan or libplacebo may be unavailable.','ffmpeg falló (código {code}). Puede que Vulkan o libplacebo no estén disponibles.','ffmpeg ist fehlgeschlagen (Code {code}). Vulkan oder libplacebo ist vielleicht nicht verfügbar.','ffmpeg が失敗しました（コード {code}）。Vulkan または libplacebo を利用できない可能性があります。','ffmpeg 失败（代码 {code}）。Vulkan 或 libplacebo 可能不可用。'],
  sourceUnreadable: ['Source illisible : {detail}','Can\'t read the source: {detail}','No se puede leer el origen: {detail}','Quelle nicht lesbar: {detail}','ソースを読み取れません：{detail}','无法读取源文件：{detail}'],
  downloadTooManyRedirects: ['Trop de redirections','Too many redirects','Demasiadas redirecciones','Zu viele Weiterleitungen','リダイレクトが多すぎます','重定向次数过多'],
  httpErrorAt: ['HTTP {code} sur {url}','HTTP {code} at {url}','HTTP {code} en {url}','HTTP {code} bei {url}','{url} で HTTP {code}','{url} 返回 HTTP {code}'],
  downloadTruncated: ['Téléchargement interrompu ({done}/{total} octets)','Download cut short ({done}/{total} bytes)','Descarga interrumpida ({done}/{total} bytes)','Download abgebrochen ({done}/{total} Bytes)','ダウンロードが途中で切れました（{done}/{total} バイト）','下载中断（{done}/{total} 字节）'],
  tarExtractFailed: ['Impossible d’extraire l’archive (tar)','Could not extract the archive (tar)','No se pudo extraer el archivo (tar)','Archiv konnte nicht entpackt werden (tar)','アーカイブを展開できませんでした（tar）','无法解压归档（tar）'],
  tarEmpty: ['L’archive téléchargée est vide','The downloaded archive is empty','El archivo descargado está vacío','Das heruntergeladene Archiv ist leer','ダウンロードしたアーカイブが空です','下载的归档为空'],
  pipPackageMissing: ['Aucun paquet Python dans {dir} (ni setup.py ni pyproject.toml)','No Python package in {dir} (no setup.py or pyproject.toml)','No hay ningún paquete de Python en {dir} (ni setup.py ni pyproject.toml)','Kein Python-Paket in {dir} (weder setup.py noch pyproject.toml)','{dir} に Python パッケージがありません（setup.py も pyproject.toml もありません）','{dir} 中没有 Python 包（既无 setup.py 也无 pyproject.toml）'],
  autoshotManualImport: ['Importe ckpt_0_200_0.pth depuis le lien officiel d’AutoShot.','Import ckpt_0_200_0.pth from the official AutoShot link.','Importa ckpt_0_200_0.pth desde el enlace oficial de AutoShot.','Importiere ckpt_0_200_0.pth über den offiziellen AutoShot-Link.','AutoShot の公式リンクから ckpt_0_200_0.pth をインポートしてください。','请从 AutoShot 官方链接导入 ckpt_0_200_0.pth。'],
  checkpointEmpty: ['Checkpoint vide ou introuvable','Checkpoint is empty or missing','El checkpoint está vacío o no se encuentra','Checkpoint ist leer oder fehlt','チェックポイントが空か見つかりません','检查点为空或不存在'],
  expectedFile: ['Fichier attendu : {files}','Expected file: {files}','Archivo esperado: {files}','Erwartete Datei: {files}','必要なファイル：{files}','需要的文件：{files}'],
  boardDestInsideStore: ['Ce dossier est dans le stockage des boards. Choisis un dossier en dehors.','This folder is inside the board storage. Choose a folder outside it.','Esta carpeta está dentro del almacenamiento de los tableros. Elige una carpeta fuera de él.','Dieser Ordner liegt im Board-Speicher. Wähle einen Ordner außerhalb davon.','このフォルダーはボードの保存領域内にあります。その外のフォルダーを選んでください。','此文件夹位于画板存储内。请选择其外部的文件夹。'],
  netsuExtensionRequired: ['La destination doit être un fichier .netsu','The destination must be a .netsu file','El destino debe ser un archivo .netsu','Das Ziel muss eine .netsu-Datei sein','保存先は .netsu ファイルにしてください','目标必须是 .netsu 文件'],
  boardMissing: ['Board introuvable','Board not found','No se encontró el tablero','Board nicht gefunden','ボードが見つかりません','找不到画板'],
  boardSharedNoArchive: ['Un board partagé ne peut pas être enregistré comme projet.','A shared board can\'t be saved as a project.','Un tablero compartido no se puede guardar como proyecto.','Ein geteiltes Board kann nicht als Projekt gespeichert werden.','共有中のボードはプロジェクトとして保存できません。','共享的画板无法保存为项目。'],
  fileMissingAt: ['Fichier introuvable : {path}','File not found: {path}','No se encontró el archivo: {path}','Datei nicht gefunden: {path}','ファイルが見つかりません：{path}','找不到文件：{path}'],
  compareSourcesMissing: ['Il manque l’une des deux sources à comparer','One of the two sources to compare is missing','Falta una de las dos fuentes que comparar','Eine der beiden zu vergleichenden Quellen fehlt','比較する 2 つのソースのうち 1 つがありません','缺少两个对比源中的一个'],
  mediaFallbackName: ['média','media','medio','Medium','メディア','媒体'],
  sequenceFramesMissing: ['Séquence — {missing}/{total} images manquantes','Sequence — {missing}/{total} frames missing','Secuencia — faltan {missing}/{total} imágenes','Sequenz – {missing}/{total} Bilder fehlen','シーケンス — {missing}/{total} 枚の画像がありません','序列 — 缺少 {missing}/{total} 张图像'],
  sequenceFramesAllMissing: ['Séquence — {total} images manquantes','Sequence — {total} frames missing','Secuencia — faltan {total} imágenes','Sequenz – {total} Bilder fehlen','シーケンス — {total} 枚の画像がありません','序列 — 缺少 {total} 张图像'],
  netsuNoBoard: ['Aucun board dans ce fichier','No board in this file','No hay ningún tablero en este archivo','Kein Board in dieser Datei','このファイルにはボードがありません','此文件中没有画板'],
  netsuUnreadable: ['Fichier .netsu illisible : {path}','Can\'t read this .netsu file: {path}','No se puede leer el archivo .netsu: {path}','.netsu-Datei nicht lesbar: {path}','.netsu ファイルを読み取れません：{path}','无法读取 .netsu 文件：{path}'],
  netsuTooNew: ['Ce fichier .netsu vient d’une version plus récente de NetsuBoard (schéma {from} > {current}). Mets l’app à jour pour l’ouvrir.','This .netsu file comes from a newer version of NetsuBoard (schema {from} > {current}). Update the app to open it.','Este archivo .netsu proviene de una versión más reciente de NetsuBoard (esquema {from} > {current}). Actualiza la app para abrirlo.','Diese .netsu-Datei stammt aus einer neueren NetsuBoard-Version (Schema {from} > {current}). Aktualisiere die App, um sie zu öffnen.','この .netsu ファイルは新しいバージョンの NetsuBoard で作成されています（スキーマ {from} > {current}）。開くにはアプリを更新してください。','此 .netsu 文件来自更新版本的 NetsuBoard（架构 {from} > {current}）。请更新应用后再打开。'],
  notAFile: ['Ce n’est pas un fichier : {path}','Not a file: {path}','No es un archivo: {path}','Keine Datei: {path}','ファイルではありません：{path}','不是文件：{path}'],
  embedClipEmpty: ['Le clip embarqué est vide ({name} {start}→{end})','The embedded clip is empty ({name} {start}→{end})','El clip incrustado está vacío ({name} {start}→{end})','Der eingebettete Clip ist leer ({name} {start}→{end})','埋め込みクリップが空です（{name} {start}→{end}）','嵌入的片段为空（{name} {start}→{end}）'],
  downloadTimedOut: ['Délai dépassé : le serveur ne répond pas','Timed out: the server is not responding','Tiempo agotado: el servidor no responde','Zeitüberschreitung: Der Server antwortet nicht','タイムアウト：サーバーが応答しません','超时：服务器无响应'],
  downloadTooLarge: ['Fichier trop volumineux','File is too large','El archivo es demasiado grande','Datei ist zu groß','ファイルが大きすぎます','文件过大'],
  proxyEmpty: ['Le proxy généré est vide','The generated proxy is empty','El proxy generado está vacío','Der erzeugte Proxy ist leer','生成されたプロキシが空です','生成的代理文件为空'],
  thumbnailFailed: ['Impossible de créer la vignette','Could not create the thumbnail','No se pudo crear la miniatura','Miniatur konnte nicht erstellt werden','サムネイルを作成できませんでした','无法生成缩略图'],
  withDetail: ['{message} : {detail}','{message}: {detail}','{message}: {detail}','{message}: {detail}','{message}：{detail}','{message}：{detail}'],
  turboUnavailable: ['Le moteur d’upscale exige une version de ffmpeg compatible avec Vulkan/libplacebo, et un pilote graphique qui expose Vulkan.','The upscale engine requires an ffmpeg build with working Vulkan/libplacebo support, and a graphics driver that exposes Vulkan.','El motor de escalado necesita una versión de ffmpeg compatible con Vulkan/libplacebo y un controlador gráfico que exponga Vulkan.','Die Hochskalierungs-Engine benötigt ein ffmpeg-Build mit Vulkan/libplacebo-Unterstützung und einen Grafiktreiber, der Vulkan bereitstellt.','アップスケールエンジンには Vulkan/libplacebo 対応の ffmpeg と、Vulkan を公開するグラフィックドライバーが必要です。','超分辨率引擎需要支持 Vulkan/libplacebo 的 ffmpeg，且显卡驱动需提供 Vulkan。'],
  ffmpegNoImageWritten: ['ffmpeg n’a écrit aucune image ({name})','ffmpeg wrote no image ({name})','ffmpeg no escribió ninguna imagen ({name})','ffmpeg hat kein Bild geschrieben ({name})','ffmpeg が画像を書き出しませんでした（{name}）','ffmpeg 未写出任何图像（{name}）'],
  ytdlpNotOwned: ['Ce yt-dlp n’a pas été installé par NetsuBoard : l’app ne le met pas à jour.','This yt-dlp was not installed by NetsuBoard, so the app does not update it.','Este yt-dlp no lo instaló NetsuBoard, así que la app no lo actualiza.','Dieses yt-dlp wurde nicht von NetsuBoard installiert, daher aktualisiert die App es nicht.','この yt-dlp は NetsuBoard がインストールしたものではないため、アプリからは更新しません。','此 yt-dlp 并非由 NetsuBoard 安装，因此应用不会更新它。'],
};

const SUPPORTED = ['fr', 'en', 'es', 'de', 'ja', 'zh'];

/**
 * First supported interface language among locale tags (best first), or null.
 * @param {ReadonlyArray<string | null | undefined>} tags
 * @returns {string | null}
 */
function pickLanguage(tags) {
  for (const tag of tags) {
    const code = String(tag || '').trim().toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED.includes(code)) return code;
  }
  return null;
}

/** The OS locale as Node's ICU sees it ("ja-JP" on a Japanese Windows). */
function systemLocale() {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return ''; }
}

// The saved choice, else the OS locale, else English. French is only the source language: a
// Portuguese or Korean user who never picked a language reads English, not French.
function language() {
  return pickLanguage([CONFIG.lang, systemLocale()]) || 'en';
}
/**
 * A message in the interface language. `{name}` placeholders are filled from `vars`.
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
function t(key, vars) {
  let text;
  if (EXTRA[key]) text = EXTRA[key][SUPPORTED.indexOf(language())] || EXTRA[key][0];
  else {
    /** @type {Record<string,string>} */ const selected = MESSAGES[language()];
    /** @type {Record<string,string>} */ const fallback = MESSAGES.fr;
    text = selected[key] || fallback[key] || key;
  }
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

module.exports = { SUPPORTED, pickLanguage, language, t };
