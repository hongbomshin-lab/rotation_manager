-- ============================================
-- 치과 원내생 실습 로테이션 관리 시스템 - DB 스키마
-- Supabase SQL Editor에서 실행하세요
-- ============================================

-- 1. departments (진료과)
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rotation_order INT NOT NULL UNIQUE
);

-- 2. profiles (사용자 프로필 - Supabase Auth 연동)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  group_id INT NOT NULL CHECK (group_id BETWEEN 1 AND 10),
  is_leader BOOLEAN DEFAULT FALSE
);

-- 3. tasks (과제)
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  group_id INT NOT NULL CHECK (group_id BETWEEN 1 AND 10),
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date DATE,
  rotation_day INT -- 로테이션 시작 후 N일차 (1=월, 2=화, ... 5=금)
);

-- 4. task_progress (과제 진행 상황)
CREATE TABLE IF NOT EXISTS task_progress (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_completed BOOLEAN DEFAULT FALSE,
  UNIQUE(task_id, user_id)
);

-- 5. daily_guides (일일 가이드)
CREATE TABLE IF NOT EXISTS daily_guides (
  id SERIAL PRIMARY KEY,
  group_id INT NOT NULL CHECK (group_id BETWEEN 1 AND 10),
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  target_date DATE,
  attendance_time TIME,
  dress_code TEXT,
  materials TEXT,
  comment TEXT
);

-- 6. messages (조장이 보낸 메시지)
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  group_id INT NOT NULL CHECK (group_id BETWEEN 1 AND 10),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. message_recipients (메시지 수신자)
CREATE TABLE IF NOT EXISTS message_recipients (
  id SERIAL PRIMARY KEY,
  message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  UNIQUE(message_id, recipient_id)
);

-- 8. group_settings (조별 설정 - 주차 넘기기 등)
CREATE TABLE IF NOT EXISTS group_settings (
  group_id INT PRIMARY KEY CHECK (group_id BETWEEN 1 AND 10),
  manual_week_override INT DEFAULT 0
);

-- ============================================
-- 시드 데이터: 10개 진료과
-- ============================================
INSERT INTO departments (name, rotation_order)
SELECT name, rotation_order FROM (VALUES
  ('구강내과', 1),
  ('외부턴', 2),
  ('치과마취과', 3),
  ('소아치과', 4),
  ('치과교정과', 5),
  ('치과보철과', 6),
  ('치과보존과', 7),
  ('치주과', 8),
  ('구강악안면외과', 9),
  ('영상치의학과', 10)
) AS v(name, rotation_order)
WHERE NOT EXISTS (SELECT 1 FROM departments);

-- ============================================
-- 권한 부여 (PostgREST API 접근용)
-- ============================================
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT ON departments TO anon, authenticated;

GRANT ALL ON profiles TO anon, authenticated;
GRANT ALL ON tasks TO anon, authenticated;
GRANT ALL ON task_progress TO anon, authenticated;
GRANT ALL ON daily_guides TO anon, authenticated;
GRANT ALL ON messages TO anon, authenticated;
GRANT ALL ON message_recipients TO anon, authenticated;
GRANT ALL ON group_settings TO anon, authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 스키마 캐시 리로드
NOTIFY pgrst, 'reload schema';
