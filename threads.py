from PyQt6.QtCore import QThread, pyqtSignal
import utils

class SearchThread(QThread):
    results_ready = pyqtSignal(list)

    def __init__(self, query):
        super().__init__()
        self.query = query

    def run(self):
        results = utils.search(self.query)
        self.results_ready.emit(results)

class VideoInfoThread(QThread):
    result_ready = pyqtSignal(dict)

    def __init__(self, url):
        super().__init__()
        self.url = url

    def run(self):
        videoInfo = utils.getVideoInfo(self.url)
        self.result_ready.emit(videoInfo)

class DownloadThread(QThread):
    progress = pyqtSignal(int)
    log = pyqtSignal(str)
    finished_download = pyqtSignal(bool, str) # success, message/path

    def __init__(self, url, options, is_audio=False, filename=None, path=None):
        super().__init__()
        self.url = url
        self.options = options
        self.is_audio = is_audio
        self.filename = filename
        self.path = path

    def run(self):
        def progress_hook(d):
            if d['status'] == 'downloading':
                try:
                    p = d.get('_percent_str', '0%').replace('%','')
                    self.progress.emit(int(float(p)))
                except:
                    pass
            elif d['status'] == 'finished':
                self.progress.emit(100)
                self.log.emit("Download Complete. Processing...")

        # Logger class to capture output
        class MyLogger:
            def __init__(self, signal):
                self.signal = signal
            def debug(self, msg):
                self.signal.emit(msg)
            def warning(self, msg):
                self.signal.emit(f"WARNING: {msg}")
            def error(self, msg):
                self.signal.emit(f"ERROR: {msg}")

        logger = MyLogger(self.log)

        success, msg = utils.downloadVideo(self.url, self.options, progress_hook, logger, self.is_audio, self.filename, self.path)
        self.finished_download.emit(success, msg)