# Init Warp Skill

Initialize WARP (Graphify + Cocoindex) for a specific target directory.

## Usage
/init_warp <path>

## Implementation
**Windows (PowerShell - routes to isolated WSL):**
```powershell
powershell -ExecutionPolicy Bypass -File ./warp.ps1 init <path>
```

**Linux / macOS / Native WSL Zsh:**
```bash
./warp.sh init <path>
```
