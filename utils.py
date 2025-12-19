import yt_dlp as yt
from urllib.parse import urlparse
import requests
import os

THUMB_PATH = os.path.join(os.getcwd(), 'tmp/thumbnails')

os.makedirs(THUMB_PATH, exist_ok=True)

def isValidURL(url):
    parsed = urlparse(url)
    return all([parsed.scheme in ("http", "https"), parsed.netloc])

def isValidYouTubeURL(url):
    return "youtube.com/watch" in url or "youtu.be/" in url

def formatViews(views):
    if views is None:
        return "N/A Views"
    views = int(views)
    if views >= 1_000_000_000:
        return f"{views/1_000_000_000:.1f}B Views"
    elif views >= 1_000_000:
        return f"{views/1_000_000:.1f}M Views"
    elif views >= 1_000:
        return f"{views/1_000:.1f}k Views"
    else:
        return f"{views} Views"
    
def formatDuration(duration):
    if duration is None:
        return "Length: N/A"
    duration = int(duration)
    minutes = duration // 60
    seconds = duration % 60
    return f"Length: {minutes}:{seconds:02d}"

def downloadThumbnail(url, filename):
    try:
        response = requests.get(url, stream=True, timeout=10)
        response.raise_for_status()

        with open(f'{THUMB_PATH}/{filename}', 'wb') as f:
            for chunk in response.iter_content(1024):
                f.write(chunk)

        return True, f'{THUMB_PATH}/{filename}'
    except Exception as e:
        print("Failed to download thumbnail:", e)
        return False, None

def search(query):
    ydl_opts = {
        "quiet": True,
        "skip_download": True,
        "noplaylist": True,
        "no_warnings": True,
        "extract_flat": True,
        "force_generic_extractor": False,
        "ignoreerrors": True
    }

    with yt.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"ytsearch5:{query}", download=False)

    results = []

    for entry in info.get("entries", []):
        if entry is None:
            continue

        results.append({
            "title": entry.get("title"),
            "channel": entry.get("channel"),
            "views": entry.get("view_count"),
            "duration": entry.get("duration"),      
            "url": entry.get("url")
        })

    return results

def getVideoInfo(url):
    ydl_opts = {
        "quiet": True,
        "skip_download": True,
        "noplaylist": True,
        "no_warnings": True
    }

    with yt.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    # Basic info
    title = info.get("title")
    channel = info.get("uploader") or info.get("channel")
    thumbnail = info.get("thumbnail")
    views = info.get("view_count")
    length = info.get("duration")  # in seconds

    qualities = []
    seen_resolutions = {}
    
    for f in info.get("formats", []):
        if f.get("vcodec") != "none" and f.get("ext") == "mp4":
            res = f.get("format_note") or str(f.get("height"))
            filesize = f.get("filesize") or f.get("filesize_approx")
    
            # Skip if filesize is not available
            if not filesize:
                continue
            
            # Only keep the largest filesize for each resolution
            if res not in seen_resolutions or filesize > seen_resolutions[res]['filesize']:
                seen_resolutions[res] = {
                    "format_id": f.get("format_id"),
                    "ext": f.get("ext"),
                    "resolution": res,
                    "filesize": filesize
                }
    
    # Convert dict to list and optionally sort by resolution descending
    qualities = sorted(seen_resolutions.values(), key=lambda x: int(''.join(filter(str.isdigit, str(x['resolution'])))), reverse=True)

    # Get best audio quality
    best_audio = None
    audio_formats = [f for f in info.get("formats", []) if f.get("acodec") != "none" and f.get("vcodec") == "none"]
    if audio_formats:
        best_audio = max(audio_formats, key=lambda x: x.get("abr", 0))
        best_audio = {
            "format_id": best_audio.get("format_id"),
            "ext": best_audio.get("ext"),
            "abr": best_audio.get("abr"),  # kbps
            "filesize": best_audio.get("filesize") or best_audio.get("filesize_approx")
        }

    return {
        "title": title,
        "channel": channel,
        "thumbnail": thumbnail,
        "views": views,
        "length": length,
        "video_qualities": qualities,
        "best_audio": best_audio,
        "url": url
    }

    
    
def downloadVideo(url, options, progress_hook, logger, is_audio=False, custom_filename=None, custom_path=None):
    # Construct outtmpl based on custom inputs or default
    if custom_filename and custom_path:
        # Ensure path ends with slash or use os.path.join logic (handled by forward slash in string for yt-dlp)
        out_template = f"{custom_path}/{custom_filename}.%(ext)s"
    else:
        out_template = '%(title)s.%(ext)s'

    ydl_opts = {
        'logger': logger,
        'progress_hooks': [progress_hook],
        'outtmpl': out_template,
        'noplaylist': True,
    }

    if is_audio:
        ydl_opts.update({
            'format': options.get('format_id', 'bestaudio/best'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }, {
                'key': 'EmbedThumbnail',
            }],
            'writethumbnail': True, 
        })
    else:
        # Video
        fmt = options.get('format_id')
        if fmt:
            ydl_opts['format'] = f"{fmt}+bestaudio"
        else:
            ydl_opts['format'] = 'bestvideo+bestaudio'
        
        ydl_opts['merge_output_format'] = 'mp4'

    try:
        with yt.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            info = ydl.extract_info(url, download=False) # Get filename info
            filename = ydl.prepare_filename(info)
            if is_audio:
                 # Extension changes to mp3 after postprocessing
                 filename = filename.rsplit('.', 1)[0] + '.mp3'
            
        return True, filename
    except Exception as e:
        return False, str(e)

if __name__ == "__main__":
    results = search("Running Up That Hill")

    for i, result in enumerate(results):
        print(f"{i + 1}. {result['title']}\n{result['channel']}\n{result['views']} views \n{result['duration']} seconds \n {result['url']}")
        print(getVideoInfo(result['url']))