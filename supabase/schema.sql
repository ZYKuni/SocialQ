-- SocialQ 小区试点的数据库结构。
-- 用法：在 Supabase 控制台的 SQL Editor 里整段粘贴运行一次。重复运行是安全的。
--
-- 所有读写都经过 Next.js 的服务端接口（用 service role key），浏览器从不直连数据库。
-- 所以每张表都打开行级安全（RLS）且不建任何策略：匿名 key 什么都读不到。

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  nickname_key text not null unique,          -- 小写去空格后的昵称，用来保证昵称不重复
  password_hash text not null,
  wechat text,                                -- 选填；只在双方都点了“想认识”后给对方看
  created_at timestamptz not null default now()
);

create table if not exists cards (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  version int not null,
  tier text not null default 'full',          -- full：完整卡；quick：速通卡
  card jsonb not null,                        -- 人格卡 v2 的完整 JSON
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, version)
);
create index if not exists cards_user_idx on cards (user_id, version desc);

create table if not exists rounds (
  id bigint generated always as identity primary key,
  status text not null default 'review',      -- review：等你审核；published：已发布给用户
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  round_id bigint not null references rounds(id) on delete cascade,
  a_id uuid not null references users(id) on delete cascade,
  b_id uuid not null references users(id) on delete cascade,
  status text not null default 'approved',    -- approved：发布时展示；rejected：你审核时去掉
  overlap real,                               -- 粗筛的兴趣重合分
  shared jsonb,                               -- 共同兴趣
  transcript jsonb,                           -- 分身对话
  judge jsonb,                                -- 裁判结果：理由、风险、开场白、分数
  a_choice text,                              -- like / skip
  b_choice text,
  created_at timestamptz not null default now()
);
create index if not exists matches_a_idx on matches (a_id);
create index if not exists matches_b_idx on matches (b_id);

create table if not exists reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references users(id) on delete cascade,
  target_id uuid not null references users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete cascade,
  type text not null,
  data jsonb,
  created_at timestamptz not null default now()
);

alter table users enable row level security;
alter table cards enable row level security;
alter table rounds enable row level security;
alter table matches enable row level security;
alter table reports enable row level security;
alter table events enable row level security;
