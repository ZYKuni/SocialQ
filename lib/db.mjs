// 小区试点的数据层。两个后端，接口相同，返回的行都是数据库里的 snake_case 字段：
//   supabase：配置了 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 时使用（线上）
//   file：    COMMUNITY_DEV_DB=1 时使用，数据存在本地 JSON 文件里（只用于本地开发和测试）
// 两个都没配时 db 为 null，App 保持原来的演示模式（和样本人物配对）。
// 表结构见 supabase/schema.sql。

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function dbMode(env = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return "supabase";
  if (env.COMMUNITY_DEV_DB === "1") return "file";
  return null;
}

let cached = null;

/** 返回数据层；没配置时返回 null。 */
export async function getDB(env = process.env) {
  const mode = dbMode(env);
  if (!mode) return null;
  if (cached?.mode === mode) return cached;
  cached = mode === "supabase" ? await supabaseDB(env) : fileDB(env);
  return cached;
}

const nowISO = () => new Date().toISOString();

// ---------- Supabase ----------

async function supabaseDB(env) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const must = ({ data, error }) => {
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data;
  };
  return {
    mode: "supabase",
    users: {
      async create({ nickname, nicknameKey, passwordHash }) {
        const res = await sb.from("users").insert({ nickname, nickname_key: nicknameKey, password_hash: passwordHash }).select().single();
        if (res.error?.code === "23505") throw Object.assign(new Error("昵称已被占用"), { code: "nickname_taken" });
        return must(res);
      },
      byKey: async (key) => must(await sb.from("users").select().eq("nickname_key", key).maybeSingle()),
      byId: async (id) => must(await sb.from("users").select().eq("id", id).maybeSingle()),
      update: async (id, patch) => must(await sb.from("users").update(patch).eq("id", id).select().single()),
      remove: async (id) => must(await sb.from("users").delete().eq("id", id)),
      all: async () => must(await sb.from("users").select("id, nickname, wechat, created_at")),
    },
    cards: {
      add: async (row) => must(await sb.from("cards").insert(row).select().single()),
      latest: async (userId) => must(await sb.from("cards").select().eq("user_id", userId).order("version", { ascending: false }).limit(1).maybeSingle()),
      async latestAll() {
        const rows = must(await sb.from("cards").select().order("version", { ascending: false }));
        return latestPerUser(rows);
      },
    },
    rounds: {
      create: async () => must(await sb.from("rounds").insert({ status: "review" }).select().single()),
      latest: async () => must(await sb.from("rounds").select().order("id", { ascending: false }).limit(1).maybeSingle()),
      latestPublished: async () =>
        must(await sb.from("rounds").select().eq("status", "published").order("id", { ascending: false }).limit(1).maybeSingle()),
      publish: async (id) => must(await sb.from("rounds").update({ status: "published", published_at: nowISO() }).eq("id", id).select().single()),
    },
    matches: {
      addMany: async (rows) => must(await sb.from("matches").insert(rows).select()),
      byId: async (id) => must(await sb.from("matches").select().eq("id", id).maybeSingle()),
      update: async (id, patch) => must(await sb.from("matches").update(patch).eq("id", id).select().single()),
      forUserInRound: async (userId, roundId) =>
        must(await sb.from("matches").select().eq("round_id", roundId).eq("status", "approved").or(`a_id.eq.${userId},b_id.eq.${userId}`)),
      inRound: async (roundId) => must(await sb.from("matches").select().eq("round_id", roundId)),
      all: async () => must(await sb.from("matches").select("id, round_id, a_id, b_id, status, a_choice, b_choice")),
    },
    reports: {
      add: async (row) => must(await sb.from("reports").insert(row).select().single()),
      all: async () => must(await sb.from("reports").select()),
    },
    events: {
      add: async (row) => {
        // 埋点失败不影响主流程
        const res = await sb.from("events").insert(row);
        if (res.error) console.error("event error:", res.error.message);
      },
    },
  };
}

function latestPerUser(rows) {
  const seen = new Map();
  for (const r of rows) {
    const cur = seen.get(r.user_id);
    if (!cur || r.version > cur.version) seen.set(r.user_id, r);
  }
  return [...seen.values()];
}

// ---------- 本地文件（开发和测试用） ----------

