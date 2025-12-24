import { Telegraf, Markup } from "telegraf";

// ========== ENV VARS ==========
const BOT_TOKEN      = process.env.BOT_TOKEN;
const ADMIN_CHAT     = process.env.ADMIN_CHAT; // staff/admin chat id or @channel
const GROUP_ID       = process.env.GROUP_ID;   // numeric chat id for your community (e.g. -1001234567890)
const COMMUNITY_URL  = process.env.COMMUNITY_URL || "https://t.me/elitez_club_community";
const JOIN_URL       = process.env.JOIN_URL || "https://elitez.club/join";
const SUPPORT_USER   = process.env.SUPPORT_USER || "elitez_club"; // without @
// ===============================

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing!");
const bot = new Telegraf(BOT_TOKEN);

// In-memory state (replace with DB later)
const stateStore = {}; // { [userId]: { status: "new"|"waiting_join"|"done", startedAt, startCount } }

function getUserMeta(ctx) {
  const id = ctx.from.id;
  const username = ctx.from.username ? "@" + ctx.from.username : "(no username)";
  const firstName = ctx.from.first_name || "";
  const lastName = ctx.from.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim() || "(no name)";
  return { id, username, fullName };
}

function getState(ctx) {
  const { id } = getUserMeta(ctx);
  if (!stateStore[id]) {
    stateStore[id] = { status: "new", startedAt: Date.now(), startCount: 0 };
  }
  return stateStore[id];
}

async function notifyAdmin(ctx, text) {
  if (!ADMIN_CHAT) return;
  try {
    await ctx.telegram.sendMessage(ADMIN_CHAT, text);
  } catch (e) {
    console.error("ADMIN_CHAT notify error:", e);
  }
}

function supportLink(fullName = "") {
  const text = encodeURIComponent(
    `Hi, I need help with Elitez Club free access.\nName: ${fullName || "N/A"}`
  );
  return `https://t.me/${SUPPORT_USER}?text=${text}`;
}

// ---------- UI blocks ----------
function joinGateKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("👥 Join the Community", COMMUNITY_URL)],
    [Markup.button.callback("✅ I Joined", "joined_community")]
  ]);
}

function accessKeyboard(fullName) {
  return Markup.inlineKeyboard([
    [Markup.button.url("🚪 Claim Free Access", JOIN_URL)],
    [Markup.button.url("💬 Contact Support", supportLink(fullName))],
    [Markup.button.url("👥 Community", COMMUNITY_URL)]
  ]);
}

// ========== START ==========
bot.start(async (ctx) => {
  const { id, username, fullName } = getUserMeta(ctx);
  const state = getState(ctx);

  state.startCount += 1;

  // record lead + log admin (always, or only first time — I’ll do always but label it)
  const leadLabel = state.startCount === 1 ? "🟢 New lead (START)" : `🟡 START again (x${state.startCount})`;

  await notifyAdmin(
    ctx,
    `${leadLabel}\n\n` +
      `👤 Name: ${fullName}\n` +
      `📛 User: ${username}\n` +
      `🆔 ID: ${id}\n` +
      `🕒 Time: ${new Date().toISOString()}`
  );

  // If already verified before
  if (state.status === "done") {
    await ctx.reply(
      "✅ You’re already verified.\n\nFree access (limited time):",
      accessKeyboard(fullName)
    );
    return;
  }

  // Force join-first
  state.status = "waiting_join";
  await ctx.reply(
    "Welcome to Elitez Club 👑\n\n" +
      "Step 1: Join the community.\n" +
      "Step 2: Tap ✅ I Joined to unlock the free access link.",
    joinGateKeyboard()
  );
});

// ========== VERIFY JOIN ==========
bot.action("joined_community", async (ctx) => {
  const { id, username, fullName } = getUserMeta(ctx);
  const state = getState(ctx);

  await ctx.answerCbQuery();

  // If GROUP_ID missing, can't verify — fallback
  if (!GROUP_ID) {
    state.status = "done";
    await ctx.reply(
      "✅ Access unlocked.\n\nFree access is live for a limited time:",
      accessKeyboard(fullName)
    );

    await notifyAdmin(
      ctx,
      `🟣 Unlocked without verification (GROUP_ID missing)\n\n` +
        `👤 ${fullName}\n📛 ${username}\n🆔 ${id}`
    );
    return;
  }

  try {
    const member = await ctx.telegram.getChatMember(GROUP_ID, id);

    if (["member", "administrator", "creator"].includes(member.status)) {
      state.status = "done";

      await ctx.reply(
        "✅ Verified.\n\nFree access is live for a limited time:",
        accessKeyboard(fullName)
      );

      await notifyAdmin(
        ctx,
        `✅ Verified community join + unlocked access\n\n` +
          `👤 ${fullName}\n` +
          `📛 ${username}\n` +
          `🆔 ${id}`
      );
    } else {
      await ctx.reply(
        "❌ I can’t confirm your join yet.\n\n" +
          "Join the community first, then tap ✅ I Joined again.",
        joinGateKeyboard()
      );
    }
  } catch (err) {
    console.error("Join check error:", err);

    await ctx.reply(
      "⚠️ I couldn’t verify right now.\n\n" +
        "Try again in a minute.",
      joinGateKeyboard()
    );
  }
});

// ========== Commands ==========
bot.command("help", async (ctx) => {
  await ctx.reply(
    "Elitez Club Bot 👑\n\n" +
      "• Join the community\n" +
      "• Verify\n" +
      "• Get free access link\n\n" +
      "Tap below to begin:",
    Markup.inlineKeyboard([[Markup.button.callback("🚀 Start", "restart_flow")]])
  );
});

bot.action("restart_flow", async (ctx) => {
  await ctx.answerCbQuery();
  const state = getState(ctx);
  state.status = "new";
  await ctx.reply("Restarted. Tap /start to begin.");
});

// Generic text handler
bot.on("text", async (ctx) => {
  const entities = ctx.message.entities;
  if (entities && entities.some((e) => e.type === "bot_command")) return;

  const state = getState(ctx);
  const { fullName } = getUserMeta(ctx);

  if (state.status === "waiting_join") {
    await ctx.reply(
      "Join the community first, then tap ✅ I Joined.",
      joinGateKeyboard()
    );
    return;
  }

  if (state.status === "done") {
    await ctx.reply("Free access (limited time):", accessKeyboard(fullName));
    return;
  }

  // default
  await ctx.reply("Tap /start to begin.");
});

// ========== START ==========
bot.launch();
console.log("🔥 Elitez Club Join-Gated Bot Started!");
