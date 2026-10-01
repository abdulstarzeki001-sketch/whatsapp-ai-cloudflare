const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "whatsapp-ai-cloudflare",
        webhook: "/webhook",
      });
    }

    if (url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "GET") {
      return verifyWebhook(url, env);
    }

    if (request.method === "POST") {
      const rawBody = await request.text();

      const signatureOk = await verifyMetaSignature(
        rawBody,
        request.headers.get("x-hub-signature-256"),
        env.META_APP_SECRET
      );

      if (!signatureOk) {
        return new Response("Invalid signature", { status: 401 });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      ctx.waitUntil(handleWebhook(payload, env));
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};

function verifyWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    env.META_VERIFY_TOKEN &&
    token === env.META_VERIFY_TOKEN
  ) {
    return new Response(challenge || "", { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) {
    console.error("META_APP_SECRET is not configured.");
    return false;
  }

  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expectedHex = signatureHeader.slice("sha256=".length).toLowerCase();

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody)
  );

  const actualHex = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return constantTimeEqual(actualHex, expectedHex);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function handleWebhook(payload, env) {
  if (payload?.object !== "whatsapp_business_account") return;

  const entries = payload.entry || [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;

      const value = change.value || {};
      const messages = value.messages || [];

      for (const message of messages) {
        try {
          await handleIncomingMessage(message, value, env);
        } catch (error) {
          console.error("Message processing failed:", error);
        }
      }
    }
  }
}

async function handleIncomingMessage(message, value, env) {
  const from = message.from;
  if (!from) return;

  if (message.type !== "text") {
    await sendWhatsAppText(
      from,
      "حالياً أستطيع التعامل مع الرسائل النصية. أرسل طلبك كنص وسأساعدك.",
      env
    );
    return;
  }

  const userText = (message.text?.body || "").trim();
  if (!userText) return;

  if (isHumanHandoffRequest(userText)) {
    await sendWhatsAppText(
      from,
      "تم استلام طلبك للتحدث مع موظف. سيتم التعامل معه يدوياً.",
      env
    );
    return;
  }

  const contactName =
    value?.contacts?.find((c) => c.wa_id === from)?.profile?.name || "";

  const reply = await askOpenAI({
    userText,
    contactName,
    env,
  });

  for (const chunk of splitText(reply, 3500)) {
    await sendWhatsAppText(from, chunk, env);
  }
}

function isHumanHandoffRequest(text) {
  const normalized = text.toLowerCase();
  return [
    "موظف",
    "انسان",
    "إنسان",
    "بشر",
    "human",
    "agent",
    "representative",
  ].some((word) => normalized.includes(word));
}

async function askOpenAI({ userText, contactName, env }) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = env.OPENAI_MODEL || "gpt-5.6-luna";
  const instructions =
    env.BOT_SYSTEM_PROMPT ||
    "You are a concise, helpful WhatsApp customer-service assistant.";

  const input = contactName
    ? `اسم العميل: ${contactName}\nرسالة العميل: ${userText}`
    : userText;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: 700,
      store: false,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OpenAI error:", JSON.stringify(data));
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const text =
    data.output_text ||
    (data.output || [])
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text)
      .join("\n")
      .trim();

  return text || "تم استلام رسالتك، لكن تعذر إنشاء رد الآن.";
}

async function sendWhatsAppText(to, body, env) {
  if (!env.WHATSAPP_TOKEN) {
    throw new Error("WHATSAPP_TOKEN is not configured.");
  }
  if (!env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured.");
  }

  const version = env.META_GRAPH_VERSION || "v24.0";
  const endpoint =
    `https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("WhatsApp send error:", JSON.stringify(data));
    throw new Error(`WhatsApp request failed with status ${response.status}`);
  }

  return data;
}

function splitText(text, maxLength = 3500) {
  const value = String(text || "").trim();
  if (!value) return [""];

  if (value.length <= maxLength) return [value];

  const chunks = [];
  let remaining = value;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength * 0.5) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength * 0.5) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
