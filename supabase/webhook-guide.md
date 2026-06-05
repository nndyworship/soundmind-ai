# Supabase → GitHub Actions 웹훅 설정 가이드

## 개요

```
앱 에러 발생
  → error_logs INSERT (status='detecting')
  → Supabase Database Webhook
  → GitHub Repository Dispatch API
  → GitHub Actions: self-healing.yml 트리거
  → Claude API 분석 + 패치
  → Git 커밋 + Vercel 자동 배포
  → error_logs UPDATE (status='success')
  → LiveConsole WebSocket 스트리밍
```

---

## Step 1: GitHub Secrets 설정

GitHub 저장소 → Settings → Secrets and variables → Actions

| Secret 이름             | 값                        |
|------------------------|---------------------------|
| `ANTHROPIC_API_KEY`    | `sk-ant-...`              |
| `SUPABASE_URL`         | `https://xxxx.supabase.co`|
| `SUPABASE_SERVICE_KEY` | `eyJ...` (service_role 키)|

---

## Step 2: Supabase Database Webhook 설정

Supabase Dashboard → Database → Webhooks → Create a new hook

### 설정값

| 항목         | 값                                          |
|------------|---------------------------------------------|
| Name       | `trigger-github-healing`                    |
| Table      | `error_logs`                                |
| Events     | ✅ INSERT                                    |
| Type       | HTTP Request                                |
| Method     | POST                                        |
| URL        | `https://api.github.com/repos/{OWNER}/{REPO}/dispatches` |

### HTTP 헤더
```
Authorization: Bearer {GITHUB_PAT_TOKEN}
Accept: application/vnd.github+json
Content-Type: application/json
X-GitHub-Api-Version: 2022-11-28
```

> GITHUB_PAT_TOKEN: GitHub → Settings → Developer settings → Personal access tokens
> 필요 권한: `repo` (write:actions 포함)

### HTTP Body (Supabase Webhook Template)
```json
{
  "event_type": "soundmind-error",
  "client_payload": {
    "error_log_id": "{{ record.id }}",
    "error_type":   "{{ record.error_type }}",
    "session_id":   "{{ record.session_id }}"
  }
}
```

---

## Step 3: Supabase Realtime 활성화

Dashboard → Database → Replication

- `error_logs` 테이블 → **Enable** 토글 ON

---

## Step 4: 선택적 RPC 함수 (healing_log 배열 append)

SQL Editor에서 실행:

```sql
CREATE OR REPLACE FUNCTION append_healing_log_rpc(
  p_id     UUID,
  p_line   TEXT,
  p_status TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE error_logs
  SET
    status      = p_status,
    healing_log = array_append(healing_log, p_line),
    resolved_at = CASE
                    WHEN p_status IN ('success','failed') THEN NOW()
                    ELSE resolved_at
                  END
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;
```

---

## Step 5: 수동 테스트

GitHub → Actions → SoundMind Self-Healing Harness → Run workflow

| Input         | 값                              |
|--------------|----------------------------------|
| error_log_id  | Supabase에서 복사한 UUID         |
| dry_run       | `true` (첫 테스트는 dry-run 권장) |

---

## 로컬 개발 테스트

```bash
# .env.local에서 환경변수 로드 후 테스트
node scripts/test-heal.mjs
```
