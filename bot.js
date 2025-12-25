import { Telegraf, Markup } from "telegraf";
import axios from "axios";

// ========== ENV VARS ==========
const BOT_TOKEN     = process.env.BOT_TOKEN;
const GROUP_ID      = process.env.GROUP_ID;      // Community group/channel ID (numeric -100xxxx)
const ADMIN_CHAT    = process.env.ADMIN_CHAT;    // Staff/admin chat id or @channel
const SHEET_URL     = process.env.SHEET_URL;     // Google Apps Script Webhook
const SUPPORT_USER  = process.env.SUPPORT_USER || "elitez_club7"; // without @
const COMMUNITY_URL = process.env.COMMUNITY_URL || "https://t.me/elitezclub_community";
const JOIN_URL      = process.env.JOIN_URL || "https://elitez.club/join";
// ===============================


if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing!");

const bot = new Telegraf(BOT_TOKEN);

// In-memory state (replace with DB later if needed)
const userState = {}; 
// possible states: new → waiting_join → waiting_email → done

// ---------- Email validation ----------
function isEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((text || "").trim());
}

function getState(ctx) {
  const id = ctx.from.id;
  if (!userState[id]) userState[id] = { status: "new" };
  return userState[id];
}

// ---------- Save lead to Google Sheets ----------
async function saveLead({ user_id, username, full_name, email }) {
  if (!SHEET_URL) return;
  try {
    await axios.post(SHEET_URL, {
      user_id,
      username,
      full_name,
      email,
      source: "elitez_club_bot"
    });
  } catch (err) {
    console.error("❌ Google Sheet Error:", err?.message || err);
  }
}

function supportLink() {
  const text = encodeURIComponent("Hi, I need help with Elitez Club free access.");
  return `https://t.me/${SUPPORT_USER}?text=${text}`;
}

// ========== MAIN HANDLER ==========
// Start command → explicitly start funnel
bot.start((ctx) => handleMsg(ctx));

