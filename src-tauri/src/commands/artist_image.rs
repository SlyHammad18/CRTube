use reqwest;

/// Deezer search API returns artist results with CDN image URLs.
/// This command is called from the frontend (no CORS issues since reqwest
/// bypasses browser restrictions) and returns the best-match artist's
/// `picture_medium` URL or `None`.
#[tauri::command]
pub async fn search_artist_image(name: String) -> Result<Option<String>, String> {
    let q = name.trim();
    if q.is_empty() {
        return Ok(None);
    }

    let mut url = reqwest::Url::parse("https://api.deezer.com/search/artist")
        .map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("q", q);

    let resp = reqwest::Client::builder()
        .user_agent("CRTube/0.3 (+https://github.com/SlyHammad18/CRTube)")
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let first = body
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|a| a.first());

    match first {
        Some(artist) => {
            let pic = artist
                .get("picture_medium")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Ok(pic)
        }
        None => Ok(None),
    }
}
