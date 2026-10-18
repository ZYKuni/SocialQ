// 第 1 步：清洗数据 -> 人员档案、候选配对、分层抽样的评测集
// 用法：node experiments/speed-dating/01_prepare.mjs [--n 150]

import fs from "node:fs";
import { P, parseCSV, writeJSON, rng, shuffle, ensureDir } from "./lib/util.mjs";
import { buildPerson } from "./lib/survey.mjs";

const args = process.argv.slice(2);
const N_PER_CLASS = Number(args[args.indexOf("--n") + 1]) || 150;
const SEED = 20260928;

// 原始数据：哥伦比亚大学快速约会实验（Fisman, Iyengar, Kamenica & Simonson, 2006）
const SOURCE_URL = "https://raw.githubusercontent.com/prasertcbs/basic-dataset/master/Speed%20Dating%20Data.csv";
if (!fs.existsSync(P.rawCsv)) {
  console.log(`本地没有原始数据，正在下载：${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}，请手动下载后放到 ${P.rawCsv}`);
  ensureDir(P.rawCsv);
  fs.writeFileSync(P.rawCsv, Buffer.from(await res.arrayBuffer()));
}
const rows = parseCSV(fs.readFileSync(P.rawCsv, "latin1"));
console.log(`读取 ${rows.length} 行约会记录`);

const people = new Map();
for (const row of rows) {
  const iid = Number(row.iid);
  if (!people.has(iid)) people.set(iid, buildPerson(row));
}
const eligiblePeople = [...people.values()].filter((p) => p.eligible);
console.log(`参与者 ${people.size} 人，问卷完整 ${eligiblePeople.length} 人`);

// 每次约会在数据里出现两次（双方各一行），合并成无序配对；标签 match = 双方都选了 Yes
const pairs = new Map();
for (const row of rows) {
  const a = Number(row.iid);
  const b = Number(row.pid);
  if (!Number.isFinite(b) || row.pid === "") continue;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const key = `${lo}-${hi}`;
  if (pairs.has(key) || a !== lo) continue;
  const pa = people.get(lo);
  const pb = people.get(hi);
  if (!pa?.eligible || !pb?.eligible) continue;
  pairs.set(key, {
    id: key,
    a: lo,
    b: hi,
    wave: Number(row.wave),
    match: Number(row.match),
    decA: Number(row.dec), // A 是否对 B 说 Yes
    decB: Number(row.dec_o), // B 是否对 A 说 Yes
  });
}
// 只保留 A 那一行存在的配对（上面的循环已保证），再补漏：若只有 B 那一行存在，则从 B 行构造
for (const row of rows) {
  const a = Number(row.iid);
  const b = Number(row.pid);
  if (!Number.isFinite(b) || row.pid === "" || a < b) continue;
  const key = `${b}-${a}`;
  if (pairs.has(key)) continue;
  const pa = people.get(b);
  const pb = people.get(a);
  if (!pa?.eligible || !pb?.eligible) continue;
  pairs.set(key, { id: key, a: b, b: a, wave: Number(row.wave), match: Number(row.match), decA: Number(row.dec_o), decB: Number(row.dec) });
}

const allPairs = [...pairs.values()];
const pos = allPairs.filter((p) => p.match === 1);
const neg = allPairs.filter((p) => p.match === 0);
console.log(`可用配对 ${allPairs.length} 对，其中互选成功 ${pos.length} 对（${((pos.length / allPairs.length) * 100).toFixed(1)}%）`);

// 分层抽样：正负样本各 N 对。AUC 不受正负比例影响，平衡抽样能用更少的调用得到更窄的置信区间。
const rand = rng(SEED);
const sp = shuffle(pos, rand).slice(0, N_PER_CLASS);
const sn = shuffle(neg, rand).slice(0, N_PER_CLASS);
const sample = [];
for (let i = 0; i < Math.max(sp.length, sn.length); i += 1) {
  if (sp[i]) sample.push(sp[i].id);
  if (sn[i]) sample.push(sn[i].id); // 正负交替排列：跑前 K 对做试点时也是平衡的
}

writeJSON(P.people, Object.fromEntries(eligiblePeople.map((p) => [p.iid, p])));
writeJSON(P.pairs, allPairs);
writeJSON(P.sample, { seed: SEED, nPerClass: N_PER_CLASS, ids: sample });
console.log(`评测集 ${sample.length} 对（正 ${sp.length} / 负 ${sn.length}），已写入 data/`);
