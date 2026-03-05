// ========================================
// Supabase 설정
// ========================================
const SUPABASE_URL = 'https://xcfsgxpdxwhktmzhavnk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjZnNneHBkeHdoa3Rtemhhdm5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1Nzg5NjMsImV4cCI6MjA4ODE1NDk2M30.EICGizPyHzjdjDkATUjEkrL5yzub5aliYXFtxtEt9Vo';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ========================================
// 상수
// ========================================
// 1주차 월요일: 2026-03-02가 3주차이므로 1주차는 2026-02-16
const ROTATION_START_DATE = new Date('2026-02-16T00:00:00+09:00');

const DEPARTMENT_NAMES = [
  '구강내과',       // rotation_order 1
  '외부턴',         // rotation_order 2
  '치과마취과',     // rotation_order 3
  '소아치과',       // rotation_order 4
  '치과교정과',     // rotation_order 5
  '치과보철과',     // rotation_order 6
  '치과보존과',     // rotation_order 7
  '치주과',         // rotation_order 8
  '구강악안면외과', // rotation_order 9
  '영상치의학과'    // rotation_order 10
];

// 진료과 캐시
let _departmentsCache = null;

// ========================================
// 로테이션 계산 로직
// ========================================

/**
 * 조별 시작 오프셋 계산
 * 1조: offset 0 → 1,2,3,...,10
 * 2조: offset 9 → 10,1,2,...,9
 * N조: offset (11-N) % 10
 */
function getGroupOffset(groupId) {
  return (11 - groupId) % 10;
}

/** 주어진 날짜가 속한 주의 월요일 반환 */
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=일, 1=월, ...
  const diff = d.getDate() - day + 1; // 일요일(0)이면 +1일(다음주 월), 토요일(6)이면 -5일(이번주 월)
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 현재 몇 주차인지 계산 (1-indexed) */
function getCurrentWeekNumber(date = new Date()) {
  const monday = getMonday(date);
  const startMonday = new Date(ROTATION_START_DATE);
  startMonday.setHours(0, 0, 0, 0);
  const diffMs = monday.getTime() - startMonday.getTime();
  const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  return diffWeeks + 1;
}

/** 해당 조의 이번 주 진료과 인덱스 (0~9) */
function getCurrentDepartmentIndex(groupId, weekNumber = null) {
  if (weekNumber === null) weekNumber = getCurrentWeekNumber();
  const offset = getGroupOffset(groupId);
  return ((offset + weekNumber - 1) % 10 + 10) % 10;
}

/** 해당 조의 이번 주 진료과 이름 */
function getCurrentDepartmentName(groupId, weekNumber = null) {
  return DEPARTMENT_NAMES[getCurrentDepartmentIndex(groupId, weekNumber)];
}

/** 같은 진료과를 지난 주에 담당했던 조 번호 */
function getPreviousGroupId(currentDeptIndex, currentWeekNumber) {
  const prevWeek = currentWeekNumber - 1;
  if (prevWeek < 1) return null;
  for (let g = 1; g <= 10; g++) {
    if (getCurrentDepartmentIndex(g, prevWeek) === currentDeptIndex) {
      return g;
    }
  }
  return null;
}

/** 로컬 날짜 문자열 YYYY-MM-DD */
function getLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** due_date 계산: 월요일 + (rotationDay - 1)일 */
function calculateDueDate(mondayDate, rotationDay) {
  const d = new Date(mondayDate);
  const rDay = (rotationDay !== null && rotationDay !== undefined) ? rotationDay : 1;
  d.setDate(d.getDate() + (rDay - 1));
  return getLocalDateString(d);
}

// ========================================
// 인증 함수
// ========================================

async function getCurrentSession() {
  const { data: { session } } = await _supabase.auth.getSession();
  return session;
}

async function getCurrentUser() {
  const session = await getCurrentSession();
  if (!session) return null;

  const { data, error } = await _supabase
    .from('profiles')
    .select('*')
    .eq('auth_id', session.user.id)
    .single();

  if (error || !data) return null;
  return data;
}

async function fetchGroupMembers(groupId) {
  const { data, error } = await _supabase
    .from('profiles')
    .select('*')
    .eq('group_id', groupId)
    .order('is_leader', { ascending: false })
    .order('name');
  if (error) throw error;
  return data || [];
}

async function signUpUser(email, password, name, groupId, isLeader) {
  // 1. Supabase Auth 회원가입
  const { data, error } = await _supabase.auth.signUp({ email, password });
  if (error) throw error;

  // 2. users 테이블에 프로필 삽입
  if (data.user) {
    const { error: insertError } = await _supabase
      .from('profiles')
      .insert({
        auth_id: data.user.id,
        name: name,
        group_id: parseInt(groupId),
        is_leader: isLeader === true || isLeader === 'true'
      });
    if (insertError) throw insertError;
  }

  return data;
}

