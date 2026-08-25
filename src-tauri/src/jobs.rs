use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tokio::process::{Child, ChildStderr};

pub struct JobEntry {
    pub child: Child,
    pub stderr: Option<ChildStderr>,
    pub video_id: String,
    pub ext: String,
    pub dir: PathBuf,
    pub started: std::time::SystemTime,
}

#[derive(Default)]
pub struct JobRegistry {
    next_id: AtomicU64,
    jobs: Mutex<HashMap<u64, JobEntry>>,
}

impl JobRegistry {
    pub fn insert(&self, entry: JobEntry) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.jobs.lock().unwrap().insert(id, entry);
        id
    }

    pub fn take(&self, id: u64) -> Option<JobEntry> {
        self.jobs.lock().unwrap().remove(&id)
    }
}