function fileDB(env) {
  const file = path.resolve(env.COMMUNITY_DEV_DB_PATH || ".data/dev-db.json");
  const empty = () => ({ seq: 0, users: [], cards: [], rounds: [], matches: [], reports: [], events: [] });
  const load = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return empty();
    }
  };
  const save = (db) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db, null, 2));
  };
  const tx = (fn) => {
    const db = load();
    const out = fn(db);
    save(db);
    return structuredClone(out);
  };
  const read = (fn) => structuredClone(fn(load()) ?? null);
  const nextId = (db) => (db.seq += 1);
  const cascade = (db, userId) => {
    db.cards = db.cards.filter((c) => c.user_id !== userId);
    db.matches = db.matches.filter((m) => m.a_id !== userId && m.b_id !== userId);
    db.reports = db.reports.filter((r) => r.reporter_id !== userId && r.target_id !== userId);
    db.events = db.events.filter((e) => e.user_id !== userId);
  };

  return {
    mode: "file",
    users: {
      async create({ nickname, nicknameKey, passwordHash }) {
        return tx((db) => {
          if (db.users.some((u) => u.nickname_key === nicknameKey)) throw Object.assign(new Error("昵称已被占用"), { code: "nickname_taken" });
          const row = { id: randomUUID(), nickname, nickname_key: nicknameKey, password_hash: passwordHash, wechat: null, created_at: nowISO() };
          db.users.push(row);
          return row;
        });
      },
      byKey: async (key) => read((db) => db.users.find((u) => u.nickname_key === key)),
      byId: async (id) => read((db) => db.users.find((u) => u.id === id)),
      update: async (id, patch) =>
        tx((db) => {
          const u = db.users.find((x) => x.id === id);
          Object.assign(u, patch);
          return u;
        }),
      remove: async (id) =>
        tx((db) => {
          db.users = db.users.filter((u) => u.id !== id);
          cascade(db, id);
        }),
      all: async () => read((db) => db.users.map(({ id, nickname, wechat, created_at }) => ({ id, nickname, wechat, created_at }))),
    },
    cards: {
      add: async (row) =>
        tx((db) => {
          if (db.cards.some((c) => c.user_id === row.user_id && c.version === row.version)) throw new Error("版本重复");
          const r = { id: nextId(db), created_at: nowISO(), confirmed_at: null, tier: "full", ...row };
          db.cards.push(r);
          return r;
        }),
      latest: async (userId) => read((db) => latestPerUser(db.cards.filter((c) => c.user_id === userId))[0]),
      latestAll: async () => read((db) => latestPerUser(db.cards)),
    },
    rounds: {
      create: async () =>
        tx((db) => {
          const r = { id: nextId(db), status: "review", created_at: nowISO(), published_at: null };
          db.rounds.push(r);
          return r;
        }),
      latest: async () => read((db) => db.rounds.at(-1)),
      latestPublished: async () => read((db) => db.rounds.filter((r) => r.status === "published").at(-1)),
      publish: async (id) =>
        tx((db) => {
          const r = db.rounds.find((x) => x.id === id);
          Object.assign(r, { status: "published", published_at: nowISO() });
          return r;
        }),
    },
    matches: {
      addMany: async (rows) =>
        tx((db) => {
          const out = rows.map((r) => ({ id: randomUUID(), status: "approved", a_choice: null, b_choice: null, created_at: nowISO(), ...r }));
          db.matches.push(...out);
          return out;
        }),
      byId: async (id) => read((db) => db.matches.find((m) => m.id === id)),
      update: async (id, patch) =>
        tx((db) => {
          const m = db.matches.find((x) => x.id === id);
          Object.assign(m, patch);
          return m;
        }),
      forUserInRound: async (userId, roundId) =>
        read((db) => db.matches.filter((m) => m.round_id === roundId && m.status === "approved" && (m.a_id === userId || m.b_id === userId))),
      inRound: async (roundId) => read((db) => db.matches.filter((m) => m.round_id === roundId)),
      all: async () => read((db) => db.matches.map(({ id, round_id, a_id, b_id, status, a_choice, b_choice }) => ({ id, round_id, a_id, b_id, status, a_choice, b_choice }))),
    },
    reports: {
      add: async (row) =>
        tx((db) => {
          const r = { id: nextId(db), created_at: nowISO(), ...row };
          db.reports.push(r);
          return r;
        }),
      all: async () => read((db) => db.reports),
    },
    events: {
      add: async (row) =>
        tx((db) => {
          db.events.push({ id: nextId(db), created_at: nowISO(), ...row });
        }),
    },
  };
}
