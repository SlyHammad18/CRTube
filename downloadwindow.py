from PyQt6 import uic
from PyQt6.QtWidgets import QMainWindow
from PyQt6.QtCore import Qt, pyqtSignal

class DownloadProgressWindow(QMainWindow):
    closed = pyqtSignal()
    start_download = pyqtSignal(str, str) # filename, path

    def __init__(self, parent=None):
        super().__init__(parent)
        uic.loadUi('downloadwindow.ui', self)
        
        # Make Window Frameless
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.Window)
        # Fix size
        self.setFixedSize(600, 400)
        
        # Connect listeners
        self.closeButton.clicked.connect(self.close)
        self.startDownloadButton.clicked.connect(self.onStartClicked)
        
        self.oldPos = self.pos()

    def setInfo(self, filename, path):
        self.filenameEdit.setText(filename)
        self.pathEdit.setText(path)

    def onStartClicked(self):
        filename = self.filenameEdit.text().strip()
        path = self.pathEdit.text().strip()
        if filename and path:
            self.startDownloadButton.setEnabled(False)
            self.startDownloadButton.setText("Downloading...")
            self.start_download.emit(filename, path)

    def updateProgress(self, value):
        self.progressBar.setValue(value)

    def appendLog(self, text):
        self.logOutput.append(text)
        # Auto scroll to bottom
        sb = self.logOutput.verticalScrollBar()
        sb.setValue(sb.maximum())

    def closeEvent(self, event):
        self.closed.emit()
        super().closeEvent(event)

    # Mouse Move Events for Frameless Window Dragging
    def mousePressEvent(self, event):
        if self.titleFrame.underMouse() and event.button() == Qt.MouseButton.LeftButton:
            self.dragPos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.MouseButton.LeftButton and hasattr(self, "dragPos"):
            self.move(event.globalPosition().toPoint() - self.dragPos)
            event.accept()
