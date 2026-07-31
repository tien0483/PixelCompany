---
name: analyze_hui_selection
description: "HUI 엔티티 선택 시 발생하는 5-10분의 지연과 과도한 로그 출력 문제를 분석한다. 프로파일링(cProfile 등)을 실행하거나 정적 코드 분석을 수행하여 성능 병목을 찾는다."
---

# Analyze HUI Selection Performance

이 스킬은 `hui-perf-investigator` 에이전트가 HUI의 선택 로직 성능을 분석하기 위해 사용한다.

## 워크플로우

### 1. 로그 및 코드 분석
- HUI 실행 시 출력되는 로그 형식과 발생 빈도를 확인한다. (특히 "lots of messages shown on Logs screen"의 원인을 찾는다.)
- `tools/akselos/ui/` 및 `tools/akselos/ui_core/` 내의 selection 관련 함수(예: `select_elements`, `highlight_component`)의 O(N) 순회나 불필요한 이벤트 트리거 로직을 중점적으로 검토한다.

### 2. 프로파일링 실행 (필요시)
- 로컬 환경에서 HUI를 실행하고 엔티티 선택을 시뮬레이션하는 파이썬 스크립트를 작성하여 `cProfile`로 분석한다.
- GUI 환경이 불가능한 경우 헤드리스(headless) 모드로 코어 모듈만 import 하여 병목을 측정한다.

### 3. 경계면 분석
- Python(PySide2/QML)과 Rust(ui_core) 간의 데이터 전달 횟수를 확인한다. 한 번의 선택 동작에 수천/수만 번의 렌더링 이벤트가 방출되는 루프 버그가 있는지 조사한다.

## 제약 사항
- `scrbe/` 디렉토리는 접근 금지 영역이므로 절대 조사하지 않는다.
- 발견된 성능 이슈는 `_workspace/hui_perf_analysis.md`에 정리하여 오케스트레이터 및 팀원과 공유한다.
