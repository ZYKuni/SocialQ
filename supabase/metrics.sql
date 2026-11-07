-- 试点指标。在 Supabase 的 SQL Editor 里运行，每段单独选中执行即可。

-- 1. 建卡情况：注册人数、有卡人数、完整卡和速通卡各多少
select
  (select count(*) from users) as 注册人数,
  (select count(distinct user_id) from cards) as 有卡人数,
  (select count(distinct user_id) from cards where tier = 'full') as 完整卡人数,
  (select count(distinct user_id) from cards where tier = 'quick') as 速通卡人数;

-- 2. 每一轮的核心指标：双方都看过的配对里，双方都点“想认识”的比例
select
  round_id as 轮次,
  count(*) filter (where status = 'approved') as 发布的配对,
  count(*) filter (where a_choice is not null and b_choice is not null) as 双方都选了,
  count(*) filter (where a_choice = 'like' and b_choice = 'like') as 双向想认识,
  round(100.0 * count(*) filter (where a_choice = 'like' and b_choice = 'like')
    / nullif(count(*) filter (where a_choice is not null and b_choice is not null), 0), 1) as 双向想认识率
from matches
group by round_id
order by round_id;

-- 3. 开奖回访：每一轮发布后来看配对的人数
select r.id as 轮次, count(distinct e.user_id) as 来看配对的人数
from rounds r
left join events e on e.type = 'matches_viewed' and (e.data->>'round')::bigint = r.id
group by r.id
order by r.id;

-- 4. 举报记录（需要你跟进）
select r.created_at, a.nickname as 举报人, b.nickname as 被举报人, r.reason
from reports r join users a on a.id = r.reporter_id join users b on b.id = r.target_id
order by r.created_at desc;