async function handleMsg(ctx) {
  const id        = ctx.from.id;
  const username  = ctx.from.username ? "@" + ctx.from.username : "(no username)";
  const firstName = ctx.from.first_name || "";
  const lastName  = ctx.from.last_name || "";
  const fullName  = `${firstName} ${lastName}`.trim();
  const state     = getState(ctx);

  // ---------- FIRST MESSAGE → START FUNNEL ----------
  if (state.status === "new") {
    state.status = "waiting_join";

    await ctx.reply(
      "Welcome to the Elitez Club Free Access Bot 🎁\n\n" +
      "Before we continue, you must join the Elitez Club community 👇",
      Markup.inlineKeyboard([
        [Markup.button.url("👥 Join the Community", COMMUNITY_URL)],
        [Markup.button.callback("✅ I Joined", "joined_community")]
      ])
    );

    // Notify staff
    if (ADMIN_CHAT) {
      await ctx.telegram.sendMessage(
        ADMIN_CHAT,
        `🟡 New user started the free access flow\n\n` +
        `👤 Name: ${fullName}\n` +
        `📛 Username: ${username}\n` +
        `🆔 ID: ${id}`
      );
    }

    return;
  }

  // ---------- WAITING FOR EMAIL ----------
  if (state.status === "waiting_email") {
    const text = ctx.message.text || "";

    if (!isEmail(text)) {
      await ctx.reply(
        "That email doesn’t look valid.\nSend it like:\n`name@gmail.com`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const email = text.trim();

    // Save lead
    await saveLead({
      user_id: id,
      username,
      full_name: fullName,
      email
    });

    // Notify staff
    if (ADMIN_CHAT) {
      await ctx.telegram.sendMessage(
        ADMIN_CHAT,
        `🆕 New free access request\n\n` +
        `👤 ${fullName}\n` +
        `📛 ${username}\n` +
        `📩 ${email}\n`
      );
    }

    // Send buttons: join link + support
    await ctx.reply(
      "Email received ✅\n\n" +
      "Tap below to claim your free access:",
      Markup.inlineKeyboard([
        [Markup.button.url("🚪 Claim Free Access", JOIN_URL)],
        [Markup.button.url("💬 Contact Support", supportLink())]
      ])
    );

    state.status = "done";
    return;
  }

  // ---------- ALREADY DONE ----------
  if (state.status === "done") {
    await ctx.reply(
      "✅ Your free access request is already submitted.\n" +
      "If you need help, tap Support below:",
      Markup.inlineKeyboard([
        [Markup.button.url("🚪 Claim Free Access", JOIN_URL)],
        [Markup.button.url("💬 Contact Support", supportLink())]
      ])
    );

    // Forward extra message to admin (optional)
    if (ADMIN_CHAT && ctx.message?.text) {
      await ctx.telegram.sendMessage(
        ADMIN_CHAT,
        `📩 Message from a completed user:\n\n` +
        `👤 ${fullName}\n` +
        `📛 ${username}\n` +
        `🆔 ${id}\n\n` +
        `Text:\n${ctx.message.text}`
      );
    }

    return;
  }

  // ---------- STILL WAITING FOR COMMUNITY JOIN ----------
  if (state.status === "waiting_join") {
    await ctx.reply(
      "Before we continue, you must join the community 👇\n" +
      "Then tap: ✅ I Joined",
      Markup.inlineKeyboard([
        [Markup.button.url("👥 Join the Community", COMMUNITY_URL)],
        [Markup.button.callback("✅ I Joined", "joined_community")]
      ])
    );
  }
}

// ========== JOIN CONFIRMATION BUTTON ==========
bot.action("joined_community", async (ctx) => {
  const id    = ctx.from.id;
  const state = getState(ctx);

  try {
    // If GROUP_ID missing, skip verification (keeps flow working)
    if (!GROUP_ID) {
      state.status = "waiting_email";
      await ctx.answerCbQuery("✅ Continue");
      await ctx.reply("Great. Now send the email you want to use for free access:");
      return;
    }

    const member = await ctx.telegram.getChatMember(GROUP_ID, id);

    if (["member", "administrator", "creator"].includes(member.status)) {
      state.status = "waiting_email";

      await ctx.answerCbQuery("✅ Verified");
      await ctx.reply(
        "Verified ✅\n\n" +
        "Now send the email you want to use for free access:"
      );
    } else {
      await ctx.answerCbQuery("❌ Not joined yet");
      await ctx.reply("Join the community first, then tap ✅ I Joined again.");
    }
  } catch (err) {
    console.error("Join check error:", err);
    await ctx.answerCbQuery("⚠️ Error");
    await ctx.reply("Verification failed. Please try again.");
  }
});

// ===== SIMPLE COMMAND HANDLERS =====
bot.command("help", async (ctx) => {
  await ctx.reply(
    "Hi 👋\n\n" +
    "This is the official Elitez Club Free Access bot.\n\n" +
    "You can:\n" +
    "• Join the community\n" +
    "• Submit your email to activate free access\n" +
    "• Contact support\n\n" +
    "Tap below to start:",
    Markup.inlineKeyboard([
      [Markup.button.callback("🚀 Start Free Access", "start_flow")]
    ])
  );
});

bot.command("info", async (ctx) => {
  await ctx.reply(
    "ℹ️ About Elitez Club:\n\n" +
    "• Courses & systems\n" +
    "• Community & weekly drops\n" +
    "• Mindset. Money. Mastery.\n\n" +
    "Tap below to start:",
    Markup.inlineKeyboard([
      [Markup.button.callback("🚀 Start Free Access", "start_flow")]
    ])
  );
});

bot.command("trial", async (ctx) => {
  const state = getState(ctx);

  if (state.status === "done") {
    await ctx.reply(
      "✅ Your request is already submitted.\n" +
      "If you need help, message here or tap Support after /start."
    );
    return;
  }

  state.status = "new";
  await handleMsg(ctx);
});

// ========== Start Flow ==========
bot.action("start_flow", async (ctx) => {
  const state = getState(ctx);

  if (state.status === "done") {
    await ctx.answerCbQuery("✅ Already submitted");
    await ctx.reply(
      "✅ Your free access request is already submitted.\n" +
      "Use the buttons below:",
      Markup.inlineKeyboard([
        [Markup.button.url("🚪 Claim Free Access", JOIN_URL)],
        [Markup.button.url("💬 Contact Support", supportLink())]
      ])
    );
    return;
  }

  state.status = "new";
  await ctx.answerCbQuery();
  await handleMsg(ctx);
});

// Generic text handler (non-command messages)
bot.on("text", (ctx) => {
  const entities = ctx.message.entities;

  // If message contains a bot_command, do NOT treat it as normal text
  if (entities && entities.some((e) => e.type === "bot_command")) return;

  handleMsg(ctx);
});

// ========== START BOT ==========
bot.launch();
console.log("🔥 Elitez Club Free Access Bot Started!");
