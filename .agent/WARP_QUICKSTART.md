# WARP Quickstart Guide

WARP is a Unified Codebase Intelligence System that combines architecture analysis, incremental code search, and token compression.

## Prerequisites
- `ccc` (Cocoindex CLI): `pip install cocoindex-code`
- `graphify` (Graphify CLI): `pip install graphifyy`
- `onwatch` (AI API Quota Dashboard): **INSTALLED** (C:\Users\ADMIN\.onwatch\bin\onwatch.exe)

### OpenRouter Embedding Configuration
Since you are using OpenRouter for embeddings, you must set the OpenRouter base URL and provide your API key.

#### 1. Set Environment Variables
**Windows (PowerShell):**
```powershell
$env:OPENAI_API_KEY = "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"
$env:OPENAI_BASE_URL = "https://openrouter.ai/api/v1"
$env:COCOINDEX_CODE_EMBEDDING_PROVIDER = "litellm"
$env:COCOINDEX_CODE_EMBEDDING_MODEL = "openrouter/nvidia/llama-nemotron-embed-vl-1b-v2:free"
```

**Linux / macOS (Bash/Zsh):**
```bash
export OPENAI_API_KEY="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"
export OPENAI_BASE_URL="https://openrouter.ai/api/v1"
export COCOINDEX_CODE_EMBEDDING_PROVIDER="litellm"
export COCOINDEX_CODE_EMBEDDING_MODEL="openrouter/nvidia/llama-nemotron-embed-vl-1b-v2:free"
```

#### 2. Local .env File
A `.env` file has been created in the project root with these credentials to ensure WARP and Cocoindex use them automatically.

---

## Core Commands (AI Slash Commands)

### 1. Initialize
Set up WARP for a specific directory.
```bash
/init_warp <path>
```

### 2. Update
Sync architecture and index.
```bash
/update_warp
```

### 3. Clean
Remove all WARP artifacts.
```bash
/clean_warp <path>
```

## Token Compression (Caveman)
To reduce verbose prose, use:
```bash
/caveman full
```

---

## onWatch (CLI Tool)

`onwatch` monitors AI API usage and quotas across providers.

### Configuration (Action Required)
To complete the setup for **AIagenthelper**, please run the following in your terminal and follow the prompts:
```bash
onwatch setup
```
When prompted for dashboard credentials, use:
- **Username:** `admin`
- **Password:** `123456`

### Usage
Run `onwatch` explicitly in your terminal to view the dashboard:
```bash
onwatch
# Opens http://localhost:9211
```

Check quota status via CLI:
```bash
onwatch status
```

---

## Universal Workspace
WARP commands work in:
- Claude Code
- Gemini CLI
- Antigravity
- Cursor (via `warp.sh`)
