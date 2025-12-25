import { Telegraf, Markup } from "telegraf";
import axios from "axios";

// ========== ENV VARS ==========
const BOT_TOKEN    = process.env.BOT_TOKEN;
const GROUP_ID     = process.env.GROUP_ID;      // Community group ID (numeric, e.g. -100123...)
const ADMIN_CHAT   = process.env.ADMIN_CHAT;    // Staff/admin channel/chat id
const SHEET_URL    = process.env.SHEET_URL;     // Google Apps Script Webhook
const SUPPORT_USER = process.env.SUPPORT_USER || "elitez_club7"; // without @
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
  try {
    if (!SHEET_URL) return;
    await axios.post(SHEET_URL, {
      user_id,
      username,
      full_name,
      email
    });
  } catch (err) {
    console.error("❌ Google Sheet Error:", err);
  }
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
      "Welcome to the Free Access Bot for Elitez Club 🎁\n\n" +
      "Before we continue, you must join the Elitez Club community 👇",
      Markup.inlineKeyboard([
        [Markup.button.url("👥 Join the Community", "https://t.me/elitezclub_community")],
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
        "That email is not valid.\nSend it like:\n`name@gmail.com`",
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
        `📩 ${email}\n\n`
      );
    }

    // Redirect user to support (EXACT same logic as old bot)
    await ctx.reply(
      "Email received successfully! 🎉\n\n" +
      "Tap the button below to contact support and activate your free access:",
      Markup.inlineKeyboard([
        [Markup.button.url(
          "💬 Contact Support Now",
          `https://t.me/${SUPPORT_USER}?text=I+want+to+get+free+access`
        )]
      ])
    );

    state.status = "done";
    return;
  }

  // ---------- ALREADY DONE ----------
  if (state.status === "done") {
    await ctx.reply(
      "✔ Your free access request has already been submitted.\n" +
      "If you have any questions, tap below to contact support:",
      Markup.inlineKeyboard([
        [Markup.button.url(
          "💬 Contact Support Now",
          `https://t.me/${SUPPORT_USER}?text=I+want+to+get+free+access`
        )]
      ])
    );

    if (ADMIN_CHAT && ctx.message.text) {
      await ctx.telegram.sendMessage(
        ADMIN_CHAT,
        `📩 New message from a user who completed the flow:\n\n` +
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
      "Before we continue… you must join the community 👇\n" +
      "Then press: **I Joined**",
      Markup.inlineKeyboard([
        [Markup.button.url("👥 Join the Community", "https://t.me/elitezclub_community")],
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
    const member = await ctx.telegram.getChatMember(GROUP_ID, id);

    if (["member", "administrator", "creator"].includes(member.status)) {
      state.status = "waiting_email";

      await ctx.answerCbQuery("✔ Verified");
      await ctx.reply(
        "Perfect! ✨\n" +
        "Now send the email you want to use to activate your free access:"
      );

    } else {
      await ctx.answerCbQuery("❌ Not joined yet");
      await ctx.reply("Join the community first using the button above, then tap: **I Joined**");
    }

  } catch (err) {
    console.error("Join check error:", err);
    await ctx.answerCbQuery("⚠️ Error");
    await ctx.reply("Verification error… please try again.");
  }
});

// ===== SIMPLE COMMAND HANDLERS =====
// /help
bot.command("help", async (ctx) => {
  await ctx.reply(
    "Hi 👋\n\n" +
    "This is the official free access bot for Elitez Club.\n" +
    "With this bot you can:\n" +
    "• Join the community\n" +
    "• Submit your email for free access\n" +
    "• Contact the support team\n\n" +
    "Tap below to start:",
    Markup.inlineKeyboard([
      [Markup.button.callback("🚀 Start Free Access", "start_flow")]
    ])
  );
});

// /info
bot.command("info", async (ctx) => {
  await ctx.reply(
    "ℹ️ About Elitez Club:\n\n" +
    "• Courses + systems\n" +
    "• Community support\n" +
    "• Continuous updates\n\n" +
    "Tap below to start:",
    Markup.inlineKeyboard([
      [Markup.button.callback("🚀 Start Free Access", "start_flow")]
    ])
  );
});

// /trial
bot.command("trial", async (ctx) => {
  const state = getState(ctx);

  if (state.status === "done") {
    await ctx.reply(
      "✅ Your free access request was already submitted.\n" +
      "If you need anything else, send your message here."
    );
    return;
  }

  // New or mid-flow → start / resume funnel
  state.status = "new";
  await handleMsg(ctx);
});

// ========== Start Flow ==========
bot.action("start_flow", async (ctx) => {
  const state = getState(ctx);

  // User already did the whole flow → don't restart
  if (state.status === "done") {
    await ctx.answerCbQuery("✅ Already submitted");
    await ctx.reply(
      "✔ Your free access request has already been submitted.\n" +
      "If you have questions, tap below to contact support:",
      Markup.inlineKeyboard([
        [Markup.button.url(
          "💬 Contact Support Now",
          `https://t.me/${SUPPORT_USER}?text=I+want+to+get+free+access`
        )]
      ])
    );
    return;
  }

  // New or mid-flow user → start / resume normally
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
