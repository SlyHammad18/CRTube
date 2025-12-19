# CRTube 🎬

[![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python&logoColor=white)](https://www.python.org/)  
[![PyQt6](https://img.shields.io/badge/PyQt6-6.7-brightgreen?logo=qt&logoColor=white)](https://www.riverbankcomputing.com/software/pyqt/)  
[![yt-dlp](https://img.shields.io/badge/yt--dlp-latest-orange)](https://github.com/yt-dlp/yt-dlp)  
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)  

---

## 1. Introduction

**CRTube** is a desktop YouTube downloader built using **PyQt6**. It allows users to search YouTube videos, view details, and download content in video or audio formats. The app provides a smooth GUI with:

- Frameless, draggable window  
- Video and audio quality selection  
- Download progress windows  
- Settings for default download path  
- Automatic yt-dlp updates  

CRTube supports **multiple concurrent downloads** and intelligently handles YouTube video and audio formats.

---

## 2. Features

- Search YouTube videos directly from the app  
- Support for both video and audio downloads  
- Displays top 5 search results with:  
  - Video title  
  - Channel name  
  - Views and duration  
  - Thumbnail preview  
- Selectable video resolutions and audio bitrates  
- Multiple download windows for concurrent downloads  
- Frameless and modern GUI  
- Configurable default download folder  
- Automatic updates for `yt-dlp`   

---

## 4. Technology Stack

- **Python 3.11** – Core programming language  
- **PyQt6** – GUI framework for desktop application  
- **yt-dlp** – YouTube download library  
- **Requests** – For downloading video thumbnails  
- **FFmpeg** – Required for audio extraction and merging video/audio  

---

## 5. Installation

1. Clone the repository:  
```bash
git clone https://github.com/SlyHammad18/crtube.git
cd crtube
```
2. Create and activate a virtual environment (optional but recommended):
```bash
python -m venv venv
source venv/bin/activate   # Linux/Mac
venv\Scripts\activate      # Windows
```
3. Install dependencies:
```bash
pip install -r requirements.txt
```
4. Make sure FFmpeg is installed and added to PATH:
```bash
ffmpeg -version
```
