---
name: hui_perf_orchestrator
description: "HUI(Akselos Modeler) 요소 선택(element/component selection) 시 발생하는 성능 지연(5-10분) 및 과도한 로그 출력 문제를 조사하는 오케스트레이터. akselos-2026.07과 akselos-2026.04 버전 비교 및 성능 디버깅 요청 시 이 스킬을 사용하라. 후속 요청(다시 실행, 업데이트, 특정 부분만 다시 분석)에도 사용하라."
---

# HUI Performance Regression Orchestrator

이 오케스트레이터는 HUI 선택 로직의 성능 회귀 문제를 분석하기 위해 `hui-perf-investigator`와 `repo-historian` 에이전트로 팀을 구성하고 조율한다.

**실행 모드:** 에이전트 팀

## Phase 0: 컨텍스트 확인
1. 기존 작업 산출물(`_workspace/`)이 있는지 확인한다.
2. 이전 결과가 있고 사용자가 특정 부분만 다시 분석하길 원하면 해당 에이전트만 재호출(부분 재실행)한다.
3. 처음 실행하는 것이면 `_workspace/`를 생성하고 전체 워크플로우를 시작한다.

## Phase 1: 현황 분석 및 팀 구성
1. `TeamCreate` 도구를 사용하여 `hui-perf-investigator`와 `repo-historian`로 팀을 구성한다.
2. HUI 선택 성능(5-10분 지연) 문제에 대한 분석 목표를 선언한다.

## Phase 2: 작업 할당 (TaskCreate)
오케스트레이터는 다음 작업들을 할당한다:

1. **Task 1 (repo-historian):** `akselos-2026.04`와 `akselos-2026.07` 태그 간의 커밋 히스토리를 분석하여 `hui/`, `tools/akselos/ui/`, `tools/akselos/ui_core/` 내의 주요 변경사항을 리스트업한다.
2. **Task 2 (hui-perf-investigator):** HUI의 엔티티 선택(selection) 동작을 프로파일링하고, 2026.04 대비 어떤 함수나 이벤트 루프에서 시간이 소요되며 왜 로그가 과도하게 출력되는지 파악한다.

## Phase 3: 자체 조율 및 데이터 전달 (SendMessage)
- `repo-historian`은 커밋 분석 결과를 `hui-perf-investigator`에게 `SendMessage`로 전달한다.
- `hui-perf-investigator`는 전달받은 변경된 파일 중 실제로 성능 병목을 일으킬 만한 코드를 검토하여 핑퐁 토론을 수행한다.

## Phase 4: 결과 수집 및 보고서 작성
1. 오케스트레이터는 두 에이전트의 결과를 종합하여 최종 보고서를 작성한다.
2. 발견된 성능 회귀 원인과 가장 유력한 버그 위치(커밋, 함수)를 명시한다.
3. 결과를 사용자에게 보고하고, `TeamDelete`로 팀을 정리한다.

## 에러 핸들링
- 에이전트가 `cProfile` 또는 `git` 명령어 실행 중 에러를 겪으면, 1회 재시도를 지시한다.
- 재시도 후에도 실패하면 해당 분석은 스킵하고, 현재까지 파악된 정보만으로 결과를 종합하며 보고서에 누락을 명시한다.

## 테스트 시나리오
- 정상 흐름: 두 에이전트가 협업하여 특정 커밋(예: UI 캐시 로직 변경)이 문제임을 지목.
- 에러 흐름: HUI 실행을 위한 디스플레이 환경이 없어 프로파일링이 실패할 경우, 코드 정적 분석과 커밋 히스토리만으로 추정 결론 도출.
