// Isolated research probe; not the ADTeemo voice implementation.
// npm ci, then node probe.mjs [absolute path to dependency package.json]
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import dgram from "node:dgram";
import { once } from "node:events";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const dependencyFile = process.argv[2] ??
  fileURLToPath(new URL("package.json", import.meta.url));
const require = createRequire(resolve(dependencyFile));
const voice = require("@discordjs/voice");
const { OpusEncoder } = require("@discordjs/opus");
const { DAVESession } = require("@snazzah/davey");
const samples = 960; // 20 ms, 48 kHz, stereo PCM16LE
const frameBytes = samples * 2 * 2;
const checks = [];

function check(name, fn) {
  fn();
  checks.push(name);
}

async function deadline(promise, ms = 5000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A research-only mix-minus model. No jitter buffer, network or Discord state.
class Mixer {
  #rooms = new Map();
  #paused = new Set();
  #controlled = true;

  add(id, guilds) {
    assert(guilds.length >= 2);
    assert.equal(new Set(guilds).size, guilds.length);
    for (const guild of guilds) {
      assert(!this.#rooms.has(guild), "guild already reserved");
    }
    for (const guild of guilds) {
      this.#rooms.set(guild, { id, guilds: new Set(guilds) });
    }
  }

  pause(guild, value) {
    if (value) this.#paused.add(guild);
    else this.#paused.delete(guild);
  }

  controlLost() {
    this.#controlled = false;
  }

  leave(guild) {
    const room = this.#rooms.get(guild);
    if (!room) return;
    this.#rooms.delete(guild);
    this.#paused.delete(guild);
    for (const peer of room.guilds) this.#rooms.get(peer)?.guilds.delete(guild);
    if (room.guilds.size <= 2) {
      for (const peer of room.guilds) {
        this.#rooms.delete(peer);
        this.#paused.delete(peer);
      }
    }
  }

  publicState() {
    return [...this.#rooms].map(([guild, room]) => ({
      guild,
      conference: room.id,
    }));
  }

  mix(target, frames) {
    const out = Buffer.alloc(frameBytes);
    const room = this.#rooms.get(target);
    if (!room || !this.#controlled) return out;
    const sources = frames.filter((f) =>
      room.guilds.has(f.guild) && f.guild !== target &&
      f.speaker !== "self-bot" && !this.#paused.has(f.guild)
    );
    for (let offset = 0; offset < frameBytes; offset += 2) {
      let value = 0;
      for (const source of sources) value += source.pcm.readInt16LE(offset);
      out.writeInt16LE(Math.max(-32768, Math.min(32767, value)), offset);
    }
    return out;
  }
}

function constant(guild, value, speaker = guild) {
  const pcm = Buffer.alloc(frameBytes);
  for (let offset = 0; offset < frameBytes; offset += 2) {
    pcm.writeInt16LE(value, offset);
  }
  return { guild, speaker, pcm };
}

function routingProbe() {
  const mixer = new Mixer();
  mixer.add("abc", ["A", "B", "C"]);
  const frames = [constant("A", 100), constant("B", 200), constant("C", 400)];
  check("3サーバーの各出力は他サーバーの音だけを含む", () => {
    assert.equal(mixer.mix("A", frames).readInt16LE(), 600);
    assert.equal(mixer.mix("B", frames).readInt16LE(), 500);
    assert.equal(mixer.mix("C", frames).readInt16LE(), 300);
  });
  check("片方向一時停止は受信と相手向け公開状態を変えない", () => {
    const before = mixer.publicState();
    mixer.pause("A", true);
    assert.equal(mixer.mix("A", frames).readInt16LE(), 600);
    assert.equal(mixer.mix("B", frames).readInt16LE(), 400);
    assert.equal(mixer.mix("C", frames).readInt16LE(), 200);
    assert.deepEqual(mixer.publicState(), before);
    mixer.pause("A", false);
    assert.equal(mixer.mix("B", frames).readInt16LE(), 500);
  });
  check("同一guildを別の中継へ重複登録できない", () => {
    assert.throws(() => mixer.add("duplicate", ["A", "D"]), /reserved/);
  });
  check("3サーバーから1つ離脱しても残り2つは中継する", () => {
    mixer.leave("C");
    assert.equal(mixer.mix("A", frames).readInt16LE(), 200);
    assert.equal(mixer.mix("B", frames).readInt16LE(), 100);
    assert.equal(mixer.mix("C", frames).readInt16LE(), 0);
  });
  check("2サーバーの片側が終了すると双方を停止する", () => {
    mixer.leave("A");
    assert.deepEqual(mixer.publicState(), []);
    assert.equal(mixer.mix("B", frames).readInt16LE(), 0);
  });
  mixer.add("ab", ["A", "B"]);
  mixer.add("cd", ["C", "D"]);
  check("独立した2組で音声が混ざらずBot自身の音を再送しない", () => {
    const all = [
      ...frames,
      constant("D", 800),
      constant("B", 9000, "self-bot"),
    ];
    assert.equal(mixer.mix("A", all).readInt16LE(), 200);
    assert.equal(mixer.mix("B", all).readInt16LE(), 100);
    assert.equal(mixer.mix("C", all).readInt16LE(), 800);
    assert.equal(mixer.mix("D", all).readInt16LE(), 400);
  });
  check("制御接続を失った時点で転送を止める", () => {
    mixer.controlLost();
    assert.equal(mixer.mix("B", frames).readInt16LE(), 0);
  });
}

function adapterProbe() {
  const sent = [];
  let destroyed = false;
  const connection = voice.joinVoiceChannel({
    guildId: "100000000000000001",
    channelId: "100000000000000002",
    selfDeaf: false,
    selfMute: false,
    daveEncryption: true,
    adapterCreator(methods) {
      assert.equal(typeof methods.onVoiceStateUpdate, "function");
      assert.equal(typeof methods.onVoiceServerUpdate, "function");
      return {
        sendPayload(payload) {
          sent.push(payload);
          return true;
        },
        destroy() {
          destroyed = true;
        },
      };
    },
  });
  try {
    assert.equal(sent[0].op, 4);
    assert.equal(sent[0].d.channel_id, "100000000000000002");
  } finally {
    connection.destroy();
  }
  assert.equal(sent.at(-1).d.channel_id, null);
  assert(destroyed);
  checks.push("実ライブラリのadapterで入退室payloadを外部Gatewayへ渡せる");
}

async function udpProbe() {
  const receiver = dgram.createSocket("udp4");
  const sender = dgram.createSocket("udp4");
  try {
    const listening = once(receiver, "listening");
    receiver.bind(0, "127.0.0.1");
    await deadline(listening);
    const codec = new OpusEncoder(48000, 2);
    const packet = codec.encode(constant("A", 100).pcm, samples);
    const received = once(receiver, "message");
    sender.send(packet, receiver.address().port, "127.0.0.1");
    const [data] = await deadline(received);
    assert.deepEqual(data, packet);
    assert.equal(codec.decode(data).length, frameBytes);
    checks.push(
      "実UDP socketでOpus packetを往復しdecodeできる（loopbackのみ）",
    );
  } finally {
    receiver.close();
    sender.close();
  }
}

async function signalChild() {
  const socket = dgram.createSocket("udp4");
  const listening = once(socket, "listening");
  socket.bind(0, "127.0.0.1");
  await listening;
  const timer = setInterval(() => {}, 20);
  process.once("SIGTERM", () => {
    clearInterval(timer);
    socket.close(() => {
      process.send({ type: "closed" }, () => process.disconnect());
    });
  });
  process.send({ type: "ready" });
}

async function signalProbe() {
  const child = fork(fileURLToPath(import.meta.url), [
    dependencyFile,
    "--signal-child",
  ], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  const exit = once(child, "exit");
  try {
    const [ready] = await deadline(once(child, "message"));
    assert.equal(ready.type, "ready");
    const closed = once(child, "message");
    const start = performance.now();
    child.kill("SIGTERM");
    assert.equal((await deadline(closed))[0].type, "closed");
    assert.deepEqual(await deadline(exit), [0, null]);
    const ms = performance.now() - start;
    assert(ms < 10000);
    checks.push("実SIGTERMでUDP socketとtimerを閉じ、強制exitなしで終了する");
    return +ms.toFixed(2);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

function benchmark(groups, frames = 1500) {
  const mixer = new Mixer();
  for (const [i, guilds] of groups.entries()) mixer.add(String(i), guilds);
  const guilds = groups.flat();
  // Independent encoder/decoder state per stream. Input generation is not timed.
  const inputs = guilds.flatMap((guild, g) =>
    Array.from({ length: 5 }, (_, speaker) => {
      const inputEncoder = new OpusEncoder(48000, 2);
      const packets = Array.from({ length: 50 }, (_, frame) => {
        const pcm = Buffer.alloc(frameBytes);
        for (let s = 0; s < samples; s++) {
          const value = Math.round(
            1500 * Math.sin(
              2 * Math.PI * (180 + g * 60 + speaker * 13) *
                (frame * samples + s) / 48000,
            ),
          );
          pcm.writeInt16LE(value, s * 4);
          pcm.writeInt16LE(value, s * 4 + 2);
        }
        return inputEncoder.encode(pcm, samples);
      });
      return { guild, speaker, packets, decoder: new OpusEncoder(48000, 2) };
    })
  );
  const encoders = guilds.map(() => new OpusEncoder(48000, 2));
  for (const encoder of encoders) encoder.setBitrate(64000);
  const durations = [];
  const cpu = process.cpuUsage();
  const start = performance.now();
  let outputBytes = 0;
  for (let frame = 0; frame < frames; frame++) {
    const frameStart = performance.now();
    const decoded = inputs.map((input) => ({
      guild: input.guild,
      speaker: input.speaker,
      pcm: input.decoder.decode(input.packets[frame % 50]),
    }));
    for (const [i, guild] of guilds.entries()) {
      outputBytes +=
        encoders[i].encode(mixer.mix(guild, decoded), samples).length;
    }
    durations.push(performance.now() - frameStart);
  }
  const wallMs = performance.now() - start;
  const used = process.cpuUsage(cpu);
  durations.sort((a, b) => a - b);
  const percentile = (p) =>
    +durations[Math.floor((durations.length - 1) * p)].toFixed(2);
  return {
    groups,
    simultaneousSpeakers: inputs.length,
    simulatedSeconds: frames * 0.02,
    wallMs: +wallMs.toFixed(2),
    cpuMsPerAudioSecond: +((used.user + used.system) / 1000 / (frames * 0.02))
      .toFixed(2),
    frameMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    },
    opusOutputBytes: outputBytes,
    rssMiB: +(process.memoryUsage().rss / 1024 ** 2).toFixed(2),
  };
}

if (process.argv[3] === "--signal-child") {
  await signalChild();
} else {
  routingProbe();
  adapterProbe();
  check("DAVE protocol 1のnative sessionを作成しkey packageを生成する", () => {
    const session = new DAVESession(
      1,
      "100000000000000003",
      "100000000000000002",
    );
    assert.equal(session.protocolVersion, 1);
    assert(session.getSerializedKeyPackage().length > 0);
    assert.equal(session.ready, false); // No server handshake has occurred.
    session.reset();
  });
  await udpProbe();
  const sigtermMs = await signalProbe();
  const benchmarks = [
    benchmark([["A", "B"]]),
    benchmark([["A", "B", "C"]]),
    benchmark([["A", "B"], ["C", "D"]]),
  ];
  console.log(JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel: cpus()[0]?.model,
      dependencies: voice.generateDependencyReport(),
      checks,
      sigtermMs,
      benchmarks,
      peakRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(2),
      limitations: [
        "No Cloud Run deployment, Discord connection or complete DAVE handshake.",
        "Synthetic PCM; no network jitter, loss, audio quality or DAVE media cost measurement.",
        "Routing and lifecycle are probe models, not application acceptance tests.",
      ],
    },
    null,
    2,
  ));
}
