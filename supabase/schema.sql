-- SoundMind AI — error_logs 테이블 (SPEC.md Harness Bridge Schema)
-- Supabase SQL Editor에서 실행하세요

CREATE TABLE IF NOT EXISTS error_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 에러 분류
  error_type      TEXT NOT NULL,

  -- 원시 에러 데이터 (JSON)
  raw_log         JSONB NOT NULL,
  -- { message, stack, component, line, user_agent, timestamp }

  -- Self-Healing 상태 머신
  status          TEXT NOT NULL DEFAULT 'detecting'
                  CHECK (status IN (
                    'detecting',   -- 에러 감지됨
                    'parsing',     -- 원인 분석 중
                    'patching',    -- 패치 생성 중
                    'deploying',   -- Vercel 재배포 중
                    'success',     -- 복구 완료
                    'failed'       -- 자동 복구 불가
                  )),

  -- 생성된 패치 코드 (unified diff 형식)
  patch_code_diff TEXT,

  -- 실시간 스트리밍용 터미널 로그 배열
  healing_log     TEXT[] DEFAULT '{}',

  -- 세션 메타
  session_id      TEXT,
  resolved_at     TIMESTAMPTZ
);

-- Realtime 활성화 (UPDATE 이벤트도 전파)
ALTER TABLE error_logs REPLICA IDENTITY FULL;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_error_logs_status     ON error_logs(status);
CREATE INDEX IF NOT EXISTS idx_error_logs_session    ON error_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_created    ON error_logs(created_at DESC);

-- Supabase Realtime 테이블 등록
-- (Dashboard → Database → Replication에서 error_logs 활성화도 필요)

-- 30일 자동 삭제 (무료 500MB 쿼터 방어)
-- pg_cron 활성화 필요 (Supabase Dashboard → Extensions)
-- SELECT cron.schedule(
--   'delete-old-error-logs',
--   '0 3 * * *',
--   $$DELETE FROM error_logs WHERE created_at < now() - interval '30 days'$$
-- );

-- RLS 비활성화 (내부 서버용 — 필요 시 활성화)
ALTER TABLE error_logs DISABLE ROW LEVEL SECURITY;
