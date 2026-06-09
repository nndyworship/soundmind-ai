# CLAUDE.md
> Based on Boris Cherny's CLAUDE.md — adapted for SoundMind AI project

---

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for **ANY non-trivial task** (3+ steps or architectural decisions)
- If something goes sideways, **STOP and re-plan immediately**
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After **ANY correction** from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- **Never** mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: *"Would a staff engineer approve this?"*
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask *"is there a more elegant way?"*
- If a fix feels hacky: *"Knowing everything I know now, implement the elegant solution"*
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: **just fix it**. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

---

## Task Management

1. **Plan First** — Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan** — Check in before starting implementation
3. **Track Progress** — Mark items complete as you go
4. **Explain Changes** — High-level summary at each step
5. **Document Results** — Add review section to `tasks/todo.md`
6. **Capture Lessons** — Update `tasks/lessons.md` after corrections

---

## Core Principles

- **Simplicity First** — Make every change as simple as possible. Impact minimal code.
- **No Laziness** — Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact** — Changes should only touch what's necessary. Avoid introducing bugs.

---

## Project-Specific Rules (SoundMind AI)

### 비용 원칙 (절대 준수)
- 브라우저 단에서 **단 1원의 비용도 발생 금지** — 완전 무료 오픈소스 코드만
- 운영비용 **$0 유지** — 유료 API 전환 없음
- 모델 교체 금지: Gemini, GPT-4 등 유료 모델 전환 불가 — **Groq 무료 유지**
- API 키: `.env.local`에만 저장, 코드 하드코딩 절대 금지, git 커밋 절대 금지

### Web Audio API 규칙
- `onaudioprocess` / `ScriptProcessor` 콜백 안에서 **캔버스 조작 금지** (메인스레드 블로킹)
- 모든 rAF 루프 함수 첫 줄에 반드시 `if (cancelled) return` 가드 추가
- AudioContext 설정은 항상 `ctx.resume().then(doSetup)` 패턴 사용 (suspended 컨텍스트 대응)
- AnalyserNode는 반드시 신호 체인에 포함: `source → analyser → silencer → destination`

### Canvas API 규칙
- Canvas 2D API는 CSS `var()` 미지원 → **모든 색상 하드코딩 필수**
- 표준 팔레트: `ok: #00c853` / `caution: #ffd600` / `danger: #ff1744` / `bg: #0d0d10`

### React + rAF 패턴
- rAF 클로저에서 최신 prop 읽기엔 **ref 사용** (stale closure 방지)
  ```typescript
  tpLRef.current = tpL  // 렌더 중 동기 대입
  const draw = () => { const cur = tpLRef.current }  // 항상 최신값
  ```
- 애니메이션 낙하/페이드는 **시간 기반** 구현 (`performance.now()` — 프레임레이트 독립적)
- Props 변경이 아닌 연속 rAF 루프로 60fps 애니메이션 구현
