import { Telegraf, Markup } from "telegraf";

// ========== ENV VARS ==========
const BOT_TOKEN      = process.env.BOT_TOKEN;
const ADMIN_CHAT     = process.env.ADMIN_CHAT; // staff/admin chat id or @channel
const JOIN_URL       = process.env.JOIN_URL || "https://elitez.club/join";
const COMMUNITY_URL  = process.env.COMMUNITY_URL || "https://t.me/elitez_club_community";
const SUPPORT_USER   = process.env.SUPPORT_USER || "elitez_club"; // without @
// ===============================

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing!");

const bot = new Telegraf(BOT_TOKEN);

// In-memory lead tracking (swap with DB later)
const leadState = {}; // { [userId]: { startedAt, startCount } }

function getUserMeta(ctx) {
  const id = ctx.from.id;
  const username = ctx.from.username ? "@" + ctx.from.username : "(no username)";
  const firstName = ctx.from.first_name || "";
  const lastName = ctx.from.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim() || "(no name)";
  return { id, username, fullName };
}

async function notifyAdmin(ctx, text) {
  if (!ADMIN_CHAT) return;
  try {
    await ctx.telegram.sendMessage(ADMIN_CHAT, text);
  } catch (e) {
    console.error("ADMIN_CHAT notify error:", e);
  }
}

function recordLead(ctx) {
  const { id } = getUserMeta(ctx);
  const now = Date.now();

  if (!leadState[id]) {
    leadState[id] = { startedAt: now, startCount: 1 };
    return { isNew: true, startCount: 1, startedAt: now };
  }

  leadState[id].startCount += 1;
  return {
    isNew: false,
    startCount: leadState[id].startCount,
    startedAt: leadState[id].startedAt
  };
}

function supportLink() {
  const text = encodeURIComponent("Hi, I need help with Elitez Club free access.");
  return `https://t.me/${SUPPORT_USER}?text=${text}`;
}

// ========== START (record lead + send links) ==========
bot.start(async (ctx) => {
  const { id, username, fullName } = getUserMeta(ctx);
  const lead = recordLead(ctx);

  // log to admin on first start (or always if you want)
  if (lead.isNew) {
    await notifyAdmin(
      ctx,
      `🟢 New lead (START)\n\n` +
      `👤 Name: ${fullName}\n` +
      `📛 User: ${username}\n` +
      `🆔 ID: ${id}\n` +
      `🕒 Time: ${new Date().toISOString()}`
    );
  } else {
    await notifyAdmin(
      ctx,
      `🟡 Returning user clicked START again (x${lead.startCount})\n\n` +
      `👤 ${fullName}\n📛 ${username}\n🆔 ${id}`
    );
  }

  await ctx.reply(
    "Welcome to Elitez Club 👑\n\n" +
    "Free access is live for a limited time.\n" +
    "Create your account below:",
    Markup.inlineKeyboard([
      [Markup.button.url("🚪 Claim Free Access", JOIN_URL)],
      [Markup.button.url("💬 Contact Support", supportLink())],
      [Markup.button.url("👥 Join Community", COMMUNITY_URL)]
    ])
  );
});

// ========== OPTIONAL COMMANDS ==========
bot.command("join", async (ctx) => {
  await ctx.reply(
    "🚪 Create your account here:",
    Markup.inlineKeyboard([
      [Markup.button.url("Claim Free Access", JOIN_URL)],
      [Markup.button.url("Contact Support", supportLink())]
    ])
  );
});

bot.command("support", async (ctx) => {
  await ctx.reply(
    "💬 Support:",
    Markup.inlineKeyboard([
      [Markup.button.url("Message Support", supportLink())]
    ])
  );
});

// ========== BUTTON HANDLERS (optional) ==========
bot.action("links", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Choose one:",
    Markup.inlineKeyboard([
      [Markup.button.url("🚪 Claim Free Access", JOIN_URL)],
      [Markup.button.url("💬 Contact Support", supportLink())],
      [Markup.button.url("👥 Join Community", COMMUNITY_URL)]
    ])
  );
});

// ========== START ==========
bot.launch();
console.log("🔥 Elitez Club Lead Bot Started!");
