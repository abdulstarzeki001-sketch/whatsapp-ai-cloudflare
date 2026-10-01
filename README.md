# WhatsApp AI Assistant — Cloudflare Workers

مشروع رسمي لربط **WhatsApp Business Platform (Cloud API)** مع **OpenAI API** وتشغيله على **Cloudflare Workers**.

## المزايا

- استقبال Webhook الرسمي من Meta.
- التحقق من `META_VERIFY_TOKEN`.
- التحقق من توقيع `X-Hub-Signature-256` باستخدام `META_APP_SECRET`.
- إرسال رسائل العملاء إلى OpenAI Responses API.
- إعادة الرد تلقائياً عبر WhatsApp Cloud API.
- دعم طلب التحويل إلى موظف بشري.
- عدم حفظ أي API keys داخل GitHub.
- Endpoint للفحص: `/health`.
- جاهز للنشر من GitHub إلى Cloudflare Workers.

## النشر على Cloudflare

من Cloudflare Dashboard:

1. افتح **Workers & Pages**.
2. اختر **Create / Import from Git**.
3. اختر المستودع:
   `abdulstarzeki001-sketch/whatsapp-ai-cloudflare`
4. الفرع:
   `main`
5. لا تحتاج Root Directory لأن المشروع موجود في جذر المستودع.
6. Deploy command:
   `npx wrangler deploy`

أو من الطرفية:

```bash
npm install
npx wrangler deploy
```

## الأسرار المطلوبة

من Worker > Settings > Variables and Secrets أضف كـ Secrets:

- `OPENAI_API_KEY`
- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `META_VERIFY_TOKEN`
- `META_APP_SECRET`

المتغيرات الاختيارية:

- `OPENAI_MODEL`
- `META_GRAPH_VERSION`
- `BOT_SYSTEM_PROMPT`

لا تضع الأسرار داخل GitHub.

## إعداد Meta / WhatsApp

1. أنشئ تطبيق Business في Meta for Developers.
2. أضف منتج WhatsApp.
3. من WhatsApp > API Setup خذ:
   - Phone Number ID
   - Access Token
4. من App Settings > Basic خذ App Secret.
5. اختر نصاً سرياً طويلاً ليكون `META_VERIFY_TOKEN`.
6. بعد نشر Worker استخدم:

```
https://<worker-name>.<subdomain>.workers.dev/webhook
```

كـ Callback URL داخل Webhooks في Meta.

ضع نفس قيمة `META_VERIFY_TOKEN` كـ Verify Token، ثم اشترك في حقل:

`messages`

## فحص الخدمة

افتح:

```
https://<worker-name>.<subdomain>.workers.dev/health
```

المفروض يرجع:

```json
{
  "ok": true,
  "service": "whatsapp-ai-cloudflare",
  "webhook": "/webhook"
}
```

## تخصيص شخصية المساعد

عدّل `BOT_SYSTEM_PROMPT` من Cloudflare بدون تعديل الكود.

مثال:

```
أنت مساعد شركة نقل. أجب بالعربية العراقية باختصار ووضوح.
لا تخترع أسعاراً أو معلومات غير موجودة.
إذا احتاج العميل موظفاً بشرياً فاطلب منه كتابة: موظف.
```

## ملاحظة

النسخة الحالية تتعامل مع الرسائل النصية. يمكن إضافة الصور، الصوت، PDF، D1، سجل العملاء، لوحة إدارة، وربط النظام المحاسبي لاحقاً.
