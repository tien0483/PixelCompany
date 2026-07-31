# Clean Warp Skill

Remove WARP artifacts for a specific target directory.

## Usage
/clean_warp <path>

## Implementation
**Windows (PowerShell - routes to isolated WSL):**
```powershell
powershell -ExecutionPolicy Bypass -File ./warp.ps1 clean <path>
```

**Linux / macOS / Native WSL Zsh:**
```bash
./warp.sh clean <path>
```
