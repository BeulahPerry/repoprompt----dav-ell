use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize)]
pub struct TreeNode {
    #[serde(rename = "type")]
    pub node_type: String,
    pub path: String,
    pub children: Option<HashMap<String, TreeNode>>,
}

#[derive(Deserialize)]
pub struct DirectoryQuery {
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct FileResult {
    pub success: bool,
    pub content: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct FilesRequest {
    pub paths: Vec<String>,
}