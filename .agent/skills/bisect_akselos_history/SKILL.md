---
name: bisect_akselos_history
description: "akselos-2026.07과 akselos-2026.04 버전 사이의 git 커밋 히스토리를 분석하고 회귀(regression) 지점을 찾는다. 특정 브랜치 간의 변경사항 비교 시 이 스킬을 사용하라."
---

# Bisect Akselos History

이 스킬은 `repo-historian` 에이전트가 HUI 성능 저하 원인이 되는 커밋을 찾기 위해 사용한다.

## 워크플로우

### 1. 버전 확인 및 커밋 범위 산정
- `git tag -l | grep akselos-2026` 명령어를 통해 대상 태그(`akselos-2026.04`, `akselos-2026.07`)의 존재를 확인한다.
- `git log --oneline akselos-2026.04..akselos-2026.07` 범위를 스캔한다.

### 2. 타겟 디렉토리 필터링
- 전체 커밋을 모두 보는 대신, 성능 이슈와 연관 가능성이 높은 `hui/`, `tools/akselos/ui/`, `tools/akselos/ui_core/`, `tools/akselos/model/` 경로를 수정한 커밋만 필터링하여 리스트를 추출한다.
- `git log --oneline akselos-2026.04..akselos-2026.07 -- hui/ tools/akselos/ui/ tools/akselos/ui_core/`

### 3. 주요 커밋 심층 분석
- 필터링된 커밋 중에서 "cache", "selection", "event loop", "render", "update" 등의 키워드를 포함하는 커밋의 `git show` 혹은 `git diff`를 확인한다.
- O(N) 순회가 추가되었거나 캐시가 무효화된 로직을 식별한다.

### 4. 결과 공유
- 식별된 주요 의심 커밋 목록과 수정된 파일 내역을 `_workspace/git_history_analysis.md`에 기록하고 팀원(`hui-perf-investigator`)에게 전달하여 의견을 구한다.