async function signInUser(email, password) {
  const { data, error } = await _supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

async function signOut() {
  await _supabase.auth.signOut();
  window.location.href = 'index.html';
}

// ========================================
// departments 캐시
// ========================================

async function loadDepartments() {
  if (_departmentsCache) return _departmentsCache;
  const { data, error } = await _supabase
    .from('departments')
    .select('*')
    .order('rotation_order');
  if (error) throw error;
  _departmentsCache = data;
  return data;
}

/** rotation_order(1~10)로 department 객체 찾기 */
async function getDepartmentByOrder(rotationOrder) {
  const depts = await loadDepartments();
  return depts.find(d => d.rotation_order === rotationOrder);
}

/** department index(0~9)로 department 객체 찾기 */
async function getDepartmentByIndex(index) {
  return getDepartmentByOrder(index + 1);
}

// ========================================
// Tasks CRUD
// ========================================

async function fetchTasks(groupId, departmentId) {
  const { data, error } = await _supabase
    .from('tasks')
    .select('*')
    .eq('group_id', groupId)
    .eq('department_id', departmentId)
    .order('due_date');
  if (error) throw error;
  return data || [];
}

async function fetchTasksWithProgress(groupId, departmentId, userId) {
  const { data, error } = await _supabase
    .from('tasks')
    .select('*, task_progress(id, is_completed, user_id)')
    .eq('group_id', groupId)
    .eq('department_id', departmentId)
    .order('due_date');
  if (error) throw error;

  // 현재 사용자의 진행 상태만 필터링
  return (data || []).map(task => {
    const myProgress = (task.task_progress || []).find(p => p.user_id === userId);
    return {
      ...task,
      is_completed: myProgress ? myProgress.is_completed : false,
      progress_id: myProgress ? myProgress.id : null
    };
  });
}

async function insertTask(task) {
  const { data, error } = await _supabase
    .from('tasks')
    .insert(task)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateTask(taskId, updates) {
  const { data, error } = await _supabase
    .from('tasks')
    .update(updates)
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteTask(taskId) {
  const { error } = await _supabase
    .from('tasks')
    .delete()
    .eq('id', taskId);
  if (error) throw error;
}

// ========================================
// Task Progress
// ========================================

async function upsertTaskProgress(taskId, userId, isCompleted) {
  const { data, error } = await _supabase
    .from('task_progress')
    .upsert(
      { task_id: taskId, user_id: userId, is_completed: isCompleted },
      { onConflict: 'task_id,user_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ========================================
// Daily Guides CRUD
// ========================================

async function fetchDailyGuide(groupId, departmentId, targetDate) {
  const { data, error } = await _supabase
    .from('daily_guides')
    .select('*')
    .eq('group_id', groupId)
    .eq('department_id', departmentId)
    .eq('target_date', targetDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchWeeklyGuides(groupId, departmentId) {
  const monday = getMonday(new Date());

  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() - 1); // 일요일부터

  const saturday = new Date(monday);
  saturday.setDate(saturday.getDate() + 5); // 토요일까지

  const { data, error } = await _supabase
    .from('daily_guides')
    .select('*')
    .eq('group_id', groupId)
    .eq('department_id', departmentId)
    .gte('target_date', getLocalDateString(sunday))
    .lte('target_date', getLocalDateString(saturday))
    .order('target_date');
  if (error) throw error;
  return data || [];
}

async function insertDailyGuide(guide) {
  const { data, error } = await _supabase
    .from('daily_guides')
    .insert(guide)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateDailyGuide(guideId, updates) {
  const { data, error } = await _supabase
    .from('daily_guides')
    .update(updates)
    .eq('id', guideId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteDailyGuide(guideId) {
  const { error } = await _supabase
    .from('daily_guides')
    .delete()
    .eq('id', guideId);
  if (error) throw error;
}

// ========================================
// 이전 조 과제 불러오기 (조장 전용)
// ========================================

async function importPreviousTasks(currentGroupId, currentDeptId, currentDeptIndex) {
  const weekNumber = getCurrentWeekNumber();
  const prevGroupId = getPreviousGroupId(currentDeptIndex, weekNumber);

  if (!prevGroupId) {
    throw new Error('이전 주 데이터가 없습니다 (1주차입니다).');
  }

  // 이전 조의 같은 과 과제 조회
  const { data: prevTasks, error } = await _supabase
    .from('tasks')
    .select('*')
    .eq('group_id', prevGroupId)
    .eq('department_id', currentDeptId);

  if (error) throw error;
  if (!prevTasks || prevTasks.length === 0) {
    throw new Error(`${prevGroupId}조의 이전 과제가 없습니다.`);
  }

  // 이번 주 월요일
  const currentMonday = getMonday(new Date());

  // 새 과제 생성 (rotation_day 기반으로 due_date 재계산)
  const newTasks = prevTasks.map(t => ({
    group_id: currentGroupId,
    department_id: t.department_id,
    title: t.title,
    rotation_day: t.rotation_day,
    due_date: calculateDueDate(currentMonday, t.rotation_day)
  }));

  const { data: inserted, error: insertError } = await _supabase
    .from('tasks')
    .insert(newTasks)
    .select();

  if (insertError) throw insertError;
  return { inserted, prevGroupId };
}

// ========================================
// 이전 조 가이드 불러오기 (조장 전용)
// ========================================

async function importPreviousGuides(currentGroupId, currentDeptId, currentDeptIndex) {
  const weekNumber = getCurrentWeekNumber();
  const prevGroupId = getPreviousGroupId(currentDeptIndex, weekNumber);

  if (!prevGroupId) {
    throw new Error('이전 주 데이터가 없습니다 (1주차입니다).');
  }

  // 이번 주 월요일
  const currentMonday = getMonday(new Date());

  // 지난 주 일요일 ~ 지난 주 토요일 날짜 범위 계산
  const prevMonday = new Date(currentMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);

  const prevSunday = new Date(prevMonday);
  prevSunday.setDate(prevSunday.getDate() - 1);

  const prevSaturday = new Date(prevMonday);
  prevSaturday.setDate(prevSaturday.getDate() + 5);

  // 이전 조의 같은 과 가이드 조회 (지난 주)
  const { data: prevGuides, error } = await _supabase
    .from('daily_guides')
    .select('*')
    .eq('group_id', prevGroupId)
    .eq('department_id', currentDeptId)
    .gte('target_date', getLocalDateString(prevSunday))
    .lte('target_date', getLocalDateString(prevSaturday));

  if (error) throw error;
  if (!prevGuides || prevGuides.length === 0) {
    throw new Error(`${prevGroupId}조의 이전 가이드가 없습니다.`);
  }

  // 새 가이드 생성 (target_date + 7일)
  const newGuides = prevGuides.map(g => {
    const newDate = new Date(g.target_date);
    newDate.setDate(newDate.getDate() + 7);
    return {
      group_id: currentGroupId,
      department_id: g.department_id,
      target_date: getLocalDateString(newDate),
      attendance_time: g.attendance_time,
      dress_code: g.dress_code,
      materials: g.materials,
      comment: g.comment
    };
  });

  const { data: inserted, error: insertError } = await _supabase
    .from('daily_guides')
    .insert(newGuides)
    .select();

  if (insertError) throw insertError;
  return { inserted, prevGroupId };
}

// ========================================
// Messages (조장 → 조원 메시지)
// ========================================

async function sendMessage(senderId, groupId, content, recipientIds) {
  // 1. messages 테이블에 메시지 본문 삽입
  const { data: msg, error: msgError } = await _supabase
    .from('messages')
    .insert({ sender_id: senderId, group_id: groupId, content: content })
    .select()
    .single();
  if (msgError) throw msgError;

  // 2. message_recipients에 수신자 삽입
  const recipients = recipientIds.map(rid => ({
    message_id: msg.id,
    recipient_id: rid,
    is_read: false
  }));
  const { error: recipError } = await _supabase
    .from('message_recipients')
    .insert(recipients);
  if (recipError) throw recipError;

  return msg;
}

async function fetchReceivedMessages(userId) {
  const { data, error } = await _supabase
    .from('message_recipients')
    .select('*, messages(id, content, created_at, sender_id, profiles:sender_id(name))')
    .eq('recipient_id', userId)
    .order('id', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getUnreadMessageCount(userId) {
  const { count, error } = await _supabase
    .from('message_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .eq('is_read', false);
  if (error) throw error;
  return count || 0;
}

async function markMessageAsRead(messageId, userId) {
  const { error } = await _supabase
    .from('message_recipients')
    .update({ is_read: true })
    .eq('message_id', messageId)
    .eq('recipient_id', userId);
  if (error) throw error;
}

async function markAllMessagesAsRead(userId) {
  const { error } = await _supabase
    .from('message_recipients')
    .update({ is_read: true })
    .eq('recipient_id', userId)
    .eq('is_read', false);
  if (error) throw error;
}

// ========================================
// 유틸리티
// ========================================

function getDday(dueDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00+09:00');
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due - today) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'D-Day';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function getDdayStyle(dueDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00+09:00');
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due - today) / (1000 * 60 * 60 * 24));
  if (diff <= 1) return 'text-red-500 bg-red-50 dark:bg-red-900/20 border-red-100';
  if (diff <= 3) return 'text-orange-500 bg-orange-50 dark:bg-orange-900/20 border-orange-100';
  return 'text-blue-500 bg-blue-50 dark:bg-blue-900/20 border-blue-100';
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 인증 필수 - 미로그인 시 index.html로 리다이렉트 */
async function requireAuth() {
  const session = await getCurrentSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = 'index.html';
    return null;
  }
  return user;
}

/** 토스트 알림 표시 */
function showToast(message, type = 'info') {
  const existing = document.getElementById('toast-notification');
  if (existing) existing.remove();

  const colors = {
    info: 'bg-blue-600',
    success: 'bg-green-600',
    error: 'bg-red-600',
    warning: 'bg-orange-500'
  };

  const toast = document.createElement('div');
  toast.id = 'toast-notification';
  toast.className = `fixed top-4 left-1/2 -translate-x-1/2 ${colors[type] || colors.info} text-white px-6 py-3 rounded-xl shadow-lg z-[100] text-sm font-medium transition-all duration-300 opacity-0 translate-y-[-10px]`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0', 'translate-y-[-10px]');
    toast.classList.add('opacity-100', 'translate-y-0');
  });

  setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'translate-y-[-10px]');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
