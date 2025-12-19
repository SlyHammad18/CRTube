from PyQt6 import uic
from PyQt6.QtWidgets import QMainWindow, QListWidgetItem
from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QIcon, QPixmap, QKeySequence, QShortcut
import utils
import threads
from downloadwindow import DownloadProgressWindow
from settingswindow import SettingsWindow, load_config
from functools import partial

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        uic.loadUi('mainwindow.ui', self)

        self.setWindowTitle('CRTube')
        self.setWindowIcon(QIcon('icon.ico'))
        # Make Window Frameless
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.Window)

        # setting icon to icon Label
        self.icon.setPixmap(QIcon('icon.png').pixmap(30, 30))

        # Connecting Button Clicks to Functions
        self.closeButton.clicked.connect(self.onCloseClicked)
        self.iconifyButton.clicked.connect(self.onIconifyClicked)
        self.searchbar.returnPressed.connect(self.onSearchReturned)
        self.videoButton.clicked.connect(self.onVideoButtonClicked)
        self.videoButton.clicked.connect(self.onVideoButtonClicked)
        self.audioButton.clicked.connect(self.onAudioButtonClicked)
        self.download.clicked.connect(self.onDownloadClicked)
        self.settings.clicked.connect(self.onSettingsClicked)

        self.currentMode = 'video'

        # Install event filters on result frames
        for i in range(1, 5+1):
            frame = getattr(self, f"result{i}")
            frame.installEventFilter(self)

        # Hiding ResultFrames
        self.result1.hide()
        self.result2.hide()
        self.result3.hide()
        self.result4.hide()
        self.result5.hide()

        # Storing Old Position
        self.oldPos = self.pos()

        self.searchResults = {}  # Dictionary to store search results
        self.urlResults = {}     # Dictionary to store url results
        self.downloadWindows = [] # Store active download windows

        # Setting Focus to Search Bar
        self.searchbar.setFocus()

        # Setting Shortcuts
        closeShort = QShortcut(QKeySequence("Ctrl+W"), self)
        closeShort.activated.connect(self.onCloseClicked)

        iconifyShort = QShortcut(QKeySequence("Ctrl+Q"), self)
        iconifyShort.activated.connect(self.onIconifyClicked)

        toggleFocusShort = QShortcut(QKeySequence("Ctrl+/"), self)
        toggleFocusShort.activated.connect(self.toggleFocus)

    def mousePressEvent(self, event):
        if self.titleFrame.underMouse() and event.button() == Qt.MouseButton.LeftButton:
            self.dragPos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.MouseButton.LeftButton and hasattr(self, "dragPos"):
            self.move(event.globalPosition().toPoint() - self.dragPos)
            event.accept()

    def onSettingsClicked(self):
        self.settingsWindow = SettingsWindow(self)
        self.settingsWindow.show()

    def onCloseClicked(self):
        self.close()

    def onIconifyClicked(self):
        self.showMinimized()

    def onSearchReturned(self):
        query = self.searchbar.text().strip()
        if query == '':
            return

        # Clear previous results
        for i in range(1, 6):
            getattr(self, f'result{i}').hide()
            getattr(self, f'videoTitle{i}').setText('')
            getattr(self, f'channel{i}').setText('')
            getattr(self, f'views{i}').setText('')
            getattr(self, f'length{i}').setText('')

        if utils.isValidURL(query):
            if not utils.isValidYouTubeURL(query):
                self.progressLabel.setText('Invalid URL')
                return
            
            self.progressLabel.setText('Fetching Data From URL...')

            self.videoThread = threads.VideoInfoThread(query)
            self.videoThread.result_ready.connect(self.displayURLResult)
            self.videoThread.start()

            return
        
        self.progressLabel.setText('Searching...')

        # Start search in a separate thread
        self.thread = threads.SearchThread(query)
        self.thread.results_ready.connect(self.displaySearchResult)
        self.thread.start()

    def displaySearchResult(self, results):
        for i, video in enumerate(results[:5], start=1):
            # Title
            label = getattr(self, f'videoTitle{i}')
            label.setFixedWidth(670)
            label.setWordWrap(False)
            title = video.get('title', 'N/A')
            fm = label.fontMetrics()
            elidedTitle = fm.elidedText(title, Qt.TextElideMode.ElideRight, label.width())
            label.setText(elidedTitle)

            # Channel, Views, Duration
            getattr(self, f'channel{i}').setText(f"Channel: {video.get('channel', 'N/A')}")
            getattr(self, f'views{i}').setText(utils.formatViews(video.get('views')))
            getattr(self, f'length{i}').setText(utils.formatDuration(video.get('duration')))

            getattr(self, f'result{i}').show()

        self.searchResults = results
        self.progressLabel.setText('')

    def displayURLResult(self, videoInfo):
        self.videoTitle1.setFixedWidth(670)
        self.videoTitle1.setWordWrap(False)
        title = videoInfo.get('title', 'N/A')
        fm = self.videoTitle1.fontMetrics()
        elidedTitle = fm.elidedText(title, Qt.TextElideMode.ElideRight, self.videoTitle1.width())
        self.videoTitle1.setText(elidedTitle)

        self.channel1.setText(f"Channel: {videoInfo.get('channel', 'N/A')}")
        self.views1.setText(utils.formatViews(videoInfo.get('views')))
        self.length1.setText(utils.formatDuration(videoInfo.get('length')))

        thumb_url = videoInfo.get('thumbnail')
        if thumb_url:
            success, path = utils.downloadThumbnail(thumb_url, "thumb1.jpg")
            if success:
                pixmap = QPixmap(path)
                self.thumbnail.setPixmap(pixmap.scaled(260, 146, Qt.AspectRatioMode.KeepAspectRatio))
            videoInfo['thumbnail_path'] = path

        self.result1.show()

        self.videoButton.setStyleSheet("""
            QPushButton {
            	background: #FF4D6D;
            	color: #1A1A1F;
            	border: 2px solid #FF4D6D;
            	border-right: 1px solid #FF4D6D;
            	border-top-left-radius: 20px;
            	border-bottom-left-radius: 20px;
            }
        """)

        self.audioButton.setStyleSheet("""
            QPushButton {
            	background: #1A1A1F;
            	color: #FF4D6D;
            	border: 2px solid #FF4D6D;
            	border-left: 1px solid #FF4D6D;
            	border-top-right-radius: 20px;
            	border-bottom-right-radius: 20px;
            }
        """)            

        self.qualityList.clear()  # clear previous entries
        for q in videoInfo.get('video_qualities', []):
            res = q.get('resolution') or "N/A"
            ext = q.get('ext') or ""
            size = q.get('filesize') or 0
            if size:
                size_mb = round(size / (1024*1024), 2)
                size_str = f"{size_mb} MB"
            else:
                size_str = "N/A"

            item_text = f"{res} - {size_str}"
            item = QListWidgetItem(item_text)
            self.qualityList.addItem(item)
            item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

            self.urlResults = videoInfo
            self.progressLabel.setText('')

    def toggleFocus(self):
        if self.searchbar.hasFocus():
            self.searchbar.clearFocus()
        else:
            self.searchbar.setFocus()

    def onVideoButtonClicked(self):
        self.currentMode = 'video'
        self.qualityList.clear()  

        self.videoButton.setStyleSheet("""
            QPushButton {
            	background: #FF4D6D;
            	color: #1A1A1F;
            	border: 2px solid #FF4D6D;
            	border-right: 1px solid #FF4D6D;
            	border-top-left-radius: 20px;
            	border-bottom-left-radius: 20px;
            }
        """)

        self.audioButton.setStyleSheet("""
            QPushButton {
            	background: #1A1A1F;
            	color: #FF4D6D;
            	border: 2px solid #FF4D6D;
            	border-left: 1px solid #FF4D6D;
            	border-top-right-radius: 20px;
            	border-bottom-right-radius: 20px;
            }
        """)

        for q in self.urlResults.get('video_qualities', []):
            res = q.get('resolution') or "N/A"
            ext = q.get('ext') or ""
            size = q.get('filesize') or 0
            if size:
                size_mb = round(size / (1024*1024), 2)
                size_str = f"{size_mb} MB"
            else:
                size_str = "N/A"

            item_text = f"{res} - {size_str}"
            item = QListWidgetItem(item_text)
            item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            self.qualityList.addItem(item)

    def onAudioButtonClicked(self):
        self.currentMode = 'audio'
        self.qualityList.clear()

        self.videoButton.setStyleSheet("""
            QPushButton {
            	background: #1A1A1F;
            	color: #FF4D6D;
            	border: 2px solid #FF4D6D;
            	border-right: 1px solid #FF4D6D;
            	border-top-left-radius: 20px;
            	border-bottom-left-radius: 20px;
            }
        """)

        self.audioButton.setStyleSheet("""
            QPushButton {
            	background: #FF4D6D;
            	color: #1A1A1F;
            	border: 2px solid #FF4D6D;
            	border-left: 1px solid #FF4D6D;
            	border-top-right-radius: 20px;
            	border-bottom-right-radius: 20px;
            }
        """)

        audio = self.urlResults.get('best_audio')
        if not audio or not audio.get('filesize'):
            return

        ext = audio.get('ext', 'N/A').upper()
        abr = round(audio.get('abr', 0))  # kbps
        size_mb = round(audio['filesize'] / (1024*1024), 2)
        size_str = f"{size_mb} MB"

        item_text = f"{abr} kbps - {size_str}"
        item = QListWidgetItem(item_text)
        item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
        self.qualityList.addItem(item)

    def eventFilter(self, source, event):
        if event.type() == event.Type.MouseButtonPress:
            for i in range(1, 6):
                frame = getattr(self, f"result{i}")
                if source == frame:
                    self.onResultClicked(i)
                    return True
        return super().eventFilter(source, event)
    
    def onResultClicked(self, idx):
        video = self.searchResults[idx - 1]
        url = video.get("url")

        if not url:
            self.progressLabel.setText("No URL found for this video.")
            return

        self.progressLabel.setText("Fetching Info...")

        # Start same thread as URL mode
        self.videoThread = threads.VideoInfoThread(url)
        self.videoThread.result_ready.connect(self.displayURLResult)
        self.videoThread.start()

    def onDownloadClicked(self):
        if not self.urlResults:
            return

        row = self.qualityList.currentRow()
        if row < 0:
            self.progressLabel.setText("Please select a quality option first.")
            return

        url = self.urlResults.get('url')
        if not url:
             self.progressLabel.setText("Error: URL not found.")
             return

        # Prepare options
        options = {}
        is_audio = (self.currentMode == 'audio')
        
        if is_audio:
            options = self.urlResults.get('best_audio', {})
        else:
            # Video mode. qualityList items correspond to video_qualities list.
            # We need to be careful if the list was filtered or sorted differently.
            # In onVideoButtonClicked, we iterate over urlResults['video_qualities'].
            # So the index should match. (Assuming list widget rows match list indices)
            qualities = self.urlResults.get('video_qualities', [])
            if 0 <= row < len(qualities):
                options = qualities[row]
            else:
                 self.progressLabel.setText("Error: Quality selection mismatch.")
                 return

        # Create Window
        self.dlWindow = DownloadProgressWindow(self)
        title = self.urlResults.get('title', 'Unknown')
        # Sanitize title for filename
        import re
        safe_title = re.sub(r'[\\/*?:"<>|]', "", title)
        
        config = load_config()
        default_path = config.get('default_path', "C:/Users/PC/Desktop/CRTube")
        
        dlWindow = DownloadProgressWindow(self)
        dlWindow.setInfo(safe_title, default_path) 
        
        # Keep reference
        self.downloadWindows.append(dlWindow)
        # Remove reference when closed
        dlWindow.closed.connect(lambda: self.downloadWindows.remove(dlWindow) if dlWindow in self.downloadWindows else None)
        
        # Connect start signal with context
        # We pass dlWindow instance to processDownload to know which window to update
        dlWindow.start_download.connect(partial(self.processDownload, dlWindow, url, options, is_audio, title))
        dlWindow.show()

    def processDownload(self, window, url, options, is_audio, title, filename, path):
        # Create Thread
        # Attach thread to window to keep it alive
        thread = threads.DownloadThread(url, options, is_audio, filename, path)
        window.thread = thread 
        
        thread.progress.connect(window.updateProgress)
        thread.log.connect(window.appendLog)
        
        def on_finished(success, msg):
            if success:
                window.appendLog(f"\nSUCCESS: Saved to {msg}")
                window.updateProgress(100)
                # Auto-close on success as requested
                QTimer.singleShot(2000, window.close) # Wait 2s then close so user sees success message
            else:
                window.appendLog(f"\nFAILED: {msg}")
        
        thread.finished_download.connect(on_finished)
        thread.start()
