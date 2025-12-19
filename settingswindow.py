from PyQt6 import uic
from PyQt6.QtWidgets import QMainWindow, QFileDialog, QMessageBox
from PyQt6.QtCore import Qt, QThread, pyqtSignal
import json
import os
import subprocess

CONFIG_FILE = "config.json"

class UpdateThread(QThread):
    log = pyqtSignal(str)
    finished_update = pyqtSignal()

    def run(self):
        self.log.emit("Starting update process...")
        try:
            # Use --no-input to avoid hanging on prompts, although pip install usually doesn't prompt for upgrades
            process = subprocess.Popen(
                ['pip', 'install', '--upgrade', 'yt-dlp'],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            
            for line in process.stdout:
                self.log.emit(line.strip())
                
            process.wait()
            self.log.emit(f"Process finished with exit code {process.returncode}")
        except Exception as e:
            self.log.emit(f"Error: {str(e)}")
        
        self.finished_update.emit()

class SettingsWindow(QMainWindow):
    def __init__(self, parent=None):
        super().__init__(parent)
        uic.loadUi('settingswindow.ui', self)
        
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.Window)
        self.setFixedSize(500, 380) # Updated size
        
        self.closeButton.clicked.connect(self.close)
        self.browseButton.clicked.connect(self.onBrowseClicked)
        self.saveButton.clicked.connect(self.onSaveClicked)
        self.updateButton.clicked.connect(self.onUpdateClicked)
        
        self.loadSettings()
        self.updateThread = None
        
    def loadSettings(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r') as f:
                    data = json.load(f)
                    self.pathEdit.setText(data.get('default_path', ''))
            except:
                pass

    def onBrowseClicked(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Default Download Folder")
        if folder:
            self.pathEdit.setText(folder)

    def onUpdateClicked(self):
        self.updateButton.setEnabled(False)
        self.updateLog.clear()
        
        self.updateThread = UpdateThread()
        self.updateThread.log.connect(self.appendLog)
        self.updateThread.finished_update.connect(self.onUpdateFinished)
        self.updateThread.start()

    def appendLog(self, text):
        self.updateLog.append(text)

    def onUpdateFinished(self):
        self.updateButton.setEnabled(True)
        self.updateLog.append("Update Check Complete.")

    def onSaveClicked(self):
        path = self.pathEdit.text().strip()
        if path and not os.path.isdir(path):
            QMessageBox.warning(self, "Invalid Path", "The selected path does not exist.")
            return
            
        data = {'default_path': path}
        try:
            with open(CONFIG_FILE, 'w') as f:
                json.dump(data, f)
            QMessageBox.information(self, "Saved", "Settings saved successfully.")
            self.close()
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to save settings: {e}")

    # Mouse Move Events for Frameless Window Dragging
    def mousePressEvent(self, event):
        if self.titleFrame.underMouse() and event.button() == Qt.MouseButton.LeftButton:
            self.dragPos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.MouseButton.LeftButton and hasattr(self, "dragPos"):
            self.move(event.globalPosition().toPoint() - self.dragPos)
            event.accept()

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}
